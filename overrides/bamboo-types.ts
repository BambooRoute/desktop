export type Currency = 'USD' | 'CNY'
export interface Wallet { currency: Currency; balance: string; reserved: string; available: string }

export interface BambooModel {
  id: string
  name: string
  provider: string
  maxOutput: number
  vision: boolean
  currency: Currency
  prices: Record<string, string>
}

export interface BambooState {
  status: 'signed-out' | 'connecting' | 'waiting' | 'signed-in'
  code?: string
  expiresAt?: number
  canCall: boolean
  activeCalls: number
  pendingCurrency?: Currency
  error?: string
  notice?: string
  models: BambooModel[]
  account?: {
    email: string
    emailVerified: boolean
    modelAccess: boolean
    policyReady: boolean
    policyAccepted: boolean
    currency: Currency
    wallet: Wallet
    wallets: Wallet[]
    topupCurrencies: Currency[]
  }
}

export interface BambooApi {
  state(): Promise<BambooState>
  signIn(currency: Currency): Promise<BambooState>
  cancel(): Promise<BambooState>
  refresh(): Promise<BambooState>
  signOut(): Promise<BambooState>
  openBrowser(): Promise<void>
  openPage(page: 'billing' | 'requests' | 'account' | 'keys' | 'support'): Promise<void>
  subscribe(listener: (state: BambooState) => void): () => void
}
