import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { applyOverrides } from './apply.mjs'
import { checkout, root, upstream } from './config.mjs'
import { fileHash, packageTarget, previewVersion } from './packaging.mjs'

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, [join(checkout, 'node_modules/pnpm/bin/pnpm.mjs'), ...args], {
    cwd, env, stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Packaging command failed (${result.status ?? result.signal}): pnpm ${args.join(' ')}`)
}

function main() {
  const { values } = parseArgs({ options: { target: { type: 'string' }, dir: { type: 'boolean', default: false } } })
  const name = values.target ?? (process.platform === 'darwin' ? 'mac-' : 'win-') + process.arch
  const target = packageTarget(name)
  if (!existsSync(join(checkout, 'node_modules/pnpm/bin/pnpm.mjs'))) throw new Error('Run npm run setup before packaging')
  const product = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const identity = JSON.parse(readFileSync(join(root, 'config/distribution.json'), 'utf8'))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const output = join(root, 'dist', name)
  const appRoot = join(checkout, 'apps/desktop')
  const prepared = join(appRoot, '.desktop-build/targets', name)
  const resources = join(prepared, 'bamboo-resources')
  const metadataPath = join(prepared, 'bamboo-build.json')
  const metadata = {
    schemaVersion: 1,
    ...identity,
    version: previewVersion(product.version, process.env.GITHUB_RUN_NUMBER ?? '0'),
    productVersion: product.version,
    target: name,
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0,
    upstream,
    node: process.versions.node,
    profileSha256: fileHash(join(root, 'config/profile.patch.json')),
    run: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    signing: 'unsigned',
  }
  if (process.env.GITHUB_ACTIONS === 'true' && metadata.dirty) throw new Error('CI packaging requires a clean source checkout')
  applyOverrides(checkout)
  rmSync(resources, { recursive: true, force: true })
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(resources, 'config.json'), JSON.stringify(identity, null, 2) + '\n')
  cpSync(join(root, 'config/profile.patch.json'), join(resources, 'profile.json'))
  cpSync(join(checkout, 'LICENSE'), join(resources, 'UPSTREAM-LICENSE.txt'))
  cpSync(join(checkout, 'THIRD_PARTY_NOTICES.md'), join(resources, 'THIRD_PARTY_NOTICES.md'))
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n')
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(DSH_|BAMBOO_|CSC_|WIN_CSC_|APPLE_|ELECTRON_)/.test(key)) delete env[key]
  }
  Object.assign(env, {
    CI: 'true',
    DSH_CLIENT_TITLE: identity.productName,
    DSH_DESKTOP_UNSIGNED: '1',
    DSH_DESKTOP_APP_ID: identity.appId,
    DSH_DESKTOP_TARGET_PLATFORM: target.platform,
    DSH_DESKTOP_TARGET_ARCH: target.arch,
    DSH_DESKTOP_PACKAGE_CACHE_DIR: join(root, '.runtime/package-cache'),
    BAMBOO_PACKAGE_OUTPUT: output,
    BAMBOO_PACKAGE_METADATA: metadataPath,
    BAMBOO_PACKAGE_RESOURCES: resources,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  })
  const pnpm = (args, cwd = checkout) => run(args, cwd, env)
  const stage = (label, action) => {
    const started = Date.now()
    console.log(`\nBamboo packaging: ${label}`)
    action()
    console.log(`Bamboo packaging: ${label} completed in ${Math.round((Date.now() - started) / 1000)}s`)
  }
  stage('build', () => pnpm(['run', 'build:artifacts']))
  stage('checks', () => {
    pnpm(['run', 'build:check'])
    pnpm(['exec', 'vitest', 'run', '--config', 'apps/desktop/scripts/bamboo.vitest.config.ts'])
  })
  stage('assets', () => pnpm(['exec', 'node', 'scripts/bamboo-package-assets.mjs'], appRoot))
  for (const directory of ['dsh', 'vendor', 'landlock']) {
    rmSync(join(prepared, 'packed', directory), { recursive: true, force: true })
    mkdirSync(join(prepared, 'packed', directory), { recursive: true })
  }
  stage('local packages', () => {
    pnpm(['exec', 'tsx', 'apps/desktop/scripts/bamboo-pack-local.ts', '--out', join(prepared, 'packed/dsh'), '--concurrency', '2'])
    pnpm(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', join(prepared, 'packed/dsh')])
    pnpm(['run', 'release:pack', '--family', 'vendor', '--out', join(prepared, 'packed/vendor'), '--concurrency', '2'])
    pnpm(['--dir', 'native/system', 'run', 'build:ts'])
    pnpm(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', join(prepared, 'packed/landlock')])
  })
  stage('runtime', () => {
    pnpm(['run', 'prepare:runtime'], appRoot)
    pnpm(['run', 'prepare:packages'], appRoot)
    pnpm(['run', 'prepare:dsh'], appRoot)
  })
  stage('installer', () => {
    rmSync(output, { recursive: true, force: true })
    pnpm(['exec', 'electron-builder', '--config', 'scripts/bamboo-builder.mjs',
      ...(name === 'mac-arm64' ? ['--mac', '--arm64'] : ['--win', '--x64']),
      ...(values.dir ? ['--dir'] : []), '--publish', 'never'], appRoot)
  })
  stage('packaged runtime verification', () => pnpm(['exec', 'tsx', 'scripts/bamboo-smoke-package.ts'], appRoot))
  metadata.electron = JSON.parse(readFileSync(join(appRoot, 'node_modules/electron/package.json'), 'utf8')).version
  metadata.lockfileSha256 = fileHash(join(checkout, 'pnpm-lock.yaml'))
  metadata.verification = JSON.parse(readFileSync(join(output, 'verification.json'), 'utf8'))
  const files = readdirSync(output).filter(file => file.endsWith(target.extension))
  if (!values.dir && files.length !== 1) throw new Error('Packaging did not produce exactly one installer')
  metadata.artifacts = files.map(file => ({ file, bytes: statSync(join(output, file)).size, sha256: fileHash(join(output, file)) }))
  writeFileSync(join(output, 'build-manifest.json'), JSON.stringify(metadata, null, 2) + '\n')
  writeFileSync(join(output, 'SHA256SUMS'), metadata.artifacts.map(file => `${file.sha256}  ${file.file}\n`).join(''))
  console.log(`Bamboo ${name} package verified: ${output}`)
}

try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
