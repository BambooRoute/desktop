export interface Wallet { currency: 'CNY'; balance: string; reserved: string; available: string }

export interface BambooModel {
  id: string
  name: string
  provider: string
  vendor?: string
  contextWindow: number
  maxOutput: number
  vision: boolean
  tools: boolean
  currency: 'CNY'
  prices: Record<string, string>
}

export interface BambooState {
  status: 'signed-out' | 'connecting' | 'waiting' | 'signed-in'
  code?: string
  expiresAt?: number
  canCall: boolean
  error?: string
  errorKey?: string
  notice?: string
  noticeKey?: string
  models: BambooModel[]
  account?: {
    email: string
    emailVerified: boolean
    modelAccess: boolean
    policyReady: boolean
    policyAccepted: boolean
    currency: 'CNY'
    wallet: Wallet
    canTopUp: boolean
  }
}

export interface BambooApi {
  state(): Promise<BambooState>
  signIn(): Promise<BambooState>
  cancel(): Promise<BambooState>
  refresh(): Promise<BambooState>
  signOut(): Promise<BambooState>
  openBrowser(): Promise<void>
  openPage(page: 'billing' | 'requests' | 'account' | 'keys' | 'support'): Promise<void>
  subscribe(listener: (state: BambooState) => void): () => void
}
