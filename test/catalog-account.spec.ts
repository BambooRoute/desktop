import { expect, it, vi } from 'vitest'
import { watchBambooCatalog } from '../../../packages/client/ui-model-selection/src/client/bamboo-account.ts'

it('invalidates an empty catalog after sign-in, account changes and sign-out', async () => {
  let receive: (state: { status: string; models: unknown[]; account?: { email: string; currency: string } }) => void = () => {}
  const unsubscribe = vi.fn()
  const refresh = vi.fn()
  const stop = watchBambooCatalog({
    state: async () => ({ status: 'signed-out', models: [] }),
    subscribe(listener) { receive = listener; return unsubscribe },
  }, refresh)
  await Promise.resolve()
  const state = { status: 'signed-in', models: [{ id: 'model-a' }], account: { email: 'first@example.test', currency: 'USD' } }
  receive(state)
  receive(state)
  expect(refresh).toHaveBeenCalledTimes(2)
  receive({ ...state, account: { email: 'first@example.test', currency: 'CNY' } })
  receive({ status: 'signed-out', models: [] })
  expect(refresh).toHaveBeenCalledTimes(4)
  stop()
  receive(state)
  expect(refresh).toHaveBeenCalledTimes(4)
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it('ignores an initial response that arrives after a live account update', async () => {
  const initial = Promise.withResolvers<{ status: string; models: unknown[] }>()
  const refresh = vi.fn()
  const stop = watchBambooCatalog({
    state: () => initial.promise,
    subscribe(listener) { listener({ status: 'signed-in', models: [{ id: 'model-a' }] }); return () => {} },
  }, refresh)
  initial.resolve({ status: 'signed-out', models: [] })
  await Promise.resolve()
  expect(refresh).toHaveBeenCalledTimes(1)
  stop()
})
