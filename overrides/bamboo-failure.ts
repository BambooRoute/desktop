import { bambooAccountLocales } from './bamboo-account-locales.ts'

const errorKeys = {
  insufficient_balance: 'insufficient_balance',
  balance_exhausted: 'generation_stopped_balance',
  budget_exhausted: 'generation_stopped_budget',
  key_budget_exceeded: 'key_budget_exceeded',
  invalid_api_key: 'invalid_api_key',
  account_not_ready: 'refresh_failed',
  account_changed: 'refresh_failed',
  model_access_disabled: 'model_access_disabled',
  email_verification_required: 'email_verification_required',
  policy_acceptance_required: 'policy_acceptance_required',
  policy_unavailable: 'policy_unavailable',
  payment_risk_blocked: 'payment_risk_blocked',
  request_forbidden: 'request_forbidden',
  site_maintenance: 'site_maintenance',
  site_coming_soon: 'site_coming_soon',
  model_unavailable: 'model_unavailable',
  network: 'network',
  invalid_account: 'invalid_account',
  invalid_catalog: 'invalid_catalog',
  invalid_response: 'request_unconfirmed',
  request_unconfirmed: 'request_unconfirmed',
  gateway_error: 'request_unconfirmed',
  billing_pending: 'request_unconfirmed',
  billing_persistence_failed: 'request_unconfirmed',
  no_healthy_channel: 'policy_unavailable',
  rate_limited: 'rate_limited',
} as const satisfies Record<string, keyof typeof bambooAccountLocales.en>

type Failure = { code?: string | undefined; message: string }
type BambooFailureKey = `failure.bamboo.${keyof typeof errorKeys}`
const requestID = (message: string) => /\breq_[a-f0-9]{32}\b/.exec(message)?.[0]
const withRequestID = (message: string, id?: string) => id ? `${message} Request ID: ${id}.` : message

function knownCode(code: string): code is keyof typeof errorKeys {
  return Object.hasOwn(errorKeys, code)
}

export function decodeBambooFailure(failure: Failure): { code: string; message: string } | undefined {
  const stopped = (failure.message === 'Generation stopped because the account balance is insufficient. Check request history before retrying' || failure.message === 'Generation stopped because the wallet has no available balance. Check request history before retrying') ? 'balance_exhausted'
    : failure.message === 'Generation stopped because this API key has no remaining budget. Check request history before retrying' ? 'budget_exhausted'
    : failure.message === 'Request accounting could not be confirmed. Check request history before retrying' ? 'billing_persistence_failed' : undefined
  if (stopped) return { code: `BAMBOO_${stopped.toUpperCase()}`, message: bambooAccountLocales.en[errorKeys[stopped]] }
  const match = /^\d{3}:\s*(\{[\s\S]*\})$/.exec(failure.message)
  if (!match) return undefined
  let value: unknown
  try { value = JSON.parse(match[1]!) } catch { return undefined }
  if (!value || typeof value !== 'object') return undefined
  const envelope = value as { error?: unknown }
  const body = (envelope.error && typeof envelope.error === 'object' ? envelope.error : value) as { code?: unknown; message?: unknown; request_id?: unknown }
  if (typeof body.code !== 'string' || !knownCode(body.code)) return undefined
  let code = body.code
  if (code === 'account_not_ready') {
    if (body.message === 'Your CNY wallet has no available funds. Open billing to check funding options.') code = 'insufficient_balance'
    if (body.message === bambooAccountLocales.en.network) code = 'network'
  }
  const id = typeof body.request_id === 'string' && /^req_[a-f0-9]{32}$/.test(body.request_id) ? body.request_id
    : typeof body.message === 'string' ? requestID(body.message) : undefined
  return { code: `BAMBOO_${code.toUpperCase()}`, message: withRequestID(bambooAccountLocales.en[errorKeys[code]].replaceAll('{currency}', 'CNY'), id) }
}

export function bambooFailureMessage(message: string, code: unknown, translate: (key: BambooFailureKey) => string): string | undefined {
  const decoded = decodeBambooFailure({ message, code: typeof code === 'string' ? code : undefined })
  const effectiveCode = decoded?.code ?? code
  if (typeof effectiveCode !== 'string' || !effectiveCode.startsWith('BAMBOO_')) return undefined
  const key = effectiveCode.slice('BAMBOO_'.length).toLowerCase()
  if (!knownCode(key)) return undefined
  return withRequestID(translate(`failure.bamboo.${key}`), requestID(decoded?.message ?? message))
}

export const bambooFailureLocales = Object.fromEntries(Object.entries(bambooAccountLocales).map(([locale, dictionary]) => [locale,
  Object.fromEntries(Object.entries(errorKeys).map(([code, key]) => [`failure.bamboo.${code}`, dictionary[key].replaceAll('{currency}', 'CNY')])),
])) as Record<keyof typeof bambooAccountLocales, Record<BambooFailureKey, string>>
