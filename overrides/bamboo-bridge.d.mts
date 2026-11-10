import type { BambooAccount } from './bamboo-account.mjs'
export interface BambooBridge { url: string; token: string; close(): void }
export function createBambooBridge(account: BambooAccount): Promise<BambooBridge>
