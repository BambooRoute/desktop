import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { checkedPath, runtimeEnvironment } from '../scripts/config.mjs'
import { desktopLauncher, quoteShell } from '../overrides/prepare-app.mjs'

test('launches in Bamboo-owned data directories without inheriting Harness overrides', () => {
  const environment = runtimeEnvironment('/workspace/bamboo', {
    HOME: '/home/user', PATH: '/usr/bin',
    DSH_HOME: '/official/data', DSH_DESKTOP_DSH_DIR: '/official/runtime',
    DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: '{"origin":"https://example.test"}',
    ELECTRON_RUN_AS_NODE: '1',
  })
  assert.equal(environment.HOME, '/home/user')
  assert.equal(environment.DSH_HOME, '/workspace/bamboo/.local/bamboo/runtime')
  assert.equal(environment.DSH_DESKTOP_USER_DATA_DIR, '/workspace/bamboo/.local/bamboo/desktop')
  assert.equal(environment.DSH_TELEMETRY_DISABLED, '1')
  assert.equal(environment.DSH_DESKTOP_DSH_DIR, undefined)
  assert.equal(environment.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG, undefined)
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
})

test('honors an explicit Bamboo home without changing the system home', () => {
  const environment = runtimeEnvironment('/workspace', { HOME: '/home/user', BAMBOO_HOME: '/data/Bamboo Work' })
  assert.equal(environment.DSH_HOME, '/data/Bamboo Work/runtime')
  assert.equal(environment.HOME, '/home/user')
})

test('launch scripts preserve literal paths and arguments without shell expansion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bamboo-launch-'))
  try {
    const appRoot = join(directory, "project ' $(touch injected)")
    const bundle = join(directory, 'Bamboo Desktop.app')
    const executable = join(bundle, 'Contents/MacOS/Electron')
    const result = join(directory, 'result.json')
    mkdirSync(appRoot)
    mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true })
    writeFileSync(executable, `#!/bin/sh\nexec ${quoteShell(process.execPath)} ${quoteShell(join(directory, 'capture.mjs'))} "$@"\n`, { mode: 0o755 })
    writeFileSync(join(directory, 'capture.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(result)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), value: process.env.BAMBOO_PROFILE, node: process.env.ELECTRON_RUN_AS_NODE }));`)
    const userData = join(directory, 'user data')
    const value = "literal ' `$HOME` $(touch injected)"
    const script = join(directory, 'launch.sh')
    writeFileSync(script, desktopLauncher(bundle, appRoot, { DSH_DESKTOP_USER_DATA_DIR: userData, BAMBOO_PROFILE: value }))
    execFileSync('/bin/sh', [script, '--another=value'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    assert.deepEqual(JSON.parse(readFileSync(result, 'utf8')), {
      argv: [`--user-data-dir=${userData}`, appRoot, '--another=value'], cwd: realpathSync(appRoot), value,
    })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('rejects paths and shell inputs outside the generated-file contract', () => {
  assert.equal(checkedPath('/workspace/upstream', 'apps/desktop/src/main.ts'), '/workspace/upstream/apps/desktop/src/main.ts')
  for (const value of ['../outside', '/absolute', '.', '../../']) {
    assert.throws(() => checkedPath('/workspace/upstream', value))
  }
  assert.throws(() => quoteShell('invalid\0path'))
  assert.throws(() => desktopLauncher('/app', '/workspace', { 'BAD;KEY': 'value' }))
})
