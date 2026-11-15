import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '../../../packages/client/locale/src/client/index.ts'
import { SlotRegistry } from '../../../packages/client/ui-renderer/src/client/registry.ts'
import { createSlotRenderer } from '../../../packages/client/ui-renderer/src/client/scoped-slots.tsx'
import { bambooAccountNamespace } from '../../../packages/client/ui-settings-account/src/client/bamboo-account-locales.ts'
import * as accountPlugin from '../../../packages/client/ui-settings-account/src/client/index.ts'
import type { BambooApi, BambooState } from '../src/bamboo-types.ts'

let context: Context | undefined

afterEach(async () => {
  cleanup()
  await context?.fiber.dispose()
  context = undefined
  delete (window as unknown as { bambooAccount?: BambooApi }).bambooAccount
})

async function renderAccount() {
  const ctx = new Context()
  context = ctx
  const locale = new LocaleRuntime(ctx, undefined, { preference: 'en', languages: ['en'] })
  ctx.provide('locale', locale)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.install(createSlotRenderer())
  ctx.slots.installLocale(locale)
  const binding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  const scope = { getSnapshot: () => binding, subscribe: () => () => {} }
  ctx.slots.installScope('session', { current: scope, bindingSource: () => scope })
  ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } },
    ({ renderSlot }) => renderSlot('settings.section', { close: vi.fn() }))
  await ctx.plugin(accountPlugin).await()
  const entry = ctx.slots.entries('settings.section').find(entry => entry.options.id === 'bamboo-account')
  expect(entry?.locale).toBe(bambooAccountNamespace)
  render(<>{ctx.slots.renderSlot('root', {})}</>)
  return { locale, navLabel: entry?.options.label }
}

function fixture(currency: 'USD' | 'CNY' = 'USD', activeCalls = 0) {
  const wallets = [
    { currency: 'USD' as const, balance: '10', reserved: '0.3', available: '9.7' },
    { currency: 'CNY' as const, balance: '70', reserved: '1.1', available: '68.9' },
  ]
  const state: BambooState = { status: 'signed-in', canCall: true, activeCalls,
    account: { email: 'member@example.test', emailVerified: true, modelAccess: true, policyReady: true, policyAccepted: true,
      currency, wallets, wallet: wallets.find(wallet => wallet.currency === currency)!, topupCurrencies: ['USD'] },
    models: [{ id: 'model', name: 'Model', provider: 'deepseek', maxOutput: 800, vision: false, tools: false, currency, prices: { input: '0.123456789', output: '1.23' } }],
  }
  let receive: (value: BambooState) => void = () => {}
  const api: BambooApi = { state: vi.fn(async () => state), signIn: vi.fn(async () => state), cancel: vi.fn(async () => state), refresh: vi.fn(async () => state),
    signOut: vi.fn(async () => state), openBrowser: vi.fn(async () => {}), openPage: vi.fn(async () => {}),
    subscribe(listener) { receive = listener; return () => { receive = () => {} } },
  }
  Object.assign(window, { bambooAccount: api })
  return { state, api, update: (value: BambooState) => receive(value) }
}

it('shows separate wallets and exact prices in the active currency without offering unavailable online funding', async () => {
  const f = fixture('CNY')
  await renderAccount()
  await screen.findByText('CNY 68.9')
  expect(within(screen.getByRole('region', { name: 'USD wallet' })).getByText('USD 9.7')).toBeTruthy()
  expect(screen.getByText('CNY 0.123456789')).toBeTruthy()
  expect(screen.getByText('Model', { exact: true }).parentElement?.textContent).toBe('Model')
  expect(screen.queryByText(/Online CNY top-ups/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Add .* funds/ })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'View CNY billing' })) })
  expect(f.api.openPage).toHaveBeenCalledWith('billing')
})

it('requests browser confirmation for another billing currency and pauses switching during calls', async () => {
  const f = fixture()
  await renderAccount()
  const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Billing currency' })
  const change = screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm in browser' })
  expect(change.disabled).toBe(true)
  fireEvent.change(select, { target: { value: 'CNY' } })
  expect(change.disabled).toBe(false)
  expect(screen.getByText('Current billing currency: USD')).toBeTruthy()
  expect(f.api.signIn).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
  await act(async () => { fireEvent.click(change) })
  expect(f.api.signIn).toHaveBeenCalledWith('CNY')
  await act(async () => { f.update({ ...f.state, activeCalls: 1 }) })
  expect(select.disabled).toBe(true)
  expect(change.disabled).toBe(true)
  const hint = screen.getByRole('status')
  expect(hint.textContent).toBe('Finish current calls before switching.')
  expect(change.getAttribute('aria-describedby')).toBe(hint.id)
})

it('shows the currency being authorized and offers cancellation while waiting', async () => {
  const f = fixture()
  await renderAccount()
  await act(async () => {})
  await act(async () => { f.update({ status: 'waiting', pendingCurrency: 'CNY', models: [], canCall: false, activeCalls: 0, code: 'ABCD-EFGH' }) })
  expect(screen.getByText('Confirm this code in your browser to connect your CNY wallet:')).toBeTruthy()
  expect(screen.queryByText('USD 9.7')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
  expect(f.api.cancel).toHaveBeenCalledTimes(1)
})

it('keeps an empty CNY model catalog explicit', async () => {
  const f = fixture('CNY')
  f.state.models = []
  f.state.noticeKey = 'no_models'
  f.state.notice = 'No chat models are available for CNY billing. Choose another billing currency or check again later.'
  await renderAccount()
  expect(await screen.findByText('No chat models are available for CNY billing. Choose another billing currency or check again later.')).toBeTruthy()
  expect(screen.queryByText('USD 0.123456789')).toBeNull()
})

it('updates the account navigation, wallet and current messages when the desktop language changes', async () => {
  const f = fixture()
  Object.assign(f.state, {
    noticeKey: 'policy_unavailable', notice: 'Model calls are temporarily unavailable. Try again later.',
    errorKey: 'network', error: 'Could not reach Bamboo. Check your connection and try again.', canCall: false,
  })
  const { locale, navLabel } = await renderAccount()
  const panel = await screen.findByRole('region', { name: 'Bamboo account' })
  expect(navLabel).toBeTypeOf('function')
  expect(typeof navLabel === 'function' && navLabel()).toBe('Bamboo account')
  expect(screen.getByRole('status').textContent).toBe(f.state.notice)

  act(() => locale.setLocale('zh'))
  expect(typeof navLabel === 'function' && navLabel()).toBe('Bamboo 账户')
  expect(screen.getByRole('region', { name: 'Bamboo 账户' })).toBe(panel)
  expect(within(screen.getByRole('region', { name: 'USD 钱包' })).getByText('USD 9.7')).toBeTruthy()
  expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('暂时无法调用模型，请稍后再试。')
  expect(screen.getByRole('heading', { name: '工作区可用模型' }).nextElementSibling).toBe(screen.getByRole('status'))
  expect(screen.getByRole('alert').textContent).toBe('无法连接 Bamboo。请检查网络后重试。')

  for (const [id, label] of [['ja', 'Bamboo アカウント'], ['es', 'Cuenta de Bamboo'], ['fr', 'Compte Bamboo'], ['de', 'Bamboo-Konto'], ['ru', 'Аккаунт Bamboo'], ['pt', 'Conta Bamboo']] as const) {
    act(() => {
      locale.addLanguage({ id, label, fallback: 'en' })
      locale.setLocale(id)
    })
    expect(typeof navLabel === 'function' && navLabel()).toBe(label)
    expect(screen.getByRole('region', { name: label })).toBe(panel)
  }
  expect(f.api.state).toHaveBeenCalledTimes(1)
})
