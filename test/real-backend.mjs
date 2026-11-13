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
let approve = true
let saved = null
const storage = {
  assertAvailable() {}, read: async () => saved,
  write: async value => { saved = structuredClone(value) },
  clear: async () => { saved = null },
}
const account = new BambooAccount({
  site: origin, gateway: origin, storage, pollInterval: 60000,
  openExternal: async value => {
    const url = new URL(value)
    opened.push(value)
    assert.equal(url.origin, origin)
    if (url.pathname !== '/desktop/authorize' || !approve) return
    const path = `/api/desktop/authorizations/${url.searchParams.get('code')}`
    const details = await fetch(origin + path, { headers })
    assert.equal(details.status, 200)
    assert.equal((await details.json()).currency, account.state().pendingCurrency)
    const response = await fetch(origin + path, { method: 'POST', headers, body: JSON.stringify({ approve: true }) })
    assert.equal(response.status, 200)
  },
})
const bridge = await createBambooBridge(account)
const bridgeHeaders = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }
try {
  await account.initialize()
  await account.signIn('USD')
  await account.poll()
  assert.equal(account.state().account.currency, 'USD')
  assert.equal(account.state().account.wallet.available, '25')
  assert.equal(account.state().canCall, true)
  const previous = saved
  const oldGeneration = (await account.catalog()).generation
  await account.signIn('CNY')
  assert.equal(account.state().canCall, false)
  await account.poll()
  assert.equal(account.state().account.currency, 'CNY')
  assert.equal(account.state().account.wallet.available, '100')
  assert.deepEqual(account.state().account.topupCurrencies, [])
  assert.equal(account.state().models.find(model => model.id === 'openai-demo').prices.input, '14')
  assert.ok(account.state().models.every(model => model.currency === 'CNY'))
  assert.equal(saved.currency, 'CNY')
  assert.ok(saved.token !== previous.token)
  const revoked = await fetch(origin + '/api/desktop/session', { headers: { authorization: `Bearer ${previous.token}` } })
  assert.equal(revoked.status, 401)
  approve = false
  await account.signIn('USD')
  await account.cancel()
  assert.equal(account.state().account.currency, 'CNY')
  assert.equal(account.state().canCall, true)
  const body = JSON.stringify({ model: 'openai-demo', messages: [{ role: 'user', content: 'CNY integration' }], stream: true, max_tokens: 64 })
  const stale = await fetch(`${bridge.url}/session/${oldGeneration}/v1/chat/completions`, { method: 'POST', headers: bridgeHeaders, body })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, 'account_changed')
  const catalog = await fetch(bridge.url + '/catalog', { headers: bridgeHeaders }).then(response => response.json())
  const result = await fetch(`${bridge.url}/session/${catalog.generation}/v1/chat/completions`, { method: 'POST', headers: bridgeHeaders, body })
  assert.equal(result.status, 200)
  assert.ok((await result.text()).includes('[DONE]'))
  await account.refresh(true)
  assert.equal(account.state().account.wallets.find(wallet => wallet.currency === 'USD').available, '25')
  assert.notEqual(account.state().account.wallet.available, '100')
  assert.equal(account.state().account.wallet.reserved, '0')
  await account.openPage('billing')
  await account.openPage('requests')
  assert.deepEqual(opened.slice(-2), [origin + '/billing?currency=CNY', origin + '/requests?currency=CNY'])
  await account.signOut()
  assert.equal(saved, null)
  process.stdout.write('Desktop client and bridge passed real backend currency authorization and billing checks.\n')
} finally {
  bridge.close()
  account.close()
}
