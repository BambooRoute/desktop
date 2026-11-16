import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { isBambooAccountKey, type BambooAccountKey, type bambooAccountNamespace } from './bamboo-account-locales.ts'
import type { BambooApi, BambooState, Currency } from './bamboo-types.ts'
import css from './BambooAccount.module.css'

const vendorNames = new Map([
  ['anthropic', 'Anthropic'],
  ['deepseek', 'DeepSeek'],
  ['doubao', 'ByteDance'],
  ['gemini', 'Google'],
  ['minimax', 'MiniMax'],
  ['moonshot', 'Moonshot AI'],
  ['openai', 'OpenAI'],
  ['qwen', 'Alibaba'],
  ['tencent', 'Tencent'],
  ['zhipu', 'Zhipu AI'],
])

export function BambooAccountPanel({ t }: PropsLocale<typeof bambooAccountNamespace>) {
  const api = (window as unknown as { bambooAccount?: BambooApi }).bambooAccount
  const [state, setState] = useState<BambooState | null>(null)
  const [error, setError] = useState<BambooAccountKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [currency, setCurrency] = useState<Currency>('USD')
  const currencyFieldId = useId()
  const currencyHintId = useId()
  useEffect(() => { if (state?.account) setCurrency(state.account.currency) }, [state?.account?.currency])
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    if (!api) { setError('open_desktop'); return }
    let received = false
    const unsubscribe = api.subscribe(value => { received = true; if (mounted.current) setState(value) })
    void api.state().then(value => { if (mounted.current && !received) setState(value) }).catch(() => { if (mounted.current) setError('load_failed') })
    return () => { mounted.current = false; unsubscribe() }
  }, [api])
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try { await action() }
    catch { if (mounted.current) setError('action_failed') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const billingCurrency = state?.account?.currency ?? state?.pendingCurrency ?? currency
  const hasActiveCalls = (state?.activeCalls ?? 0) > 0
  const currencyChanged = state?.account !== undefined && currency !== state.account.currency
  const canChangeCurrency = currencyChanged && !hasActiveCalls
  const currencyHint = hasActiveCalls ? t('wait_for_calls') : undefined
  const errorKey = error ?? state?.errorKey
  const errorText = isBambooAccountKey(errorKey) ? t(errorKey, { currency: billingCurrency }) : state?.error
  const notice = isBambooAccountKey(state?.noticeKey) ? t(state.noticeKey, { currency: billingCurrency }) : state?.notice
  return <section className={css.section} aria-label={t('title')}>
    <h2 className={css.heading}>{t('title')}</h2>
    {errorText && <p className={css.notice} role="alert">{errorText}</p>}
    {!state && !error && <p role="status">{t('loading')}</p>}
    {state?.status === 'signed-in' && api ? <>
      <div className={css.card}>
        <span className={css.email}>{state.account?.email ?? t('connected')}</span>
        {state.account && <>
          <p className={css.notice}>{t('current_currency', { currency: state.account.currency })}</p>
          <div className={css.wallets}>
            {state.account.wallets.map(wallet => <section className={css.wallet} key={wallet.currency} aria-label={t('wallet', { currency: wallet.currency })}>
              <h3>{t(wallet.currency === billingCurrency ? 'active_wallet' : 'wallet', { currency: wallet.currency })}</h3>
              <dl className={css.balances}>
                <div><dt>{t('available_balance')}</dt><dd>{wallet.currency} {wallet.available}</dd></div>
                <div><dt>{t('held_balance')}</dt><dd>{wallet.currency} {wallet.reserved}</dd></div>
              </dl>
            </section>)}
          </div>
          <div className={css.currency}>
            <label htmlFor={currencyFieldId}>{t('billing_currency')}</label>
            <div className={css.currencyControls}>
              <select id={currencyFieldId} className={css.currencySelect} value={currency} disabled={busy || hasActiveCalls}
                aria-describedby={currencyHint ? currencyHintId : undefined} onChange={event => setCurrency(event.target.value as Currency)}>
                <option value="USD">{t('usd')}</option><option value="CNY">{t('cny')}</option>
              </select>
              <Button className={css.currencyButton} variant={canChangeCurrency ? 'primary' : 'outline'} disabled={busy || !canChangeCurrency}
                aria-describedby={currencyHint ? currencyHintId : undefined} onClick={() => { void run(() => api.signIn(currency)) }}>{t('change_currency')}</Button>
            </div>
            {currencyHint && <p id={currencyHintId} className={css.currencyHint} role="status">{currencyHint}</p>}
          </div>
        </>}
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openPage('billing')) }}>
            {state.account ? t(state.account.topupCurrencies.includes(billingCurrency) ? 'add_funds' : 'view_currency_billing', { currency: billingCurrency }) : t('view_billing')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.openPage('requests')) }}>{t('request_history')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.refresh()) }}>{t('refresh')}</Button>
        </div>
        <div className={css.actions}>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('account')) }}>{t('manage_account')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('keys')) }}>{t('manage_devices')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('support')) }}>{t('support')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.signOut()) }}>{t('sign_out')}</Button>
        </div>
      </div>
      <h3 className={css.subheading}>{t('workspace_models')}</h3>
      {notice && <p className={css.modelNotice} role="status">{notice}</p>}
      {state.models.length > 0 && <p className={css.secondary}>{t('model_prices')}</p>}
      {state.models.length === 0 && state.account && !notice && !errorText && <p className={css.modelNotice}>{t('no_models', { currency: state.account.currency })}</p>}
      {state.models.map(model => <div className={css.card} key={model.id}>
        <div className={css.modelTitle}>
          <span>{model.name}</span>
          {model.tools && <span className={css.secondary}>{t(model.vision ? 'vision_tools' : 'text_tools')}</span>}
        </div>
        <span className={css.secondary}>{model.vendor && `${vendorNames.get(model.vendor) ?? model.vendor} · `}{model.id}</span>
        <dl className={css.prices}>
          {(['input', 'output', 'cache_read', 'cache_write'] as const).map(field => model.prices[field] === undefined ? null :
            <div key={field}><dt>{t(field)}</dt><dd>{model.currency} {model.prices[field]}</dd></div>)}
        </dl>
      </div>)}
    </> : state && api ? <>
      <p>{t('sign_in_prompt')}</p>
      {state.status === 'waiting' ? <>
        <p>{t('confirm_code', { currency: billingCurrency })}</p><p className={css.code}>{state.code}</p>
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openBrowser()) }}>{t('open_browser')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.cancel()) }}>{t('cancel')}</Button>
        </div>
      </> : <>
        <label className={css.currency}>{t('billing_currency')}
          <select className={css.currencySelect} value={state.pendingCurrency ?? currency} disabled={busy || state.status === 'connecting'} onChange={event => setCurrency(event.target.value as Currency)}>
            <option value="USD">{t('usd')}</option><option value="CNY">{t('cny')}</option>
          </select>
        </label>
        <Button variant="primary" disabled={busy || state.status === 'connecting'} onClick={() => { void run(() => api.signIn(currency)) }}>
          {t(state.status === 'connecting' ? 'starting_sign_in' : 'sign_in')}
        </Button>
      </>}

      <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('keys')) }}>{t('manage_devices_web')}</Button>
    </> : null}
  </section>
}
