import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BambooError, userError } from './bamboo-account.mjs'

function reply(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) throw new BambooError('request_too_large', 'This request is too large. Remove files or shorten the conversation.', 413)
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch { throw new BambooError('invalid_request', 'Invalid model request.', 400) }
}

export async function createBambooBridge(account) {
  const token = randomBytes(32).toString('base64url')
  const expected = Buffer.from(`Bearer ${token}`)
  const controllers = new Set()
  const server = createServer((request, response) => {
    const received = Buffer.from(request.headers.authorization || '')
    if (request.headers.origin !== undefined || received.length !== expected.length || !timingSafeEqual(expected, received)) {
      reply(response, 401, { error: { code: 'unauthorized', message: 'Desktop Host authentication required.' } })
      return
    }
    const controller = new AbortController()
    controllers.add(controller)
    response.once('close', () => { if (!response.writableFinished) controller.abort() })
    void (async () => {
      if (request.url === '/catalog' && request.method === 'GET') {
        reply(response, 200, await account.catalog())
        return
      }
      const match = /^\/session\/(\d+)\/v1\/chat\/completions$/.exec(request.url || '')
      if (!match || request.method !== 'POST') {
        reply(response, 404, { error: { code: 'not_found', message: 'Unknown desktop operation.' } })
        return
      }
      const body = await readBody(request)
      const { response: upstream, release, currency } = await account.inference(body, Number(match[1]), controller.signal)
      try {
        if (!upstream.ok) {
          let value
          try { value = await upstream.json() } catch { value = null }
          const code = typeof value?.error?.code === 'string' ? value.error.code : 'gateway_error'
          reply(response, upstream.status, { error: { code, message: userError(code, upstream.status, currency) } })
          return
        }
        const contentType = upstream.headers.get('content-type') || ''
        if (body.stream === true && !contentType.includes('text/event-stream') ||
          body.stream !== true && !contentType.includes('application/json') || !upstream.body) {
          await upstream.body?.cancel()
          throw new BambooError('invalid_response', 'The model result could not be confirmed. Check request history before retrying.', 502)
        }
        response.writeHead(upstream.status, { 'content-type': contentType, 'cache-control': 'no-store',
          ...(upstream.headers.has('x-request-id') ? { 'x-request-id': upstream.headers.get('x-request-id') } : {}) })
        await pipeline(Readable.fromWeb(upstream.body), response, { signal: controller.signal })
      } finally {
        release()
        void account.refresh(true)
      }
    })().catch(error => {
      if (response.destroyed) return
      if (response.headersSent) { response.destroy(); return }
      const failure = error instanceof BambooError ? error : new BambooError('gateway_error', 'The request could not be confirmed. Check request history before retrying.', 502)
      reply(response, failure.status, { error: { code: failure.code, message: failure.message } })
    }).finally(() => controllers.delete(controller))
  })
  server.requestTimeout = 300_000
  server.headersTimeout = 10_000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, token, close() { for (const controller of controllers) controller.abort(); server.closeAllConnections(); server.close() } }
}
