import { useEffect, useRef, useState } from 'react'
import type { WelcomeApi } from '../welcome-api.ts'
import type { BambooApi, BambooState } from '../bamboo-types.ts'

export function Welcome({ api, account = (window as unknown as { bambooAccount?: BambooApi }).bambooAccount }: {
  api: Pick<WelcomeApi, 'skip'>
  account?: BambooApi | undefined
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(false)
  const entered = useRef(false)
  const [state, setState] = useState<BambooState | null>(null)

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = 'en'
    document.title = 'Bamboo Desktop'
    if (!account) { setError('The Bamboo account service is unavailable. Restart the app to try again.'); return }
    const update = (value: BambooState) => {
      if (!mounted.current) return
      setState(value)
      if (value.status === 'signed-in' && !entered.current) {
        entered.current = true
        void openWorkspace()
      }
    }
    const unsubscribe = account.subscribe(update)
    void account.state().then(update).catch(() => { if (mounted.current) setError('Account details could not load. Restart the app to try again.') })
    return () => { mounted.current = false; unsubscribe() }
  }, [account])

  async function act(action: () => Promise<unknown>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { await action() }
    catch { if (mounted.current) setError('This action could not finish. Please try again.') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }

  async function openWorkspace() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api.skip()
    } catch {
      if (mounted.current) setError('The workspace could not open. Please try again.')
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="bamboo-welcome" aria-labelledby="welcome-title">
      <img src="assets/welcome-brand.svg" alt="" width="72" height="72" />
      <p className="bamboo-eyebrow">Bamboo Desktop</p>
      <h1 id="welcome-title">A workspace for your ideas.</h1>
      <p className="bamboo-description">Sign in with your Bamboo account to use models and work on local tasks.</p>
      {state?.status === 'waiting' && account ? <>
        <p className="bamboo-description">Confirm this code in your browser:</p>
        <p className="bamboo-code" aria-label="Device verification code">{state.code}</p>
        <div className="bamboo-actions">
          <button className="bamboo-primary" disabled={busy} onClick={() => { void act(() => account.openBrowser()) }}>Open browser</button>
          <button className="bamboo-secondary" disabled={busy} onClick={() => { void act(() => account.cancel()) }}>Cancel</button>
        </div>
      </> : state?.status === 'signed-in' ?
        <button className="bamboo-primary" disabled={busy} onClick={() => { void openWorkspace() }}>Open workspace</button> :
        <button className="bamboo-primary" type="button" disabled={busy || !account || !state || state.status === 'connecting'} aria-busy={busy}
          onClick={() => { if (account) void act(() => account.signIn()) }}>
          {busy || state?.status === 'connecting' ? 'Starting sign-in…' : 'Sign in to Bamboo'}
        </button>}
      {(error || state?.error) && <p className="bamboo-error" role="alert">{error || state?.error}</p>}
    </main>
  </>
}
