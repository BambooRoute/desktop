import type { ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
import type { DesktopAccountBackend } from './account-backend.ts'
import { bambooAccount } from './bamboo-desktop.ts'

export interface WelcomeState {
  readonly loggedIn: boolean
  readonly hasApiKey: boolean
  readonly writable: boolean
  readonly localePreference: string | null
}

export interface DesktopWelcomeBackend {
  analyticsEnabled(): Promise<boolean>
  readonly account: DesktopAccountBackend
  report(event: ProductEvent): Promise<void>
  read(): Promise<WelcomeState>
  readLocalePreference(): Promise<string | null>
  save(apiKey: string): Promise<{ ok: boolean }>
}

export function connectDesktopWelcome(_hostUrl: string, _cookie: string): DesktopWelcomeBackend {
  const state: DesktopAccountBackend['state'] = async () => ({ status: 'signed-out', attempt: null,
    links: { usageUrl: 'https://bambooroute.com/requests', topUpUrl: 'https://bambooroute.com/billing' } })
  return {
    account: { state, start: state, cancel: state, signOut: state, watch: () => () => {} },
    analyticsEnabled: async () => false,
    report: async () => {},
    async read() {
      const value = await bambooAccount().refresh()
      return { loggedIn: value.status === 'signed-in', hasApiKey: false, writable: false, localePreference: 'en' }
    },
    readLocalePreference: async () => 'en',
    save: async () => ({ ok: false }),
  }
}
