import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BambooApi, BambooState, Currency } from './bamboo-types.ts'
import css from './BambooAccount.module.css'

export function BambooAccountPanel() {
  const api = (window as unknown as { bambooAccount?: BambooApi }).bambooAccount
  const [state, setState] = useState<BambooState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [currency, setCurrency] = useState<Currency>('USD')
  useEffect(() => { if (state?.account) setCurrency(state.account.currency) }, [state?.account?.currency])
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    if (!api) { setError('Open Bamboo Desktop to manage your account.'); return }
    let received = false
    const unsubscribe = api.subscribe(value => { received = true; if (mounted.current) setState(value) })
    void api.state().then(value => { if (mounted.current && !received) setState(value) }).catch(() => { if (mounted.current) setError('Account details could not load. Close and reopen Settings to retry.') })
    return () => { mounted.current = false; unsubscribe() }
  }, [api])
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { await action() }
    catch { if (mounted.current) setError('This action could not finish. Refresh your account and try again.') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className={css.section} aria-label="Bamboo account">
    <h2 className={css.heading}>Bamboo account</h2>
    {(error || state?.error) && <p className={css.notice} role="alert">{error || state?.error}</p>}
    {!state && !error && <p role="status">Loading account…</p>}
    {state?.status === 'signed-in' && api ? <>
      <div className={css.card}>
        <span className={css.email}>{state.account?.email ?? 'Connected to Bamboo'}</span>
        {state.account && <>
          <p className={css.notice}>Current billing currency: <strong>{state.account.currency}</strong></p>
          <div className={css.wallets}>
            {state.account.wallets.map(wallet => <section className={css.wallet} key={wallet.currency} aria-label={`${wallet.currency} wallet`}>
              <h3>{wallet.currency} wallet{wallet.currency === state.account!.currency ? ' · In use' : ''}</h3>
              <dl className={css.balances}>
                <div><dt>Available balance</dt><dd>{wallet.currency} {wallet.available}</dd></div>
                <div><dt>Held for calls and refunds</dt><dd>{wallet.currency} {wallet.reserved}</dd></div>
              </dl>
            </section>)}
          </div>
          <div className={css.actions}>
            <label className={css.currency}>Billing currency
              <select value={currency} disabled={busy || state.activeCalls > 0} onChange={event => setCurrency(event.target.value as Currency)}>
                <option value="USD">US dollar · USD</option><option value="CNY">Chinese yuan · CNY</option>
              </select>
            </label>
            <Button variant="outline" disabled={busy || state.activeCalls > 0 || currency === state.account.currency} onClick={() => { void run(() => api.signIn(currency)) }}>Change billing currency</Button>
          </div>
          {state.activeCalls > 0 ? <p className={css.secondary}>Finish or stop current calls before changing billing currency.</p>
            : currency !== state.account.currency && <p className={css.secondary}>Confirm {currency} access in your browser. Your current connection stays available if you cancel.</p>}
          {!state.account.topupCurrencies.includes(state.account.currency) && <p className={css.secondary}>Online {state.account.currency} top-ups are not available. Open billing to check funding options.</p>}
        </>}
        {state.notice && <p className={css.notice} role="status">{state.notice}</p>}
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openPage('billing')) }}>{state.account?.topupCurrencies.includes(state.account.currency) ? `Add ${state.account.currency} funds` : state.account ? `View ${state.account.currency} billing` : 'View billing'}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.openPage('requests')) }}>Request history</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.refresh()) }}>Refresh</Button>
        </div>
        <div className={css.actions}>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('account')) }}>Manage account</Button>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('keys')) }}>Manage devices</Button>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('support')) }}>Support</Button>
          <Button size="sm" disabled={busy} onClick={() => { void run(() => api.signOut()) }}>Sign out</Button>
        </div>
      </div>
      <h3 className={css.subheading}>Models for your workspace</h3>
      <p className={css.secondary}>Models supporting chat and tools. Prices are per million tokens in the shown billing currency.</p>
      {state.models.length === 0 && state.account && !state.error && <p>No models supporting chat and tools are available for {state.account.currency} billing. Choose another billing currency or check again later.</p>}
      {state.models.map(model => <div className={css.card} key={model.id}>
        <div className={css.modelTitle}><span>{model.name}</span><span className={css.secondary}>{model.vision ? 'Text, images and tools' : 'Text and tools'}</span></div>
        <span className={css.secondary}>{model.provider} · {model.id}</span>
        <dl className={css.prices}>
          {(['input', 'output', 'cache_read', 'cache_write'] as const).map(field => model.prices[field] === undefined ? null :
            <div key={field}><dt>{{ input: 'Input', output: 'Output', cache_read: 'Cache read', cache_write: 'Cache write' }[field]}</dt><dd>{model.currency} {model.prices[field]}</dd></div>)}
        </dl>
      </div>)}
    </> : state && api ? <>
      <p>Sign in to use your Bamboo models and balance.</p>
      {state.status === 'waiting' ? <>
        <p>Confirm this code in your browser to connect your {state.pendingCurrency} wallet:</p><p className={css.code}>{state.code}</p>
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openBrowser()) }}>Open browser</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.cancel()) }}>Cancel</Button>
        </div>
      </> : <>
        <label className={css.currency}>Billing currency
          <select value={currency} disabled={busy || state.status === 'connecting'} onChange={event => setCurrency(event.target.value as Currency)}>
            <option value="USD">US dollar · USD</option><option value="CNY">Chinese yuan · CNY</option>
          </select>
        </label>
        <Button variant="primary" disabled={busy || state.status === 'connecting'} onClick={() => { void run(() => api.signIn(currency)) }}>
          {state.status === 'connecting' ? 'Starting sign-in…' : 'Sign in to Bamboo'}
        </Button>
      </>}

      <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('keys')) }}>Manage devices on the website</Button>
    </> : null}
  </section>
}
