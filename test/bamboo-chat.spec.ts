import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { idleWatchdog } from '@deepseek-ai/dsh-timeout'
import { afterEach, expect, it, vi } from 'vitest'
import { BambooAdapter } from '../src/bamboo.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

vi.mock('@deepseek-ai/dsh-timeout', async (importOriginal) => {
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-timeout')>()
  return { ...original, idleWatchdog: vi.fn(original.idleWatchdog) }
})

const chat = { id: 'chat', name: 'Bamboo Chat', provider: 'deepseek', maxOutput: 1024, vision: false, tools: false, currency: 'USD', prices: {} }
const agent = { ...chat, id: 'agent', name: 'Bamboo Agent', tools: true }
const catalog = { body: JSON.stringify({ generation: 1, models: [chat, agent] }) }
const messages = [createUserMessage({ content: [{ type: 'text', text: 'Say hello.' }], source: { kind: 'user' } })]
const tool = { name: 'read', description: 'Read a local file', parameters: { type: 'object' as const, properties: {} } }

async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

afterEach(closeMockServers)

it('lists original model names and sends tools only to models that support them', async () => {
  const server = await mockServer([catalog, catalog, { events: textEvents }, catalog, { events: textEvents }])
  const adapter = new BambooAdapter(new Context(), { url: server.url, token: 'mock-token' })

  const models = await adapter.listModels('bamboo')
  expect(models.map(({ name }) => name)).toEqual(['Bamboo Chat', 'Bamboo Agent'])

  const prepared = await adapter.prepareCall('bamboo', 'chat')
  expect(prepared.model.name).toBe('Bamboo Chat')
  const chatResult = await collect(prepared.stream({ provider: 'bamboo', model: 'chat', messages, tools: [tool] }))
  expect(chatResult).toContainEqual({ type: 'text-delta', index: 0, text: 'hello' })
  expect(chatResult.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(server.requests[2]).not.toHaveProperty('tools')
  expect(server.requests[2]).toMatchObject({ model: 'chat', messages: [{ role: 'system', content: expect.stringContaining('Workspace tools are disabled') }, { role: 'user', content: 'Say hello.' }] })

  await collect(adapter.stream({ provider: 'bamboo', model: 'agent', messages, tools: [tool] }))
  expect(server.requests[4]).toMatchObject({ model: 'agent', tools: [{ type: 'function', function: { name: 'read' } }] })
  expect(server.paths).toEqual(['/catalog', '/catalog', '/session/1/v1/chat/completions', '/catalog', '/session/1/v1/chat/completions'])
})

it('rejects plan mode and unsolicited tool calls for a model without tool support', async () => {
  const toolEvents = [
    '{"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_mock","type":"function","function":{"name":"read","arguments":"{}"}}]},"finish_reason":null}]}',
    '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    '[DONE]',
  ]
  const server = await mockServer([catalog, catalog, { events: toolEvents }])
  const adapter = new BambooAdapter(new Context(), { url: server.url, token: 'mock-token' })
  const options = { provider: 'bamboo', model: 'chat', messages }

  await expect(collect(adapter.stream({ ...options, tools: [{ ...tool, name: 'exit_plan_mode' }] }))).rejects.toThrow('Plan mode requires a model with tool calling')
  expect(server.paths).toEqual(['/catalog'])
  const delivered: StreamChunk[] = []
  await expect((async () => {
    for await (const chunk of adapter.stream(options)) delivered.push(chunk)
  })()).rejects.toThrow('The model returned an unsupported tool call')
  expect(delivered).toEqual([])
})

it('waits for a quiet model that sends only a final text answer', async () => {
  const original = await vi.importActual<typeof import('@deepseek-ai/dsh-timeout')>('@deepseek-ai/dsh-timeout')
  vi.mocked(idleWatchdog).mockImplementation((signal, _timeout, code) => original.idleWatchdog(signal, 15, code))
  try {
    const server = await mockServer([catalog, { events: textEvents, delayMs: 75 }])
    const adapter = new BambooAdapter(new Context(), { url: server.url, token: 'mock-token' })
    const chunks = await collect(adapter.stream({ provider: 'bamboo', model: 'chat', messages }))
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'hello' })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  } finally {
    vi.mocked(idleWatchdog).mockReset()
  }
})
