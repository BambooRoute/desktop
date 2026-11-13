import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'

const metadata = JSON.parse(readFileSync(process.env.BAMBOO_PACKAGE_METADATA!, 'utf8'))
const output = process.env.BAMBOO_PACKAGE_OUTPUT!
const windows = metadata.target === 'win-x64'
const application = windows ? join(output, 'win-unpacked') : join(output, 'mac-arm64', metadata.productName + '.app', 'Contents')
const resources = join(application, windows ? 'resources' : 'Resources')
const executable = windows ? join(application, metadata.productName + '.exe') : join(application, 'MacOS', metadata.productName)
const runtime = join(resources, 'runtime')
const dsh = join(resources, 'app.asar', 'dsh')
const paths = resolveDesktopTargetBuildPaths()
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  { platform: windows ? 'win32' : 'darwin', arch: windows ? 'x64' : 'arm64' })
const manifest = JSON.parse(execFileSync(executable,
  ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))', join(resources, 'app.asar/package.json')],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000 }).trim())
assert.equal(manifest.name, '@bambooroute/desktop')
assert.equal(manifest.version, metadata.version)
assert.equal(manifest.dshDesktopAppId, metadata.appId)
assert.equal(manifest.author.name, 'BambooRoute')
assert.equal(manifest.homepage, metadata.site)
assert.equal(manifest.dshMandatoryUpdatePolicy, undefined)
assert.equal(manifest.bamboo.upstreamCommit, metadata.upstream.commit)
assert.equal(readFileSync(join(resources, 'bamboo/profile.json'), 'utf8'),
  readFileSync(join(process.env.BAMBOO_PACKAGE_RESOURCES!, 'profile.json'), 'utf8'))
await smokePreparedRuntime(dsh, executable, runtime, descriptor)

const home = mkdtempSync(join(tmpdir(), 'bamboo-package-smoke-'))
const profile = join(home, 'profiles/desktop')
const token = randomBytes(32).toString('base64url')
let catalogRequests = 0
let inferenceRequests = 0
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json')
  if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end('{}'); return }
  if (request.url !== '/catalog' || request.method !== 'GET') {
    inferenceRequests++
    response.writeHead(503).end('{}')
    return
  }
  catalogRequests++
  response.end(JSON.stringify({ generation: 1, models: [{ id: 'packaging-smoke', name: 'Packaging smoke', provider: 'test',
    maxOutput: 1024, vision: false, currency: 'USD', prices: { input: '0', output: '0' } }] }))
})
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('Smoke bridge did not start')
const bridge = { url: `http://127.0.0.1:${address.port}`, token }
const environment = { ...process.env, DSH_HOME: home, HOME: home, USERPROFILE: home,
  APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home,
  XDG_STATE_HOME: home, BAMBOO_PROFILE: join(resources, 'bamboo/profile.json'), DSH_TELEMETRY_DISABLED: '1' }
const host = new DesktopHostProcess(executable, dsh, profile, undefined, environment,
  undefined, join(runtime, 'primary-runtime'),
  { pnpm: join(runtime, 'primary-runtime/dependencies/pnpm/bin/pnpm.mjs'), nodeBin: join(runtime, 'bin') },
  undefined, undefined, bridge)
let timer: ReturnType<typeof setTimeout> | undefined
try {
  createPluginProfile(profile)
  const pluginName = 'bamboo-package-smoke'
  const plugin = join(profile, 'node_modules', pluginName)
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: pluginName, version: '1.0.0', type: 'module',
    exports: './index.js', dsh: { bundle: { patch: './bundle.yml' } } }))
  writeFileSync(join(plugin, 'bundle.yml'), '- insert:\n    - id: bamboo-package-smoke\n      name: bamboo-package-smoke\n      inject: [webServer, llm]\n')
  writeFileSync(join(plugin, 'index.js'), `export function apply(ctx) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/bamboo-package-smoke',
      async handler(request, response) {
        try { response.end(JSON.stringify({ providers: ctx.llm.listProviders(), models: await ctx.llm.listModels('bamboo') })) }
        catch (error) { response.statusCode = 500; response.end(String(error)) }
      } }))
  }\n`)
  const project = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  project.dsh.profile.bundles.push(pluginName)
  writeFileSync(join(profile, 'package.json'), JSON.stringify(project))
  const ready = await Promise.race([host.start(), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Packaged Bamboo Host did not become ready')), 120_000)
  })])
  clearTimeout(timer)
  const login = await fetch(ready.url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const response = await fetch(new URL('/bamboo-package-smoke', ready.url), { headers: { cookie }, signal: AbortSignal.timeout(30_000) })
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json() as { providers: { id: string }[]; models: { id: string }[] }
  assert.deepEqual(result.providers.map(provider => provider.id), ['bamboo'])
  assert.deepEqual(result.models.map(model => model.id), ['packaging-smoke'])
  assert.ok(catalogRequests > 0)
  assert.equal(inferenceRequests, 0)
  writeFileSync(join(output, 'verification.json'), JSON.stringify({
    runtime: 'passed', officeConversion: 'passed', offlinePlugins: 'passed',
    bambooHost: 'passed', bambooCatalog: 'passed', paidModelCalls: 0,
    installerInteraction: 'not-tested', signedDistribution: 'not-tested',
  }, null, 2) + '\n')
  console.log('Bamboo packaged Host and model catalog passed without paid model calls')
} finally {
  clearTimeout(timer)
  try { await host.stop() } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
}
