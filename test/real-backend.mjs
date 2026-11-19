import assert from 'node:assert/strict'
import { BambooAccount } from '../overrides/bamboo-account.mjs'
import { createBambooBridge } from '../overrides/bamboo-bridge.mjs'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const { origin, cookies } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const headers = {
  'content-type': 'application/json', origin,
  cookie: cookies.map(cookie => `${cookie.Name}=${cookie.Value}`).join('; '),
  'x-csrf-token': cookies.find(cookie => cookie.Name === 'relay_csrf').Value,
}
const opened = []
let approve = false
let saved = null
const storage = {
  assertAvailable() {}, read: async () => saved,
  write: async value => { saved = structuredClone(value) },
  clear: async () => { saved = null },
}
async function approveDevice(code, currency) {
  const path = `/api/desktop/authorizations/${code}`
  const details = await fetch(origin + path, { headers })
  assert.equal(details.status, 200)
  assert.equal((await details.json()).currency, currency)
  const response = await fetch(origin + path, { method: 'POST', headers, body: JSON.stringify({ approve: true }) })
  assert.equal(response.status, 200)
}

async function deviceRequest(path, body, status) {
  const response = await fetch(origin + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  assert.equal(response.status, status)
  return response.json()
}

const account = new BambooAccount({
  site: origin, gateway: origin, storage, pollInterval: 60000,
  openExternal: async value => {
    const url = new URL(value)
    opened.push(value)
    assert.equal(url.origin, origin)
    if (url.pathname !== '/connect/authorize' || !approve) return
    await approveDevice(url.searchParams.get('code'), 'CNY')
  },
})
const bridge = await createBambooBridge(account)
const bridgeHeaders = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }
try {
  const legacy = await deviceRequest('/api/desktop/authorizations', { name: 'Desktop legacy fixture', currency: 'USD' }, 201)
  await approveDevice(legacy.user_code, 'USD')
  const grant = await deviceRequest('/api/desktop/token', { device_code: legacy.device_code }, 200)
  saved = { site: origin, gateway: origin, currency: grant.currency, token: grant.token, keyId: grant.key_id, expiresAt: grant.expires_at }
  const initial = await account.initialize()
  assert.equal(initial.status, 'signed-out')
  assert.equal(initial.noticeKey, 'connect_cny_wallet')
  assert.equal(initial.canCall, false)
  assert.deepEqual((await account.catalog()).models, [])
  const oldGeneration = (await account.catalog()).generation
  await account.signIn()
  await account.poll()
  assert.equal(account.state().status, 'waiting')
  await account.cancel()
  assert.equal(account.state().status, 'signed-out')
  assert.equal(account.state().canCall, false)
  assert.equal(saved.token, grant.token)
  approve = true
  await account.signIn()
  await account.poll()
  assert.equal(account.state().account.currency, 'CNY')
  assert.equal(account.state().account.emailVerified, false)
  assert.equal(account.state().account.wallet.available, '100')
  assert.equal(account.state().account.canTopUp, false)
  assert.equal(account.state().canCall, true)
  const model = account.state().models.find(model => model.id === 'openai-demo')
  assert.equal(model.prices.input, '14')
  assert.deepEqual(model.reasoningEfforts, ['high'])
  assert.ok(account.state().models.every(model => model.currency === 'CNY'))
  assert.equal(saved.currency, 'CNY')
  assert.ok(saved.token !== grant.token)
  const revoked = await fetch(origin + '/api/desktop/session', { headers: { authorization: `Bearer ${grant.token}` } })
  assert.equal(revoked.status, 401)
  const body = JSON.stringify({ model: model.id, messages: [{ role: 'user', content: 'CNY integration' }], stream: true,
    reasoning_effort: model.reasoningEfforts[0], max_tokens: 64 })
  const stale = await fetch(`${bridge.url}/session/${oldGeneration}/v1/chat/completions`, { method: 'POST', headers: bridgeHeaders, body })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, 'account_changed')
  const catalog = await fetch(bridge.url + '/catalog', { headers: bridgeHeaders }).then(response => response.json())
  const result = await fetch(`${bridge.url}/session/${catalog.generation}/v1/chat/completions`, { method: 'POST', headers: bridgeHeaders, body })
  assert.equal(result.status, 200)
  assert.ok((await result.text()).includes('[DONE]'))
  await account.refresh(true)
  assert.notEqual(account.state().account.wallet.available, '100')
  assert.equal(account.state().account.wallet.reserved, '0')
  await account.openPage('billing')
  await account.openPage('requests')
  assert.deepEqual(opened.slice(-2), [origin + '/billing?currency=CNY', origin + '/requests?currency=CNY'])
  await account.signOut()
  assert.equal(saved, null)
  process.stdout.write('Desktop client and bridge passed CNY authorization, legacy device reconnection and billing checks.\n')
} finally {
  bridge.close()
  account.close()
}
