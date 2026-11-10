import { beforeEach, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../src/bamboo-desktop.ts', () => ({ bambooAccount: () => account }))

import { connectDesktopWelcome } from '../src/welcome-backend.ts'

beforeEach(() => account.refresh.mockReset())

it('uses Bamboo session state to determine whether onboarding is required', async () => {
  const backend = connectDesktopWelcome('http://127.0.0.1', 'local-cookie')
  account.refresh.mockResolvedValue({ status: 'signed-out' })
  expect(await backend.read()).toEqual({ loggedIn: false, hasApiKey: false, writable: false, localePreference: 'en' })
  account.refresh.mockResolvedValue({ status: 'signed-in' })
  expect((await backend.read()).loggedIn).toBe(true)
  expect(account.refresh).toHaveBeenCalledTimes(2)
})

it('disables upstream credential entry and analytics', async () => {
  const backend = connectDesktopWelcome('http://127.0.0.1', 'local-cookie')
  expect(await backend.save('unused')).toEqual({ ok: false })
  expect(await backend.analyticsEnabled()).toBe(false)
  expect(await backend.readLocalePreference()).toBe('en')
  expect((await backend.account.state()).status).toBe('signed-out')
})
