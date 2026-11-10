import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { BambooAccount, parseModels, serviceOrigin } from '../overrides/bamboo-account.mjs'
import { createBambooBridge } from '../overrides/bamboo-bridge.mjs'

const token = 'bbr-' + 'x'.repeat(43)
const device = 'd'.repeat(43)
const session = { email: 'member@example.test', email_verified: true, model_access: true,
  policy: { ready: true, accepted: true }, wallet: { balance: '10', reserved: '0.3', available: '9.7' } }
const model = { id: 'bamboo-test', name: 'Bamboo Test', provider: 'deepseek', max_output_tokens: 800,
  capabilities: { chat: true, tools: true, vision: false }, sell: { input: '0.12', output: '0.3', cache_read: '0.01' } }
const sse = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Read","arguments":"{}"}}]},"finish_reason":null}]}\n\n'
  + 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n'

async function fixture(t) {
  const calls = []
  const opened = []
  let saved = null
  let sessionReply = { status: 200, value: structuredClone(session) }
  let exchange = null
  let sessionWait = null
  let modelHandler = null
  const server = createServer((req, res) => {
    void (async () => {
      const buffers = []
      for await (const buffer of req) buffers.push(buffer)
      const text = Buffer.concat(buffers).toString('utf8')
      const body = text ? JSON.parse(text) : null
      calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body })
      if (req.url === '/v1/chat/completions') {
        if (modelHandler) { await modelHandler(req, res, body); return }
        res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(sse); return
      }
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/desktop/authorizations') {
        res.end(JSON.stringify({ device_code: device, user_code: 'ABCD-EFGH', verification_uri: origin + '/desktop/authorize', expires_in: 600, interval: 3 })); return
      }
      if (req.url === '/api/desktop/token') {
        if (exchange) await exchange.promise
        res.end(JSON.stringify({ token, key_id: 'device_key', expires_at: new Date(Date.now() + 86400000).toISOString() })); return
      }
      if (req.url === '/api/desktop/session' && req.method === 'GET') {
        const waiting = sessionWait
        sessionWait = null
        if (waiting) await waiting.promise
        res.statusCode = sessionReply.status; res.end(JSON.stringify(sessionReply.value)); return
      }
      if (req.url === '/api/desktop/models') { res.end(JSON.stringify([model, { ...model, id: 'image-only', capabilities: { images: true } }])); return }
      res.end(JSON.stringify({ ok: true }))
    })().catch(() => { res.statusCode = 500; res.end('{}') })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const storage = { assertAvailable() {}, read: async () => saved,
    write: async value => { saved = structuredClone(value) }, clear: async () => { saved = null } }
  const account = new BambooAccount({ site: origin, gateway: origin, storage, openExternal: async url => { opened.push(url) }, pollInterval: 60000 })
  t.after(() => { account.close(); server.closeAllConnections(); server.close() })
  return { account, origin, calls, opened, storage, saved: () => saved,
    session: value => { sessionReply = value }, waitSession: value => { sessionWait = value },
    exchange: value => { exchange = value }, modelHandler: value => { modelHandler = value } }
}

test('a slow refresh from a signed-out account cannot block the next sign-in', { timeout: 3000 }, async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  const pending = Promise.withResolvers()
  f.waitSession(pending)
  const oldRefresh = f.account.refresh(true)
  while (f.calls.filter(call => call.path === '/api/desktop/session' && call.method === 'GET').length < 2) await new Promise(resolve => setTimeout(resolve, 5))
  await f.account.signOut()
  f.session({ status: 200, value: { ...session, email: 'second@example.test' } })
  await f.account.signIn()
  try {
    await Promise.race([f.account.poll(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('sign-in blocked by stale refresh')), 1000); timer.unref() })])
    assert.equal(f.account.state().account.email, 'second@example.test')
    assert.equal(f.account.state().canCall, true)
  } finally { pending.resolve(); await oldRefresh }
})

test('sign-in opens only a public verification code, stores a device grant and restores it', async t => {
  const f = await fixture(t)
  await f.account.initialize()
  await Promise.all([f.account.signIn(), f.account.signIn()])
  assert.equal(f.calls.filter(call => call.path === '/api/desktop/authorizations').length, 1)
  assert.equal(f.opened[0], f.origin + '/desktop/authorize?code=ABCD-EFGH')
  assert.ok(!f.opened[0].includes(device))
  await f.account.poll()
  assert.equal(f.saved().token, token)
  assert.equal(f.account.state().status, 'signed-in')
  assert.equal(f.account.state().canCall, true)
  assert.deepEqual(f.account.state().models.map(value => value.id), ['bamboo-test'])
  assert.ok(!JSON.stringify(f.account.state()).includes(token))
  const restored = new BambooAccount({ site: f.origin, gateway: f.origin, storage: f.storage, openExternal: async () => {} })
  t.after(() => restored.close())
  assert.equal((await restored.initialize()).account.wallet.reserved, '0.3')
  await restored.signOut()
  assert.equal(f.saved(), null)
  assert.ok(f.calls.some(call => call.method === 'DELETE' && call.authorization === `Bearer ${token}`))
})

test('cancelling a token exchange revokes its late result without storing or publishing it', async t => {
  const f = await fixture(t)
  await f.account.signIn()
  const pending = Promise.withResolvers()
  f.exchange(pending)
  const polling = f.account.poll()
  while (!f.calls.some(call => call.path === '/api/desktop/token')) await new Promise(resolve => setTimeout(resolve, 5))
  await f.account.cancel()
  pending.resolve()
  await polling
  assert.equal(f.saved(), null)
  assert.equal(f.account.state().status, 'signed-out')
  assert.ok(f.calls.some(call => call.method === 'DELETE' && call.path === '/api/desktop/session'))
})

test('revocation clears credentials while a network failure preserves the connection for retry', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  f.session({ status: 503, value: { error: { code: 'database_unavailable' } } })
  assert.equal((await f.account.refresh(true)).canCall, false)
  assert.equal(f.saved().token, token)
  f.session({ status: 401, value: { error: { code: 'invalid_api_key' } } })
  assert.equal((await f.account.refresh(true)).status, 'signed-out')
  assert.equal(f.saved(), null)
})

test('account eligibility and a stale account generation stop requests before gateway dispatch', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  await assert.rejects(f.account.inference({ model: model.id }, -1, new AbortController().signal), /account changed/)
  f.session({ status: 200, value: { ...session, wallet: { balance: '0', reserved: '0', available: '0' } } })
  await f.account.refresh(true)
  await assert.rejects(f.account.inference({ model: model.id }, f.account.generation, new AbortController().signal), /Add funds/)
  assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, 0)
})

test('authenticated Host proxy preserves tool SSE and does not expose or accept browser credentials', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  const bridge = await createBambooBridge(f.account)
  t.after(() => bridge.close())
  assert.equal((await fetch(bridge.url + '/catalog')).status, 401)
  assert.equal((await fetch(bridge.url + '/catalog', { headers: { authorization: `Bearer ${bridge.token}`, origin: 'https://evil.example' } })).status, 401)
  const catalog = await fetch(bridge.url + '/catalog', { headers: { authorization: `Bearer ${bridge.token}` } }).then(res => res.json())
  assert.ok(!JSON.stringify(catalog).includes(token))
  const response = await fetch(`${bridge.url}/session/${catalog.generation}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.id, stream: true, messages: [{ role: 'user', content: 'Read hello.txt' }] }),
  })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), sse)
  assert.equal(f.calls.find(call => call.path === '/v1/chat/completions').authorization, `Bearer ${token}`)
})

test('gateway failures are not retried and upstream diagnostics are not exposed', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  f.modelHandler((_req, res) => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'upstream_error', message: 'private-provider-credential' } })) })
  const bridge = await createBambooBridge(f.account)
  t.after(() => bridge.close())
  const response = await fetch(`${bridge.url}/session/${f.account.generation}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: model.id, stream: true }),
  })
  const body = await response.text()
  assert.equal(response.status, 502)
  assert.ok(body.includes('Check request history'))
  assert.ok(!body.includes('private-provider-credential'))
  assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, 1)
})

test('cancelling a Host stream aborts the corresponding upstream request', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  const closed = Promise.withResolvers()
  f.modelHandler((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[]}\n\n'); res.once('close', () => closed.resolve()) })
  const bridge = await createBambooBridge(f.account)
  t.after(() => bridge.close())
  const abort = new AbortController()
  const response = await fetch(`${bridge.url}/session/${f.account.generation}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: model.id, stream: true }), signal: abort.signal,
  })
  const reader = response.body.getReader()
  await reader.read()
  abort.abort()
  await assert.rejects(reader.read())
  await Promise.race([closed.promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('upstream not cancelled')), 1500); timer.unref() })])
})

test('service origins and catalog capabilities are validated before use', () => {
  for (const origin of ['http://remote.example', 'https://user:secret@bambooroute.com', 'https://bambooroute.com/other', 'file:///tmp']) assert.throws(() => serviceOrigin(origin))
  assert.equal(serviceOrigin('https://bambooroute.com/'), 'https://bambooroute.com')
  assert.throws(() => parseModels([{ ...model, max_output_tokens: -1 }]))
  assert.deepEqual(parseModels([{ ...model, capabilities: { chat: true, tools: false } }]), [])
})
