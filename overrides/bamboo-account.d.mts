import type { BambooState, Currency } from './bamboo-types.ts'

export interface BambooCredential { site: string; gateway: string; token: string; keyId: string; expiresAt: string; currency: Currency }
export interface BambooStorage {
  assertAvailable(): void
  read(): Promise<BambooCredential | null>
  write(credential: BambooCredential): Promise<void>
  clear(): Promise<void>
}
export class BambooError extends Error { code: string; status: number; constructor(code: string, message: string, status?: number) }
export class BambooAccount {
  constructor(options: { site: string; gateway: string; storage: BambooStorage; openExternal(url: string): Promise<void>; fetch?: typeof fetch; pollInterval?: number })
  state(): BambooState
  initialize(): Promise<BambooState>
  signIn(currency: Currency): Promise<BambooState>
  cancel(): Promise<BambooState>
  signOut(): Promise<BambooState>
  refresh(force?: boolean): Promise<BambooState>
  subscribe(listener: (state: BambooState) => void): () => void
  openBrowser(): Promise<void>
  openPage(page: string): Promise<void>
  close(): void
}
