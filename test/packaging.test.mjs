import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { configureInstalledApp } from '../overrides/installed-environment.mjs'
import { packageTarget, previewVersion } from '../scripts/packaging.mjs'

test('only packages native Apple Silicon and Windows x64 targets', () => {
  assert.equal(packageTarget('mac-arm64', 'darwin', 'arm64').extension, '.dmg')
  assert.equal(packageTarget('win-x64', 'win32', 'x64').extension, '.exe')
  for (const target of ['mac-x64', 'win-arm64', 'linux-x64', 'toString']) assert.throws(() => packageTarget(target))
  assert.throws(() => packageTarget('mac-arm64', 'darwin', 'x64'))
  assert.throws(() => packageTarget('win-x64', 'darwin', 'arm64'))
})

test('preview versions are distinct from stable releases', () => {
  assert.equal(previewVersion('0.1.0', '12'), '0.1.0-preview.12')
  for (const value of ['-1', '01', '65536', '1;echo test']) assert.throws(() => previewVersion('0.1.0', value))
  assert.throws(() => previewVersion('0.1.0-beta.1'))
})

test('installed preview uses bundled configuration and isolated user data before startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bamboo-installed-'))
  try {
    const resources = join(directory, 'resources')
    const identity = JSON.parse(readFileSync(new URL('../config/distribution.json', import.meta.url), 'utf8'))
    mkdirSync(join(resources, 'bamboo'), { recursive: true })
    writeFileSync(join(resources, 'bamboo/config.json'), JSON.stringify(identity))
    writeFileSync(join(resources, 'bamboo/profile.json'), '[]')
    const recorded = {}
    const app = {
      isPackaged: true,
      getPath: name => { assert.equal(name, 'appData'); return join(directory, 'App Data') },
      setPath: (key, value) => { recorded[key] = value },
      setName: value => { recorded.name = value },
      setAppUserModelId: value => { recorded.id = value },
    }
    const environment = {
      HOME: '/unchanged', PATH: '/unchanged',
      DSH_HOME: '/official', DSH_DESKTOP_DSH_DIR: '/development',
      BAMBOO_PROFILE: '/outside/profile.json', BAMBOO_GATEWAY_ORIGIN: 'https://wrong.test',
    }
    configureInstalledApp(app, resources, environment)
    assert.equal(recorded.name, identity.productName)
    assert.equal(recorded.id, identity.appId)
    assert.equal(recorded.userData, join(directory, 'App Data', identity.productName, 'desktop'))
    assert.equal(environment.DSH_HOME, join(directory, 'App Data', identity.productName, 'runtime'))
    assert.equal(environment.BAMBOO_PROFILE, join(resources, 'bamboo/profile.json'))
    assert.equal(environment.BAMBOO_GATEWAY_ORIGIN, identity.gateway)
    assert.equal(environment.DSH_DESKTOP_DSH_DIR, undefined)
    assert.equal(environment.HOME, '/unchanged')
    assert.equal(environment.PATH, '/unchanged')
    app.isPackaged = false
    const development = { BAMBOO_PROFILE: '/development/profile.json' }
    configureInstalledApp(app, '/not-an-installation', development)
    assert.deepEqual(development, { BAMBOO_PROFILE: '/development/profile.json' })
    app.isPackaged = true
    rmSync(join(resources, 'bamboo/profile.json'))
    assert.throws(() => configureInstalledApp(app, resources, {}), /profile/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
