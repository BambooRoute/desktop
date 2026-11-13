import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { applyOverrides } from './apply.mjs'
import { checkout, root, runtimeEnvironment, upstream } from './config.mjs'

function run(command, args, cwd = checkout, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
}

function pnpm(args, environment = process.env) {
  run(process.execPath, [join(checkout, 'node_modules/pnpm/bin/pnpm.mjs'), ...args], checkout, environment)
}

function setup() {
  if (!existsSync(join(checkout, '.git'))) {
    const staging = checkout + '.download'
    if (existsSync(staging)) throw new Error(`An incomplete checkout exists at ${staging}; inspect it before removing it and retrying`)
    mkdirSync(staging, { recursive: true })
    run('git', ['init', '--quiet'], staging)
    run('git', ['remote', 'add', 'origin', upstream.repository], staging)
    run('git', ['fetch', '--depth=1', 'origin', upstream.commit], staging)
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], staging)
    run('git', ['remote', 'set-url', '--push', 'origin', 'DISABLED'], staging)
    renameSync(staging, checkout)
  }
  const manifest = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
  if (manifest.version !== upstream.version || manifest.packageManager !== upstream.packageManager) {
    throw new Error('Pinned upstream manifest does not match the configured version and package manager')
  }
  applyOverrides(checkout)
  const options = ['install', '--frozen-lockfile', '--store-dir', join(root, '.runtime/pnpm-store')]
  const environment = { ...process.env, CI: 'true', electron_config_cache: join(root, '.runtime/package-cache/downloads') }
  const npm = process.env.npm_execpath
  if (!npm) throw new Error('Run setup through npm run setup')
  run('git', ['remote', 'set-url', '--push', 'origin', 'DISABLED'])
  run(process.execPath, [npm, 'exec', '--cache', join(root, '.runtime/npm-cache'), '--yes', `--package=${upstream.packageManager}`, '--', 'pnpm', ...options], checkout, environment)
}

try {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || major === 24 && minor < 9) throw new Error('Node.js 24.9 or newer is required')
  const command = process.argv[2]
  if (!['setup', 'build', 'check', 'start', 'dev', 'test-ui'].includes(command)) {
    throw new Error('Usage: node scripts/desktop.mjs setup|build|check|start|dev|test-ui')
  }
  if (command === 'setup') setup()
  else {
    if (!existsSync(join(checkout, 'node_modules/pnpm/bin/pnpm.mjs'))) throw new Error('Run npm run setup first')
    applyOverrides(checkout)
    if (command === 'build' || command === 'dev') pnpm(['run', 'build:artifacts'], { ...process.env, DSH_CLIENT_TITLE: 'Bamboo Desktop' })
    if (command === 'check') pnpm(['run', 'build:check'])
    if (command === 'test-ui') pnpm(['exec', 'vitest', 'run', '--config', 'apps/desktop/scripts/bamboo.vitest.config.ts'])
    if (command === 'start' || command === 'dev') {
      pnpm(['exec', 'tsx', 'apps/desktop/scripts/bamboo.ts'], runtimeEnvironment(root))
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
