interface AccountState {
  status: string
  models: unknown[]
  account?: { email: string; currency: string }
}

interface AccountSource {
  state(): Promise<AccountState>
  subscribe(listener: (state: AccountState) => void): () => void
}

export function watchBambooCatalog(source: AccountSource, refresh: () => void): () => void {
  let active = true
  let revision = 0
  let fingerprint = ''
  const receive = (state: AccountState) => {
    if (!active) return
    ++revision
    const next = JSON.stringify([state.status, state.account?.email, state.account?.currency, state.models])
    if (next === fingerprint) return
    fingerprint = next
    refresh()
  }
  const unsubscribe = source.subscribe(receive)
  void source.state().then(state => { if (revision === 0) receive(state) }).catch(() => {})
  return () => { active = false; unsubscribe() }
}

export function watchDesktopCatalog(refresh: () => void): () => void {
  const source = (window as unknown as { bambooAccount?: AccountSource }).bambooAccount
  return source ? watchBambooCatalog(source, refresh) : () => {}
}
