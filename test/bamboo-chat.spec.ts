import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { idleWatchdog } from '@deepseek-ai/dsh-timeout'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { BambooAdapter } from '../src/bamboo.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

vi.mock('@deepseek-ai/dsh-timeout', async (importOriginal) => {
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-timeout')>()
  return { ...original, idleWatchdog: vi.fn(original.idleWatchdog) }
})

const chat = { id: 'chat', name: 'Bamboo Chat', provider: 'deepseek', contextWindow: 65_536, maxOutput: 1024, vision: false, tools: false, currency: 'USD', prices: {} }
const agent = { ...chat, id: 'agent', name: 'Bamboo Agent', contextWindow: 1_000_000, maxOutput: 128_000, tools: true }
const catalog = { body: JSON.stringify({ generation: 1, status: 'signed-in', models: [chat, agent] }) }
const messages = [createUserMessage({ content: [{ type: 'text', text: 'Say hello.' }], source: { kind: 'user' } })]
const tool = { name: 'read', description: 'Read a local file', parameters: { type: 'object' as const, properties: {} } }

async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

afterEach(closeMockServers)

it('uses each model’s token limits and sends tools only to models that support them', async () => {
  const server = await mockServer([catalog, catalog, { events: textEvents }, catalog, { events: textEvents }])
  const adapter = new BambooAdapter(new Context(), { url: server.url, token: 'mock-token' })

  const models = await adapter.listModels('bamboo')
  expect(models.map(({ name }) => name)).toEqual(['Bamboo Chat', 'Bamboo Agent'])

  const prepared = await adapter.prepareCall('bamboo', 'chat')
  expect(prepared.model).toMatchObject({ name: 'Bamboo Chat', context: { contextWindow: 65_536 }, defaultMaxTokens: 1024 })
  const chatResult = await collect(prepared.stream({ provider: 'bamboo', model: 'chat', messages, tools: [tool] }))
  expect(chatResult).toContainEqual({ type: 'text-delta', index: 0, text: 'hello' })
  expect(chatResult.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  expect(server.requests[2]).not.toHaveProperty('tools')
  expect(server.requests[2]).toMatchObject({ model: 'chat', max_tokens: 1024, messages: [{ role: 'system', content: expect.stringContaining('Workspace tools are disabled') }, { role: 'user', content: 'Say hello.' }] })

  const toolCall = await adapter.prepareCall('bamboo', 'agent')
  expect(toolCall.model).toMatchObject({ context: { contextWindow: 1_000_000 }, defaultMaxTokens: 128_000 })
  await collect(toolCall.stream({ provider: 'bamboo', model: 'agent', messages, tools: [tool] }))
  expect(server.requests[4]).toMatchObject({ model: 'agent', max_tokens: 128_000, tools: [{ type: 'function', function: { name: 'read' } }] })
  expect(server.paths).toEqual(['/catalog', '/catalog', '/session/1/v1/chat/completions', '/catalog', '/session/1/v1/chat/completions'])
})

it('refreshes token limits when the catalog changes within a signed-in session', async () => {
  const updated = { ...agent, contextWindow: 200_000, maxOutput: 64_000 }
  const server = await mockServer([catalog, { body: JSON.stringify({ generation: 1, status: 'signed-in', models: [chat, updated] }) }])
  const adapter = new BambooAdapter(new Context(), { url: server.url, token: 'mock-token' })

  await expect(adapter.resolveModel('bamboo', 'agent')).resolves.toMatchObject({
    context: { contextWindow: 1_000_000 }, defaultMaxTokens: 128_000,
  })
  await expect(adapter.resolveModel('bamboo', 'agent')).resolves.toMatchObject({
    context: { contextWindow: 200_000 }, defaultMaxTokens: 64_000,
  })
})

it('distinguishes a signed-in account without a usable model from a signed-out account', async () => {
  const server = await mockServer([
    catalog,
    { body: JSON.stringify({ generation: 1, status: 'signed-in', models: [] }) },
    { body: JSON.stringify({ generation: 1, status: 'signed-in', models: [], error: 'Could not reach Bamboo.' }) },
    { body: JSON.stringify({ generation: 2, status: 'signed-out', models: [] }) },
  ])
  const adapter = new BambooAdapter(new Context(), { url: server.url, token: 'mock-token' })

  await expect(adapter.resolveModel('bamboo', 'removed')).rejects.toMatchObject({
    code: 'UNKNOWN_MODEL', message: expect.stringContaining('selected Bamboo model is unavailable'),
  })
  await expect(adapter.prepareCall('bamboo', 'chat')).rejects.toMatchObject({
    code: 'UNKNOWN_MODEL', message: expect.stringContaining('no available chat models'),
  })
  await expect(adapter.prepareCall('bamboo', 'chat')).rejects.toMatchObject({
    code: 'TRANSPORT', message: 'Could not reach Bamboo.',
  })
  await expect(adapter.prepareCall('bamboo', 'chat')).rejects.toMatchObject({
    code: 'MISSING_CREDENTIAL', message: expect.stringContaining('Sign in to Bamboo'),
  })
  expect(server.paths).toEqual(['/catalog', '/catalog', '/catalog', '/catalog'])
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

it('shows a gateway model refusal and identifies the request', async () => {
  const requestId = 'req_' + 'b'.repeat(32)
  let calls = 0
  const server = createServer((request, response) => {
    if (request.url === '/catalog') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(catalog.body)
      return
    }
    request.resume()
    calls++
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': requestId })
    const failure = {
      type: 'error',
      error: { type: 'upstream_refused', code: 'upstream_refused', message: 'The model declined this request. Revise the message and try again.', request_id: requestId },
      partial: false,
    }
    response.end(`event: error\ndata: ${JSON.stringify(failure)}\n\n`)
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to an IP port')
    const adapter = new BambooAdapter(new Context(), { url: `http://127.0.0.1:${address.port}`, token: 'mock-token' })
    const chunks = await collect(adapter.stream({ provider: 'bamboo', model: 'chat', messages }))
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM_REFUSED', requestId, message: expect.stringContaining(requestId) } },
    })
    expect(calls).toBe(1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
})
