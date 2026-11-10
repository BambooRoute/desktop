export interface BambooModel {
  id: string
  name: string
  provider: string
  maxOutput: number
  vision: boolean
  prices: Record<string, string>
}

export interface BambooState {
  status: 'signed-out' | 'connecting' | 'waiting' | 'signed-in'
  code?: string
  expiresAt?: number
  canCall: boolean
  error?: string
  notice?: string
  models: BambooModel[]
  account?: {
    email: string
    emailVerified: boolean
    modelAccess: boolean
    policyReady: boolean
    policyAccepted: boolean
    wallet: { balance: string; reserved: string; available: string }
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
