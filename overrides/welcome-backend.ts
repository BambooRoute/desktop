import { randomUUID } from 'node:crypto'
import type { ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
import type { DesktopAccountBackend } from './account-backend.ts'
import { bambooAccount } from './bamboo-desktop.ts'

export interface WelcomeState {
  readonly loggedIn: boolean
  readonly hasApiKey: boolean
  readonly writable: boolean
  readonly localePreference: string | null
}

export interface DesktopWelcomeBackend {
  analyticsEnabled(): Promise<boolean>
  readonly account: DesktopAccountBackend
  report(event: ProductEvent): Promise<void>
  read(): Promise<WelcomeState>
  readLocalePreference(): Promise<string | null>
  save(apiKey: string): Promise<{ ok: boolean }>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function connectDesktopWelcome(hostUrl: string, cookie: string, send: typeof fetch = fetch): DesktopWelcomeBackend {
  const settingsUrl = new URL('/api/settings/describe', hostUrl)
  const readLocalePreference = async (): Promise<string | null> => {
    const rpcId = randomUUID()
    const response = await send(settingsUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'settings/describe', payload: { args: {} } }),
    })
    if (!response.ok) throw new Error('Bamboo could not read the desktop language setting.')
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true || !record(envelope.result.value)
      || !Array.isArray(envelope.result.value.namespaces)) {
      throw new Error('Bamboo received invalid desktop settings.')
    }
    const locale: unknown = envelope.result.value.namespaces.find((entry: unknown) => record(entry) && entry.ns === 'locale')
    if (!record(locale) || !record(locale.value)
      || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
      throw new Error('Bamboo received an invalid desktop language setting.')
    }
    return locale.value.preference ?? null
  }
  const state: DesktopAccountBackend['state'] = async () => ({ status: 'signed-out', attempt: null,
    links: { usageUrl: 'https://bambooroute.com/requests', topUpUrl: 'https://bambooroute.com/billing' } })
  return {
    account: { state, start: state, cancel: state, signOut: state, watch: () => () => {} },
    analyticsEnabled: async () => false,
    report: async () => {},
    async read() {
      const [value, localePreference] = await Promise.all([bambooAccount().refresh(), readLocalePreference()])
      return { loggedIn: value.status === 'signed-in', hasApiKey: false, writable: false, localePreference }
    },
    readLocalePreference,
    save: async () => ({ ok: false }),
  }
}
