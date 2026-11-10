import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { developmentRuntimeDirectory, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject } from './development-project.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'
import { prepareApp } from './bamboo-app.mjs'
import sharp from 'sharp'

const appRoot = resolve(import.meta.dirname, '..')
const repository = resolve(appRoot, '../..')
const development = join(appRoot, '.desktop-build/development')
const require = createRequire(import.meta.url)
const electron = require('electron') as string
const versionOf = (directory: string): string => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version as string

async function main() {
  for (const file of ['lib/main.js', '../desktop-host/lib/index.js']) {
    if (!existsSync(join(appRoot, file))) throw new Error('Build artifacts are missing. Run npm run build first.')
  }
  const home = process.env.DSH_HOME
  const userData = process.env.DSH_DESKTOP_USER_DATA_DIR
  if (!home || !userData) throw new Error('Launch Bamboo with npm start or npm run dev.')
  mkdirSync(home, { recursive: true })
  mkdirSync(userData, { recursive: true })
  const overlay = join(home, 'bamboo-profile.json')
  writeFileSync(overlay, readFileSync(join(import.meta.dirname, 'bamboo-profile.json')))
  const release = {
    schemaVersion: 1 as const,
    version: versionOf(appRoot),
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: execFileSync(electron, ['-p', 'process.versions.node'], {
      encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }).trim(),
    pnpmVersion: versionOf(join(appRoot, 'node_modules/pnpm')),
  }
  prepareDevelopmentProject({
    projectDir: join(development, 'project'),
    cliDir: join(repository, 'apps/cli'),
    hostDir: join(repository, 'apps/desktop-host'),
    dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
    release,
    target: resolveDesktopBuildTarget(),
  })
  console.log('Preparing the pinned desktop runtime...')
  await preparePrimaryRuntime()
  const icon = join(development, 'bamboo-icon.png')
  await sharp(join(appRoot, 'renderer/assets/welcome-brand.svg')).resize(1024, 1024).png().toFile(icon)
  const environment = {
    DSH_HOME: home,
    DSH_DESKTOP_USER_DATA_DIR: userData,
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: developmentRuntimeDirectory(),
    DSH_DESKTOP_OPEN_DEVTOOLS: '0',
    DSH_TELEMETRY_DISABLED: '1',
    BAMBOO_PROFILE: overlay,
    BAMBOO_SITE_ORIGIN: process.env.BAMBOO_SITE_ORIGIN ?? 'https://bambooroute.com',
    BAMBOO_GATEWAY_ORIGIN: process.env.BAMBOO_GATEWAY_ORIGIN ?? 'https://api.bambooroute.com',
  }
  const args = [`--user-data-dir=${userData}`, appRoot]
  const executable = process.platform === 'darwin'
    ? prepareApp(electron, appRoot, join(development, 'bamboo'), environment, icon)
    : electron
  console.log('Starting Bamboo Desktop...')
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(executable, process.platform === 'darwin' ? [] : args, {
      cwd: appRoot, env: { ...process.env, ...environment }, stdio: 'inherit',
    })
    const stop = () => { child.kill('SIGTERM') }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      if (code === 0 || signal === 'SIGTERM') resolveLaunch()
      else reject(new Error(`Bamboo Desktop exited with ${String(code ?? signal)}`))
    })
  })
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Desktop startup failed')
  process.exitCode = 1
})
