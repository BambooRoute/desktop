export class BambooError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function serviceOrigin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Bamboo requires an HTTPS service origin or a local development server')
  }
  return url.origin
}

export function userError(code, status, currency) {
  const messages = {
    invalid_api_key: 'Your desktop connection expired or was revoked. Sign in again.',
    desktop_authorization_expired: 'The sign-in request expired. Start sign-in again.',
    desktop_authorization_denied: 'The device connection was declined. You can start sign-in again.',
    insufficient_balance: `Your ${currency || 'selected'} wallet has insufficient available funds. Open billing or choose a smaller output limit.`,
    invalid_currency: 'Choose USD or CNY as the billing currency.',
    key_budget_exceeded: 'This device reached its spending limit. Update its budget on the API keys page.',
    email_verification_required: 'Verify your email in your Bamboo account, then refresh.',
    policy_acceptance_required: 'Review the current service policies in your Bamboo account, then refresh.',
    policy_unavailable: 'Model calls are unavailable while service policies are being updated. Try again later.',
    payment_risk_blocked: 'Your account has a payment issue. Open Billing or contact support.',
    site_maintenance: 'Bamboo is undergoing maintenance. Please try again later.',
    site_coming_soon: 'Bamboo is not open for model calls yet. Please try again later.',
    model_unavailable: 'This model is no longer available. Refresh the model list and choose another model.',
    unsupported_parameter: 'This model does not support part of the request. Choose another compatible model.',
  }
  if (messages[code]) return messages[code]
  if (status === 401) return messages.invalid_api_key
  if (status === 403) return 'This request is not allowed for your account or device. Check your account access and API key settings.'
  if (status === 404) return 'The Bamboo service does not support this desktop version yet. Update the service and try again.'
  if (status === 429) return 'Too many requests. Wait a moment before trying again.'
  if (status >= 500) return 'Bamboo could not confirm the result. Check request history before retrying a model call.'
  return 'Bamboo could not complete the request. Please try again.'
}

const validCurrency = value => value === 'USD' || value === 'CNY'
const validAmount = value => typeof value === 'string' && /^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value)

export function parseModels(value, currency) {
  if (!validCurrency(currency) || !Array.isArray(value)) throw new BambooError('invalid_catalog', 'Bamboo returned an invalid model list.', 502)
  const seen = new Set()
  return value.flatMap(model => {
    if (!model || model.currency !== currency || typeof model.id !== 'string' || !model.id || model.id.length > 200 || seen.has(model.id) ||
      typeof model.name !== 'string' || typeof model.provider !== 'string' || !model.capabilities ||
      !Number.isSafeInteger(model.max_output_tokens) || model.max_output_tokens < 1) {
      throw new BambooError('invalid_catalog', 'Bamboo returned an invalid model list.', 502)
    }
    seen.add(model.id)
    if (model.capabilities.chat !== true || model.capabilities.tools !== true) return []
    const prices = {}
    for (const field of ['input', 'output', 'cache_read', 'cache_write']) {
      const price = model.sell?.[field]
      if (price !== undefined && !validAmount(price)) throw new BambooError('invalid_catalog', 'Bamboo returned an invalid model price.', 502)
      if (price !== undefined) prices[field] = price
    }
    return [{ id: model.id, name: model.name, provider: model.provider, maxOutput: model.max_output_tokens,
      vision: model.capabilities.vision === true, currency, prices }]
  })
}

function parseAccount(value, currency) {
  if (!value || !validCurrency(currency) || value.currency !== currency || typeof value.email !== 'string' ||
    typeof value.email_verified !== 'boolean' || typeof value.model_access !== 'boolean' ||
    typeof value.policy?.ready !== 'boolean' || typeof value.policy?.accepted !== 'boolean' ||
    !Array.isArray(value.wallets) || value.wallets.length !== 2 ||
    new Set(value.wallets.map(wallet => wallet?.currency)).size !== 2 ||
    !value.wallets.every(wallet => validCurrency(wallet?.currency) && ['balance', 'reserved', 'available'].every(key => validAmount(wallet[key]))) ||
    !Array.isArray(value.topup_currencies) || !value.topup_currencies.every(validCurrency)) {
    throw new BambooError('invalid_account', 'Bamboo returned invalid account information. Refresh before making another call.', 502)
  }
  const wallets = value.wallets.map(wallet => ({ currency: wallet.currency, balance: wallet.balance, reserved: wallet.reserved, available: wallet.available }))
  return { email: value.email, emailVerified: value.email_verified, modelAccess: value.model_access,
    policyReady: value.policy.ready, policyAccepted: value.policy.accepted, currency,
    wallets, wallet: wallets.find(wallet => wallet.currency === currency), topupCurrencies: [...new Set(value.topup_currencies)] }
}

export function accountBlocker(account) {
  if (!account) return 'Sign in to Bamboo to use models.'
  if (!account.emailVerified) return 'Verify your email in your Bamboo account, then refresh.'
  if (!account.modelAccess) return 'Model access is not enabled for your account. Contact Bamboo support.'
  if (!account.policyReady) return 'Model calls are unavailable while service policies are being updated.'
  if (!account.policyAccepted) return 'Review the current service policies in your Bamboo account, then refresh.'
  if (!/[1-9]/.test(account.wallet.available)) return `Your ${account.currency} wallet has no available funds. Open billing to check funding options.`
  return ''
}

export class BambooAccount {
  constructor({ site, gateway, storage, openExternal, fetch: send = fetch, pollInterval = 3000 }) {
    this.site = serviceOrigin(site)
    this.gateway = serviceOrigin(gateway)
    this.storage = storage
    this.openExternal = openExternal
    this.send = send
    this.pollInterval = pollInterval
    this.generation = 0
    this.listeners = new Set()
    this.aborters = new Set()
    this.credential = null
    this.attempt = null
    this.timer = null
    this.refreshing = null
    this.lastRefresh = 0
    this.persisting = null
    this.value = { status: 'signed-out', models: [], canCall: false }
  }

  state() { return structuredClone({ ...this.value, activeCalls: this.aborters.size }) }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  publish(value) {
    this.value = value
    for (const listener of this.listeners) listener(this.state())
    return this.state()
  }

  async json(path, { token, method = 'GET', body, signal } = {}) {
    let response
    try {
      response = await this.send(this.site + path, { method, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    } catch {
      throw new BambooError('network', 'Could not reach Bamboo. Check your connection and try again.', 503)
    }
    let value
    try { value = await response.json() }
    catch { throw new BambooError('invalid_response', userError('', response.status), response.ok ? 502 : response.status) }
    if (!response.ok) {
      const code = typeof value?.error?.code === 'string' ? value.error.code : 'request_failed'
      throw new BambooError(code, userError(code, response.status, this.credential?.currency), response.status)
    }
    return { value, status: response.status }
  }

  async initialize() {
    try {
      const credential = await this.storage.read()
      if (validCurrency(credential?.currency) && credential?.site === this.site && credential.gateway === this.gateway && typeof credential.token === 'string' &&
        /^bbr-[A-Za-z0-9_-]{32,128}$/.test(credential.token) && Date.parse(credential.expiresAt) > Date.now()) {
        this.credential = credential
        await this.refresh(true)
      } else if (credential) await this.storage.clear()
    } catch {
      this.publish({ status: 'signed-out', models: [], canCall: false, error: 'Your saved connection could not be opened. Sign in again to reconnect.' })
    }
    return this.state()
  }

  async signIn(currency) {
    if (!validCurrency(currency)) throw new BambooError('invalid_currency', 'Choose USD or CNY as the billing currency.')
    if (this.aborters.size) throw new BambooError('requests_active', 'Finish or stop current calls before changing billing currency.')
    if (this.persisting) throw new BambooError('connection_busy', 'Wait for the current connection to finish.')
    if (this.credential?.currency === currency || this.attempt || this.value.status === 'connecting') return this.state()
    this.storage.assertAvailable()
    const generation = ++this.generation
    this.publish({ status: 'connecting', pendingCurrency: currency, models: [], canCall: false })
    try {
      const { value } = await this.json('/api/desktop/authorizations', { method: 'POST', body: { name: `Bamboo Desktop (${process.platform})`, currency } })
      if (value.currency !== currency || typeof value.device_code !== 'string' || value.device_code.length < 32 || value.device_code.length > 128 ||
        !/^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(value.user_code) || value.verification_uri !== this.site + '/desktop/authorize' ||
        !Number.isFinite(value.expires_in) || value.expires_in < 1 || value.expires_in > 900) {
        throw new BambooError('invalid_response', 'Bamboo returned an invalid sign-in request.', 502)
      }
      if (generation !== this.generation) {
        await this.json('/api/desktop/cancel', { method: 'POST', body: { device_code: value.device_code } }).catch(() => {})
        return this.state()
      }
      const url = new URL(value.verification_uri)
      url.searchParams.set('code', value.user_code)
      this.attempt = { currency, device: value.device_code, url: url.href, expiresAt: Date.now() + value.expires_in * 1000, generation,
        interval: Math.max(this.pollInterval, Math.min(30_000, (Number(value.interval) || 3) * 1000)) }
      this.publish({ status: 'waiting', pendingCurrency: currency, models: [], canCall: false, code: value.user_code, expiresAt: this.attempt.expiresAt })
      this.schedulePoll()
      await this.openExternal(url.href)
    } catch (error) {
      if (generation === this.generation) {
        const message = error instanceof BambooError ? error.message : 'The sign-in page could not open. Use Open browser to try again.'
        if (this.attempt) this.publish({ ...this.value, error: message })
        else await this.resume(message)
      }
    }
    return this.state()
  }

  async openBrowser() {
    if (!this.attempt || this.attempt.expiresAt <= Date.now()) throw new BambooError('expired', 'Start sign-in again to get a new code.')
    await this.openExternal(this.attempt.url)
  }

  schedulePoll() {
    clearTimeout(this.timer)
    if (this.attempt) this.timer = setTimeout(() => { void this.poll() }, this.attempt.interval)
  }

  async poll() {
    const attempt = this.attempt
    if (!attempt) return
    if (attempt.expiresAt <= Date.now()) {
      this.attempt = null
      await this.resume('The sign-in request expired. Start sign-in again.')
      return
    }
    try {
      const { value, status } = await this.json('/api/desktop/token', { method: 'POST', body: { device_code: attempt.device } })
      if (status === 202 && value.status === 'pending') { if (this.attempt === attempt) this.schedulePoll(); return }
      if (value.currency !== attempt.currency || typeof value.token !== 'string' || !/^bbr-[A-Za-z0-9_-]{32,128}$/.test(value.token) ||
        typeof value.key_id !== 'string' || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= Date.now()) {
        if (typeof value.token === 'string' && /^bbr-[A-Za-z0-9_-]{32,128}$/.test(value.token) && value.token !== this.credential?.token) await this.json('/api/desktop/session', { token: value.token, method: 'DELETE' }).catch(() => {})
        throw new BambooError('invalid_response', 'The sign-in result could not be confirmed. Start sign-in again.', 502)
      }
      if (this.attempt !== attempt || this.generation !== attempt.generation) {
        await this.json('/api/desktop/session', { token: value.token, method: 'DELETE' }).catch(() => {})
        return
      }
      const credential = { site: this.site, gateway: this.gateway, currency: value.currency, token: value.token, keyId: value.key_id, expiresAt: value.expires_at }
      const previous = this.credential
      const operation = (async () => {
        try { await this.storage.write(credential) }
        catch {
          await this.json('/api/desktop/session', { token: value.token, method: 'DELETE' }).catch(() => {})
          throw new BambooError('storage', 'The device credential could not be saved securely. Unlock your system keychain and sign in again.')
        }
        if (this.attempt !== attempt || this.generation !== attempt.generation) {
          if (this.credential) await this.storage.write(this.credential)
          else await this.storage.clear()
          await this.json('/api/desktop/session', { token: value.token, method: 'DELETE' }).catch(() => {})
          return false
        }
        this.attempt = null
        this.credential = credential
        this.lastRefresh = 0
        return true
      })()
      this.persisting = operation
      let accepted
      try { accepted = await operation }
      finally { if (this.persisting === operation) this.persisting = null }
      if (!accepted) return
      let revokeError = ''
      if (previous && previous.token !== credential.token) {
        try { await this.json('/api/desktop/session', { token: previous.token, method: 'DELETE' }) }
        catch (error) {
          if (!(error instanceof BambooError && error.status === 401)) revokeError = 'Currency changed. The previous device connection could not be revoked. Revoke it on the API keys page.'
        }
      }
      if (this.credential !== credential || this.generation !== attempt.generation) return
      this.publish({ status: 'signed-in', models: [], canCall: false })
      await this.refresh(true)
      if (revokeError) this.publish({ ...this.value, error: revokeError })
    } catch (error) {
      if (this.attempt !== attempt) return
      if (error instanceof BambooError && (error.code === 'network' || error.status === 429 || error.status >= 500 && error.code !== 'invalid_response')) {
        this.publish({ ...this.value, error: error.message })
        this.schedulePoll()
      } else {
        this.attempt = null
        await this.resume(error instanceof BambooError ? error.message : 'Sign-in could not finish. Please try again.')
      }
    }
  }

  async resume(error = '') {
    this.publish({ status: this.credential ? 'signed-in' : 'signed-out', models: [], canCall: false })
    this.lastRefresh = 0
    if (this.credential) await this.refresh(true)
    if (error) this.publish({ ...this.value, error })
    return this.state()
  }

  async cancel() {
    const attempt = this.attempt
    ++this.generation
    clearTimeout(this.timer)
    this.attempt = null
    await this.persisting?.catch(() => {})
    if (attempt) await this.json('/api/desktop/cancel', { method: 'POST', body: { device_code: attempt.device } }).catch(() => {})
    return this.resume()
  }

  async refresh(force = false) {
    if (!this.credential || this.attempt || this.value.status === 'connecting') return this.state()
    if (this.refreshing?.credential === this.credential && this.refreshing.generation === this.generation) return this.refreshing.operation
    if (!force && Date.now() - this.lastRefresh < 30_000) return this.state()
    const credential = this.credential
    const generation = this.generation
    const refresh = { credential, generation, operation: null }
    refresh.operation = (async () => {
      try {
        const [session, catalog] = await Promise.all([
          this.json('/api/desktop/session', { token: credential.token }),
          this.json('/api/desktop/models', { token: credential.token }),
        ])
        if (generation !== this.generation || credential !== this.credential) return this.state()
        const account = parseAccount(session.value, credential.currency)
        const models = parseModels(catalog.value, credential.currency)
        this.lastRefresh = Date.now()
        return this.publish({ status: 'signed-in', account, models, canCall: !accountBlocker(account) && models.length > 0,
          notice: accountBlocker(account) || (models.length === 0 ? `No models supporting chat and tools are available for ${credential.currency} billing. Choose another billing currency or check again later.` : '') })
      } catch (error) {
        if (generation !== this.generation || credential !== this.credential) return this.state()
        if (error instanceof BambooError && error.status === 401) return this.expire()
        return this.publish({ ...this.value, status: 'signed-in', canCall: false,
          error: error instanceof BambooError ? error.message : 'Account details could not be refreshed. Try again.' })
      } finally { if (this.refreshing === refresh) this.refreshing = null }
    })()
    this.refreshing = refresh
    return refresh.operation
  }

  async expire() {
    ++this.generation
    this.credential = null
    for (const controller of this.aborters) controller.abort()
    await this.storage.clear()
    return this.publish({ status: 'signed-out', models: [], canCall: false, error: 'Your desktop connection expired or was revoked. Sign in again.' })
  }

  async signOut() {
    const credential = this.credential
    this.credential = null
    await this.cancel()
    for (const controller of this.aborters) controller.abort()
    await this.storage.clear()
    if (credential) {
      try { await this.json('/api/desktop/session', { token: credential.token, method: 'DELETE' }) }
      catch (error) {
        if (!(error instanceof BambooError && error.status === 401)) {
          return this.publish({ ...this.value, error: 'Signed out locally. Remote revocation could not be confirmed. Revoke this device on the API keys page.' })
        }
      }
    }
    return this.state()
  }

  async openPage(page) {
    const paths = { billing: '/billing', requests: '/requests', account: '/settings', keys: '/keys', support: '/tickets' }
    if (!Object.hasOwn(paths, page)) throw new BambooError('invalid_page', 'Unknown Bamboo page')
    const url = new URL(this.site + paths[page])
    if (this.credential && ['billing', 'requests'].includes(page)) url.searchParams.set('currency', this.credential.currency)
    await this.openExternal(url.href)
  }

  async catalog() {
    await this.refresh()
    return { generation: this.generation, models: this.credential && this.value.status === 'signed-in' ? this.value.models : [] }
  }

  async inference(body, generation, signal) {
    await this.refresh()
    const credential = this.credential
    if (!credential) throw new BambooError('invalid_api_key', 'Sign in to Bamboo before sending a message.', 401)
    if (generation !== this.generation) throw new BambooError('account_changed', 'Your account changed. Start a new request before continuing.', 409)
    if (!this.value.canCall) throw new BambooError('account_not_ready', this.value.error || this.value.notice || 'Refresh your Bamboo account before trying again.', 403)
    if (!this.value.models.some(model => model.id === body.model)) throw new BambooError('model_unavailable', userError('model_unavailable'), 400)
    const controller = new AbortController()
    this.aborters.add(controller)
    this.publish({ ...this.value })
    const release = () => { if (this.aborters.delete(controller)) this.publish({ ...this.value }) }
    try {
      const response = await this.send(this.gateway + '/v1/chat/completions', {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${credential.token}` },
        body: JSON.stringify(body), signal: AbortSignal.any([signal, controller.signal]),
      })
      if (response.status === 401 && credential === this.credential && generation === this.generation) { release(); await this.expire() }
      return { response, release, currency: credential.currency }
    } catch {
      release()
      if (signal.aborted || controller.signal.aborted) throw new BambooError('cancelled', 'Request cancelled. Check request history for its final charge.', 499)
      throw new BambooError('network', 'The model request could not be confirmed. Check request history before retrying.', 502)
    }
  }

  close() {
    clearTimeout(this.timer)
    ++this.generation
    this.attempt = null
    for (const controller of this.aborters) controller.abort()
    this.listeners.clear()
  }
}
