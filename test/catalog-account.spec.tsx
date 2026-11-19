import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '../../../packages/client/store/src/index.ts'
import { watchBambooCatalog } from '../../../packages/client/ui-model-selection/src/client/bamboo-account.ts'
import type { ModelDirectoryState } from '../../../packages/client/ui-model-selection/src/client/directory.ts'
import { en } from '../../../packages/client/ui-model-selection/src/client/locales.ts'
import { ModelSelect } from '../../../packages/client/ui-model-selection/src/client/ModelSelect.tsx'

afterEach(cleanup)

it('selects an offered effort and can restore the default after all efforts are removed', async () => {
  const model = { id: 'fixture', name: 'Fixture' }
  const group = { id: 'bamboo', name: 'Bamboo' }
  const current = { provider: group.id, model: model.id }
  const directory = createSnapshotStore<ModelDirectoryState>({
    current, groups: [{ ...group, models: [{ ...model, reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }],
    routable: true, failures: [], pending: null, status: 'ready', error: null,
  })
  const select = vi.fn(async (selection: NonNullable<ModelDirectoryState['current']>) => {
    directory.update(state => { state.current = selection })
    return { ok: true as const, value: undefined }
  })
  render(<ModelSelect available locked={false} directory={directory} load={vi.fn()} select={select}
    resolveText={text => typeof text === 'string' ? text : text.en}
    t={key => en[key as keyof typeof en] ?? key} renderSlot={(_name, _owner, options) => options?.fallback ?? null} />)
  const trigger = screen.getByRole('button')
  const openEfforts = () => {
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /Effort/ }))
    return screen.getAllByRole('menuitemradio').map(row => row.textContent)
  }
  expect(openEfforts()).toEqual(['Default', 'High'])
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
  await waitFor(() => expect(screen.queryByRole('menuitemradio')).toBeNull())
  expect(select).toHaveBeenLastCalledWith({ ...current, reasoningEffort: 'high' })
  act(() => directory.update(state => { state.groups = [{ ...group, models: [model] }] }))
  expect(openEfforts()).toEqual(['Default'])
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Default' }))
  await waitFor(() => expect(screen.queryByRole('menuitemradio')).toBeNull())
  expect(select).toHaveBeenLastCalledWith(current)
  fireEvent.click(trigger)
  expect(screen.queryByRole('menuitem', { name: /Effort/ })).toBeNull()
})

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
