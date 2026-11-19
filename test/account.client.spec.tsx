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

function fixture() {
  const state: BambooState = { status: 'signed-in', canCall: true,
    account: { email: 'member@example.test', emailVerified: true, modelAccess: true, policyReady: true, policyAccepted: true,
      currency: 'CNY', wallet: { currency: 'CNY', balance: '70', reserved: '1.1', available: '68.9' }, canTopUp: false },
    models: [{ id: 'DeepSeek-V4.1-Flash-1017', name: 'DeepSeek V4.1 Flash (1017)', provider: 'openai', vendor: 'deepseek',
      contextWindow: 1_048_576, maxOutput: 393_216, vision: false, tools: false, reasoningEfforts: [], currency: 'CNY', prices: { input: '0.123456789', output: '1.23' } }],
  }
  let receive: (value: BambooState) => void = () => {}
  const api: BambooApi = { state: vi.fn(async () => state), signIn: vi.fn(async () => state), cancel: vi.fn(async () => state), refresh: vi.fn(async () => state),
    signOut: vi.fn(async () => state), openBrowser: vi.fn(async () => {}), openPage: vi.fn(async () => {}),
    subscribe(listener) { receive = listener; return () => { receive = () => {} } },
  }
  Object.assign(window, { bambooAccount: api })
  return { state, api, update: (value: BambooState) => receive(value) }
}

it('shows the CNY wallet, exact prices and the available billing action', async () => {
  const f = fixture()
  await renderAccount()
  await screen.findByText('CNY 68.9')
  expect(within(screen.getByRole('region', { name: 'CNY wallet' })).getByText('CNY 1.1')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'USD wallet' })).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByText('CNY 0.123456789')).toBeTruthy()
  const modelName = 'DeepSeek V4.1 Flash (1017)'
  expect(screen.getByText(modelName, { exact: true }).parentElement?.textContent).toBe(modelName)
  expect(screen.getByText('DeepSeek · DeepSeek-V4.1-Flash-1017')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Add .* funds/ })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'View CNY billing' })) })
  expect(f.api.openPage).toHaveBeenCalledWith('billing')
  await act(async () => { f.update({ ...f.state, account: { ...f.state.account!, canTopUp: true } }) })
  expect(screen.getByRole('button', { name: 'Add CNY funds' })).toBeTruthy()
})

it('reconnects a legacy device directly to CNY and offers cancellation while awaiting authorization', async () => {
  const f = fixture()
  await renderAccount()
  await screen.findByText('CNY 68.9')
  await act(async () => {
    f.update({ status: 'signed-out', models: [], canCall: false, noticeKey: 'connect_cny_wallet' })
  })
  expect(screen.getByRole('status').textContent).toBe('Sign in again to connect your CNY wallet.')
  expect(screen.queryByRole('combobox')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in to Bamboo' })) })
  expect(f.api.signIn).toHaveBeenCalledWith()
  await act(async () => { f.update({ status: 'waiting', models: [], canCall: false, code: 'ABCD-EFGH' }) })
  expect(screen.getByText('Confirm this code in your browser to connect your CNY wallet:')).toBeTruthy()
  expect(screen.getByText('ABCD-EFGH')).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
  expect(f.api.cancel).toHaveBeenCalledTimes(1)
})

it('keeps an empty CNY model catalog explicit', async () => {
  const f = fixture()
  f.state.models = []
  f.state.noticeKey = 'no_models'
  f.state.notice = 'No chat models are available for CNY billing. Check again later.'
  await renderAccount()
  expect(await screen.findByText('No chat models are available for CNY billing. Check again later.')).toBeTruthy()
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
  expect(within(screen.getByRole('region', { name: 'CNY 钱包' })).getByText('CNY 68.9')).toBeTruthy()
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
