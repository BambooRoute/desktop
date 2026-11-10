import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BambooAccountPanel } from './BambooAccount.tsx'
import { type AccountKey } from './locales.ts'

export type { AccountSectionInjected, AccountSectionProps, AccountSnapshot } from './AccountSection.tsx'
export type { AccountMenuProps } from './AccountMenu.tsx'
export type { AccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.account': AccountKey }
}

export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'bamboo-account', order: -10, label: 'Bamboo account',
  }, BambooAccountPanel))
}
