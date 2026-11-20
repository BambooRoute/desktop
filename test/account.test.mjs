import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { BambooAccount, parseModels, serviceOrigin } from '../overrides/bamboo-account.mjs'
import { createBambooBridge } from '../overrides/bamboo-bridge.mjs'

const legacyToken = 'bbr-' + 'x'.repeat(43)
const token = 'bbr-' + 'y'.repeat(43)
const device = 'd'.repeat(43)
const session = { email: 'member@example.test', email_verified: true, model_access: true,
  policy: { ready: true, accepted: true }, currency: 'CNY', topup_currencies: ['USD'], wallets: [
    { currency: 'USD', balance: '10', reserved: '0.3', available: '9.7' },
    { currency: 'CNY', balance: '70', reserved: '1.1', available: '68.9' }]  }
const model = { currency: 'CNY', id: 'bamboo-test', name: 'Bamboo Test', provider: 'openai', max_output_tokens: 800,
  context_window_tokens: 65_536, capabilities: { vendor: 'deepseek', chat: true, tools: true, vision: false }, sell: { input: '0.12', output: '0.3', cache_read: '0.01' } }
const sse = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Read","arguments":"{}"}}]},"finish_reason":null}]}\n\n'
  + 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n'

async function fixture(t) {
  const calls = []
  const opened = []
  let saved = null
  let sessionReply = null
  let requestedCurrency
  let tokenCurrency = null
  let catalogReply = null
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
        requestedCurrency = body.currency
        res.end(JSON.stringify({ device_code: device, currency: requestedCurrency, user_code: 'ABCD-EFGH', verification_uri: origin + '/desktop/authorize', expires_in: 600, interval: 3 })); return
      }
      if (req.url === '/api/desktop/token') {
        const currency = requestedCurrency
        if (exchange) await exchange.promise
        res.end(JSON.stringify({ token: currency === 'CNY' ? token : legacyToken, currency: tokenCurrency || currency, key_id: 'device_key', expires_at: new Date(Date.now() + 86400000).toISOString() })); return
      }
      if (req.url === '/api/desktop/session' && req.method === 'GET') {
        const waiting = sessionWait
        sessionWait = null
        if (waiting) await waiting.promise
        const reply = sessionReply || { status: 200, value: { ...session, currency: req.headers.authorization === `Bearer ${token}` ? 'CNY' : 'USD' } }
        res.statusCode = reply.status; res.end(JSON.stringify(reply.value)); return
      }
      if (req.url === '/api/desktop/models') {
        const currency = req.headers.authorization === `Bearer ${token}` ? 'CNY' : 'USD'
        res.end(JSON.stringify(catalogReply || [{ ...model, currency }, { ...model, currency, id: 'image-only', capabilities: { images: true } }])); return
      }
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
    session: value => { sessionReply = value }, tokenCurrency: value => { tokenCurrency = value }, catalog: value => { catalogReply = value }, waitSession: value => { sessionWait = value },
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
  const authorizations = f.calls.filter(call => call.path === '/api/desktop/authorizations')
  assert.equal(authorizations.length, 1)
  assert.equal(authorizations[0].body.currency, 'CNY')
  assert.equal(f.opened[0], f.origin + '/desktop/authorize?code=ABCD-EFGH')
  assert.ok(!f.opened[0].includes(device))
  await f.account.poll()
  assert.equal(f.saved().token, token)
  assert.equal(f.account.state().status, 'signed-in')
  assert.equal(f.account.state().canCall, true)
  assert.deepEqual(f.account.state().models.map(value => value.id), ['bamboo-test'])
  assert.equal(f.account.state().models[0].vendor, 'deepseek')
  assert.equal(f.account.state().models[0].provider, 'openai')
  assert.ok(!JSON.stringify(f.account.state()).includes(token))
  const restored = new BambooAccount({ site: f.origin, gateway: f.origin, storage: f.storage, openExternal: async () => {} })
  t.after(() => restored.close())
  assert.equal((await restored.initialize()).account.wallet.reserved, '1.1')
  await restored.signIn()
  assert.equal(f.calls.filter(call => call.path === '/api/desktop/authorizations').length, 1)
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
  const unavailable = await f.account.refresh(true)
  assert.equal(unavailable.canCall, false)
  assert.equal(unavailable.errorKey, 'request_unconfirmed')
  assert.equal(f.saved().token, token)
  f.session({ status: 401, value: { error: { code: 'invalid_api_key' } } })
  const revoked = await f.account.refresh(true)
  assert.equal(revoked.status, 'signed-out')
  assert.equal(revoked.errorKey, 'invalid_api_key')
  assert.equal(f.saved(), null)
})

test('account eligibility and a stale account generation stop requests before gateway dispatch', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  await assert.rejects(f.account.inference({ model: model.id }, -1, new AbortController().signal), /account changed/)
  f.session({ status: 200, value: { ...session, wallets: [session.wallets[0], { currency: 'CNY', balance: '0', reserved: '0', available: '0' }] } })
  assert.equal((await f.account.refresh(true)).noticeKey, 'wallet_empty')
  await assert.rejects(f.account.inference({ model: model.id }, f.account.generation, new AbortController().signal), /CNY wallet has no available funds/)
  assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, 0)
})

test('wallet debt stays visible, blocks calls and recovers after a positive top-up', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  const wallet = { currency: 'CNY', balance: '-0.123456789', reserved: '0', available: '-0.123456789' }
  f.session({ status: 200, value: { ...session, wallets: [wallet] } })
  const indebted = await f.account.refresh(true)
  assert.equal(indebted.status, 'signed-in')
  assert.deepEqual(indebted.account.wallet, wallet)
  assert.equal(indebted.noticeKey, 'wallet_empty')
  assert.equal(indebted.canCall, false)
  await assert.rejects(f.account.inference({ model: model.id }, f.account.generation, new AbortController().signal), /CNY wallet has no available funds/)
  assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, 0)
  f.session({ status: 200, value: { ...session, wallets: [{ ...wallet, balance: '0.000000001', available: '0.000000001' }] } })
  assert.equal((await f.account.refresh(true)).canCall, true)
  f.session({ status: 200, value: { ...session, wallets: [{ ...wallet, reserved: '-1' }] } })
  const invalid = await f.account.refresh(true)
  assert.equal(invalid.errorKey, 'invalid_account')
  assert.equal(invalid.canCall, false)
  assert.throws(() => parseModels([{ ...model, sell: { input: '-0.1' } }]), { code: 'invalid_catalog' })
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
  const requestID = 'req_' + 'a'.repeat(32)
  f.modelHandler((_req, res) => { res.writeHead(502, { 'content-type': 'application/json', 'x-request-id': requestID }); res.end(JSON.stringify({ error: { code: 'upstream_error', message: 'private-provider-credential' } })) })
  const bridge = await createBambooBridge(f.account)
  t.after(() => bridge.close())
  const response = await fetch(`${bridge.url}/session/${f.account.generation}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: model.id, stream: true }),
  })
  const body = await response.text()
  assert.equal(response.status, 502)
  assert.equal(response.headers.get('x-request-id'), requestID)
  assert.equal(JSON.parse(body).error.request_id, requestID)
  assert.ok(JSON.parse(body).error.message.includes(requestID))
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
  const [chat] = parseModels([{ ...model, capabilities: { chat: true, tools: false } }])
  assert.equal(chat.tools, false)
  assert.equal(chat.vendor, undefined)
  assert.deepEqual(chat.reasoningEfforts, [])
  const capabilities = { chat: true, reasoning_efforts: ['none', 'high'] }
  assert.deepEqual(parseModels([{ ...model, capabilities }])[0].reasoningEfforts, ['none', 'high'])
  assert.throws(() => parseModels([{ ...model, capabilities: { ...capabilities, reasoning_efforts: 'high' } }]), { code: 'invalid_catalog' })
  assert.deepEqual(parseModels([{ ...model, capabilities: { chat: false, images: true } }]), [])
})

test('the catalog uses per-model token limits and allows independent input limits', () => {
  const models = parseModels([
    { ...model, id: 'claude-opus-5-5', context_window_tokens: 1_000_000, max_input_tokens: 872_000, max_output_tokens: 128_000 },
    { ...model, id: 'gemini-3.5-flash', context_window_tokens: null, max_input_tokens: 1_048_576, max_output_tokens: 65_536 },
    { ...model, id: 'missing-limits', context_window_tokens: null },
  ])
  assert.deepEqual(models.map(({ id, contextWindow, maxOutput }) => [id, contextWindow, maxOutput]), [
    ['claude-opus-5-5', 1_000_000, 128_000],
    ['gemini-3.5-flash', 1_048_576, 65_536],
  ])
})

async function restoreLegacyCredential(f) {
  await f.storage.write({ site: f.origin, gateway: f.origin, token: legacyToken, keyId: 'legacy_device', currency: 'USD',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
  return f.account.initialize()
}

test('a saved USD device needs CNY authorization before the desktop can call models', async t => {
  const f = await fixture(t)
  const state = await restoreLegacyCredential(f)
  assert.equal(state.status, 'signed-out')
  assert.equal(state.noticeKey, 'connect_cny_wallet')
  assert.deepEqual((await f.account.catalog()).models, [])
  assert.deepEqual(f.calls, [])
  await assert.rejects(f.account.inference({ model: model.id }, f.account.generation, new AbortController().signal), /Sign in to Bamboo/)
  const generation = f.account.generation
  await f.account.signIn()
  assert.equal(f.account.state().status, 'waiting')
  assert.equal(f.saved().currency, 'USD')
  await f.account.poll()
  assert.equal(f.saved().token, token)
  assert.equal(f.saved().currency, 'CNY')
  assert.equal(f.account.state().account.wallet.available, '68.9')
  assert.equal(f.account.state().account.canTopUp, false)
  assert.equal(f.account.state().models[0].currency, 'CNY')
  assert.ok(f.calls.some(call => call.method === 'DELETE' && call.authorization === `Bearer ${legacyToken}`))
  await assert.rejects(f.account.inference({ model: model.id }, generation, new AbortController().signal), /account changed/)
  const call = await f.account.inference({ model: model.id, stream: true }, f.account.generation, new AbortController().signal)
  await call.response.text(); call.release()
  assert.equal(f.calls.find(call => call.path === '/v1/chat/completions').authorization, `Bearer ${token}`)
  await f.account.openPage('billing'); await f.account.openPage('requests')
  assert.deepEqual(f.opened.slice(-2), [f.origin + '/billing?currency=CNY', f.origin + '/requests?currency=CNY'])
})

test('cancelling CNY reconnection keeps the USD grant inactive and revokes a late CNY grant', async t => {
  const f = await fixture(t)
  await restoreLegacyCredential(f)
  await f.account.signIn()
  const pending = Promise.withResolvers()
  f.exchange(pending)
  const polling = f.account.poll()
  while (!f.calls.some(call => call.path === '/api/desktop/token')) await new Promise(resolve => setTimeout(resolve, 5))
  await f.account.cancel()
  pending.resolve(); await polling
  assert.equal(f.saved().token, legacyToken)
  assert.equal(f.account.state().status, 'signed-out')
  assert.equal(f.account.state().noticeKey, 'connect_cny_wallet')
  assert.ok(f.calls.some(call => call.method === 'DELETE' && call.authorization === `Bearer ${token}`))
  assert.ok(!f.calls.some(call => call.authorization === `Bearer ${legacyToken}`))
})

test('cancelling while saving a CNY grant restores the stored USD grant for a later attempt', async t => {
  const f = await fixture(t)
  await restoreLegacyCredential(f)
  const originalWrite = f.storage.write
  const saving = Promise.withResolvers()
  const proceed = Promise.withResolvers()
  f.storage.write = async value => {
    if (value.currency === 'CNY') { saving.resolve(); await proceed.promise }
    await originalWrite(value)
  }
  await f.account.signIn()
  const polling = f.account.poll()
  await saving.promise
  const cancelling = f.account.cancel()
  proceed.resolve()
  await Promise.all([polling, cancelling])
  assert.equal(f.saved().currency, 'USD')
  assert.equal(f.account.state().status, 'signed-out')
  assert.equal(f.account.state().canCall, false)
})

test('a grant with a mismatched currency is revoked without activating the saved USD grant', async t => {
  const f = await fixture(t)
  await restoreLegacyCredential(f)
  await f.account.signIn()
  f.tokenCurrency('USD')
  await f.account.poll()
  assert.equal(f.saved().token, legacyToken)
  assert.equal(f.account.state().status, 'signed-out')
  assert.match(f.account.state().error, /could not be confirmed/)
  assert.ok(f.calls.some(call => call.method === 'DELETE' && call.authorization === `Bearer ${token}`))
  assert.ok(!f.calls.some(call => call.authorization === `Bearer ${legacyToken}`))
})

test('missing or mixed currency account and catalog data cannot dispatch a call', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  for (const reply of [
    { ...session, currency: undefined },
    { ...session, wallets: [session.wallets[0]] },
    { ...session, wallets: [session.wallets[1], session.wallets[1]] },
    { ...session, currency: 'USD' },
  ]) {
    f.session({ status: 200, value: reply })
    assert.equal((await f.account.refresh(true)).canCall, false)
  }
  f.session(null); f.catalog([{ ...model, currency: 'USD' }])
  assert.equal((await f.account.refresh(true)).canCall, false)
  await assert.rejects(f.account.inference({ model: model.id }, f.account.generation, new AbortController().signal), /invalid model list/)
  assert.equal(f.calls.filter(call => call.path === '/v1/chat/completions').length, 0)
  assert.throws(() => parseModels([{ ...model, currency: undefined }]))
})

test('CNY funding and model eligibility depend on the CNY wallet and prices', async t => {
  const f = await fixture(t)
  await f.account.signIn(); await f.account.poll()
  f.session({ status: 200, value: { ...session, topup_currencies: [], wallets: [session.wallets[0], { currency: 'CNY', balance: '0', reserved: '0', available: '0' }] } })
  assert.equal((await f.account.refresh(true)).canCall, false)
  assert.match(f.account.state().notice, /CNY wallet has no available funds/)
  f.session({ status: 200, value: { ...session, topup_currencies: ['CNY'], wallets: [session.wallets[1]] } })
  const funded = await f.account.refresh(true)
  assert.equal(funded.canCall, true)
  assert.equal(funded.account.canTopUp, true)
  f.catalog([])
  assert.equal((await f.account.refresh(true)).canCall, false)
  assert.equal(f.account.state().notice, 'No chat models are available for CNY billing. Check again later.')
  assert.deepEqual(await f.account.catalog(), { generation: f.account.generation, status: 'signed-in', models: [] })
})
