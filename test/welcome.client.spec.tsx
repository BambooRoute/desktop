import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Welcome } from '../src/client/WelcomePage.tsx'
import type { BambooApi, BambooState } from '../src/bamboo-types.ts'

afterEach(cleanup)

function fixture(initial: BambooState = { status: 'signed-out', models: [], canCall: false }) {
  let receive: (value: BambooState) => void = () => {}
  const account: BambooApi = { state: vi.fn(async () => initial), signIn: vi.fn(async () => initial), cancel: vi.fn(async () => initial),
    refresh: vi.fn(async () => initial), signOut: vi.fn(async () => initial), openPage: vi.fn(async () => {}), openBrowser: vi.fn(async () => {}),
    subscribe(listener) { receive = listener; return () => { receive = () => {} } },
  }
  return { account, update: (state: BambooState) => receive(state) }
}

it('starts browser sign-in once and shows the code without a credential field', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<BambooState>()
  vi.mocked(f.account.signIn).mockReturnValue(pending.promise)
  render(<Welcome api={{ skip: vi.fn() }} account={f.account} />)
  await act(async () => {})
  const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Sign in to Bamboo' })
  fireEvent.click(button); fireEvent.click(button)
  expect(f.account.signIn).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  await act(async () => {
    const state: BambooState = { status: 'waiting', models: [], canCall: false, code: 'ABCD-EFGH' }
    f.update(state); pending.resolve(state)
  })
  expect(screen.getByText('ABCD-EFGH')).toBeTruthy()
  expect(document.querySelector('input')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
  expect(f.account.cancel).toHaveBeenCalledTimes(1)
})

it('opens after sign-in and permits retry without private diagnostics', async () => {
  const f = fixture()
  const skip = vi.fn().mockRejectedValueOnce(new Error('private token')).mockResolvedValueOnce(undefined)
  render(<Welcome api={{ skip }} account={f.account} />)
  await act(async () => {})
  await act(async () => { f.update({ status: 'signed-in', models: [], canCall: false }) })
  expect(skip).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert').textContent).toBe('The workspace could not open. Please try again.')
  expect(document.body.textContent).not.toContain('private token')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open workspace' })) })
  expect(skip).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('disposes its subscription when the welcome window closes', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<BambooState>()
  vi.mocked(f.account.signIn).mockReturnValue(pending.promise)
  const view = render(<Welcome api={{ skip: vi.fn() }} account={f.account} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to Bamboo' }))
  view.unmount()
  await act(async () => { pending.reject(new Error('closed')) })
  expect(document.body.textContent).toBe('')
})
