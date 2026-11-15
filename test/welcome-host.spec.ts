import { beforeEach, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../src/bamboo-desktop.ts', () => ({ bambooAccount: () => account }))

import { connectDesktopWelcome } from '../src/welcome-backend.ts'

beforeEach(() => account.refresh.mockReset())

function settings(readPreference: () => string | undefined) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    return Response.json({ type: 'server-response', rpcId: request.rpcId,
      result: { ok: true, value: { namespaces: [{ ns: 'locale', value: { preference: readPreference() } }] } } })
  })
}

it('uses Bamboo session state to determine whether onboarding is required', async () => {
  const backend = connectDesktopWelcome('http://127.0.0.1', 'local-cookie', settings(() => 'en'))
  account.refresh.mockResolvedValue({ status: 'signed-out' })
  expect(await backend.read()).toEqual({ loggedIn: false, hasApiKey: false, writable: false, localePreference: 'en' })
  account.refresh.mockResolvedValue({ status: 'signed-in' })
  expect((await backend.read()).loggedIn).toBe(true)
  expect(account.refresh).toHaveBeenCalledTimes(2)
})

it('disables upstream credential entry and analytics', async () => {
  const backend = connectDesktopWelcome('http://127.0.0.1', 'local-cookie', settings(() => 'en'))
  expect(await backend.save('unused')).toEqual({ ok: false })
  expect(await backend.analyticsEnabled()).toBe(false)
  expect((await backend.account.state()).status).toBe('signed-out')
})

it('reads the current Host language for both renderer startup and the native window', async () => {
  let preference: string | undefined = 'zh'
  const send = settings(() => preference)
  const backend = connectDesktopWelcome('http://127.0.0.1:3000', 'local-cookie', send)
  account.refresh.mockResolvedValue({ status: 'signed-in' })
  expect(await backend.readLocalePreference()).toBe('zh')
  expect(send).toHaveBeenCalledWith(new URL('http://127.0.0.1:3000/api/settings/describe'),
    expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json', cookie: 'local-cookie' } }))
  expect(account.refresh).not.toHaveBeenCalled()
  preference = 'ja'
  expect((await backend.read()).localePreference).toBe('ja')
  preference = undefined
  expect(await backend.readLocalePreference()).toBeNull()
})
