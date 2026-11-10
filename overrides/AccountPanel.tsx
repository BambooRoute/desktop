import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BambooApi, BambooState } from './bamboo-types.ts'
import css from './BambooAccount.module.css'

export function BambooAccountPanel() {
  const api = (window as unknown as { bambooAccount?: BambooApi }).bambooAccount
  const [state, setState] = useState<BambooState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    if (!api) { setError('Open Bamboo Desktop to manage your account.'); return }
    const unsubscribe = api.subscribe(setState)
    void api.state().then(value => { if (mounted.current) setState(value) }).catch(() => { if (mounted.current) setError('Account details could not load. Close and reopen Settings to retry.') })
    return () => { mounted.current = false; unsubscribe() }
  }, [api])
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { await action() }
    catch { if (mounted.current) setError('This action could not finish. Please try again.') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className={css.section} aria-label="Bamboo account">
    <h2 className={css.heading}>Bamboo account</h2>
    {(error || state?.error) && <p className={css.notice} role="alert">{error || state?.error}</p>}
    {!state && !error && <p role="status">Loading account…</p>}
    {state?.status === 'signed-in' && api ? <>
      <div className={css.card}>
        <span className={css.email}>{state.account?.email ?? 'Connected to Bamboo'}</span>
        {state.account && <dl className={css.balances}>
          <div><dt>Available balance</dt><dd>${state.account.wallet.available}</dd></div>
          <div><dt>Reserved for pending calls</dt><dd>${state.account.wallet.reserved}</dd></div>
        </dl>}
        {state.notice && <p className={css.notice} role="status">{state.notice}</p>}
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openPage('billing')) }}>Add funds</Button>
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
      <p className={css.secondary}>Models supporting chat and tools. Prices are USD per million tokens.</p>
      {state.models.length === 0 && <p>No compatible models are currently available.</p>}
      {state.models.map(model => <div className={css.card} key={model.id}>
        <div className={css.modelTitle}><span>{model.name}</span><span className={css.secondary}>{model.vision ? 'Text, images and tools' : 'Text and tools'}</span></div>
        <span className={css.secondary}>{model.provider} · {model.id}</span>
        <dl className={css.prices}>
          {(['input', 'output', 'cache_read', 'cache_write'] as const).map(field => model.prices[field] === undefined ? null :
            <div key={field}><dt>{{ input: 'Input', output: 'Output', cache_read: 'Cache read', cache_write: 'Cache write' }[field]}</dt><dd>${model.prices[field]}</dd></div>)}
        </dl>
      </div>)}
    </> : state && api ? <>
      <p>Sign in to use your Bamboo models and balance.</p>
      {state.status === 'waiting' ? <>
        <p>Confirm this code in your browser:</p><p className={css.code}>{state.code}</p>
        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={() => { void run(() => api.openBrowser()) }}>Open browser</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void run(() => api.cancel()) }}>Cancel</Button>
        </div>
      </> : <Button variant="primary" disabled={busy || state.status === 'connecting'} onClick={() => { void run(() => api.signIn()) }}>
        {state.status === 'connecting' ? 'Starting sign-in…' : 'Sign in to Bamboo'}
      </Button>}
      <Button size="sm" disabled={busy} onClick={() => { void run(() => api.openPage('keys')) }}>Manage devices on the website</Button>
    </> : null}
  </section>
}
