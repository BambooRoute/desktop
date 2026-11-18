import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { isBambooAccountKey, type BambooAccountKey, type bambooAccountNamespace } from './bamboo-account-locales.ts'
import type { BambooApi, BambooState } from './bamboo-types.ts'
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
  const currency = 'CNY'
  const errorKey = error ?? state?.errorKey
  const errorText = isBambooAccountKey(errorKey) ? t(errorKey, { currency }) : state?.error
  const notice = isBambooAccountKey(state?.noticeKey) ? t(state.noticeKey, { currency }) : state?.notice
  const account = state?.account
  const walletTitle = t('wallet', { currency })
  return <section className={css.section} aria-label={t('title')}>
    <h2 className={css.heading}>{t('title')}</h2>
    {errorText && <p className={css.notice} role="alert">{errorText}</p>}
    {!state && !error && <p role="status">{t('loading')}</p>}
    {state?.status === 'signed-in' && api ? <>
      <div className={css.card}>
        <span className={css.email}>{account?.email ?? t('connected')}</span>
        {account && <section className={css.wallet} aria-label={walletTitle}>
          <h3>{walletTitle}</h3>
          <dl className={css.balances}>
            <div><dt>{t('available_balance')}</dt><dd>{currency} {account.wallet.available}</dd></div>
            <div><dt>{t('held_balance')}</dt><dd>{currency} {account.wallet.reserved}</dd></div>
          </dl>
        </section>}
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openPage('billing')) }}>
            {account ? t(account.canTopUp ? 'add_funds' : 'view_currency_billing', { currency }) : t('view_billing')}
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
      {state.models.length === 0 && account && !notice && !errorText && <p className={css.modelNotice}>{t('no_models', { currency })}</p>}
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
      {state.status === 'waiting' ? <>
        <p className={css.modelNotice}>{t('confirm_code', { currency })}</p>
        <p className={css.code}>{state.code}</p>
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openBrowser()) }}>{t('open_browser')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.cancel()) }}>{t('cancel')}</Button>
        </div>
      </> : <>
        {notice ? <p className={css.modelNotice} role="status">{notice}</p> : <p className={css.modelNotice}>{t('sign_in_prompt')}</p>}
        <Button variant="primary" disabled={busy || state.status === 'connecting'} onClick={() => { void run(() => api.signIn()) }}>
          {t(state.status === 'connecting' ? 'starting_sign_in' : 'sign_in')}
        </Button>
      </>}

      <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('keys')) }}>{t('manage_devices_web')}</Button>
    </> : null}
  </section>
}
