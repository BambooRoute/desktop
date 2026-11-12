import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BambooAccountPanel } from '../../../packages/client/ui-settings-account/src/client/BambooAccount.tsx'
import type { BambooApi, BambooState } from '../src/bamboo-types.ts'

afterEach(() => { cleanup(); delete (window as unknown as { bambooAccount?: BambooApi }).bambooAccount })

function fixture(currency: 'USD' | 'CNY' = 'USD', activeCalls = 0) {
  const wallets = [
    { currency: 'USD' as const, balance: '10', reserved: '0.3', available: '9.7' },
    { currency: 'CNY' as const, balance: '70', reserved: '1.1', available: '68.9' },
  ]
  const state: BambooState = { status: 'signed-in', canCall: true, activeCalls,
    account: { email: 'member@example.test', emailVerified: true, modelAccess: true, policyReady: true, policyAccepted: true,
      currency, wallets, wallet: wallets.find(wallet => wallet.currency === currency)!, topupCurrencies: ['USD'] },
    models: [{ id: 'model', name: 'Model', provider: 'deepseek', maxOutput: 800, vision: false, currency, prices: { input: '0.123456789', output: '1.23' } }],
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
  render(<BambooAccountPanel />)
  await screen.findByText('CNY 68.9')
  expect(within(screen.getByRole('region', { name: 'USD wallet' })).getByText('USD 9.7')).toBeTruthy()
  expect(screen.getByText('CNY 0.123456789')).toBeTruthy()
  expect(screen.getByText('Online CNY top-ups are not available. Open billing to check funding options.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Add .* funds/ })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'View CNY billing' })) })
  expect(f.api.openPage).toHaveBeenCalledWith('billing')
})

it('requests browser confirmation for another billing currency and pauses switching during calls', async () => {
  const f = fixture()
  render(<BambooAccountPanel />)
  const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Billing currency' })
  fireEvent.change(select, { target: { value: 'CNY' } })
  expect(screen.getByText('Confirm CNY access in your browser. Your current connection stays available if you cancel.')).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change billing currency' })) })
  expect(f.api.signIn).toHaveBeenCalledWith('CNY')
  await act(async () => { f.update({ ...f.state, activeCalls: 1 }) })
  expect(select.disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Change billing currency' }).disabled).toBe(true)
})

it('shows the currency being authorized and offers cancellation while waiting', async () => {
  const f = fixture()
  render(<BambooAccountPanel />)
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
  render(<BambooAccountPanel />)
  expect(await screen.findByText('No models supporting chat and tools are available for CNY billing. Choose another billing currency or check again later.')).toBeTruthy()
  expect(screen.queryByText('USD 0.123456789')).toBeNull()
})
