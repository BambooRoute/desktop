import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileHash } from '../scripts/packaging.mjs'
import { prepareRelease, publishRelease, sourceReleaseRun } from '../scripts/releasing.mjs'

function fixture(t) {
  const input = mkdtempSync(join(tmpdir(), 'bamboo-release-'))
  t.after(() => rmSync(input, { recursive: true, force: true }))
  const options = {
    input, output: join(input, 'output'), version: '0.1.0', commit: 'a'.repeat(40),
    run: '1234', number: '6', attempt: '2', repository: 'BambooRoute/desktop',
  }
  const directories = {}
  for (const [target, extension] of [['mac-arm64', 'dmg'], ['win-x64', 'exe']]) {
    const directory = join(input, `bamboo-preview-${target}-6-1`)
    directories[target] = directory
    mkdirSync(directory)
    const file = `bamboo-desktop-0.1.0-preview.6-${target}-unsigned.${extension}`
    writeFileSync(join(directory, file), 'verified installer')
    const sha256 = fileHash(join(directory, file))
    const verification = {
      runtime: 'passed', officeConversion: 'passed', offlinePlugins: 'passed',
      bambooHost: 'passed', bambooCatalog: 'passed', paidModelCalls: 0,
    }
    writeFileSync(join(directory, 'verification.json'), JSON.stringify(verification))
    writeFileSync(join(directory, 'SHA256SUMS'), `${sha256}  ${file}\n`)
    writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify({
      schemaVersion: 1, commit: options.commit, version: '0.1.0-preview.6', run: options.run,
      attempt: '1', target, dirty: false, signing: 'unsigned', verification,
      artifacts: [{ file, sha256, bytes: 18 }],
    }))
  }
  return { options, directories }
}

function changeJSON(path, update) {
  const value = JSON.parse(readFileSync(path, 'utf8'))
  update(value)
  writeFileSync(path, JSON.stringify(value))
}

test('prepares both verified installers and uniquely named reports from a previous successful attempt', t => {
  const { options } = fixture(t)
  const plan = prepareRelease(options)
  assert.equal(plan.tag, 'desktop-v0.1.0-preview.6')
  assert.equal(plan.files.length, 7)
  assert.equal(new Set(plan.files.map(file => file.name)).size, 7)
  assert.equal(readFileSync(join(options.output, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 2)
  assert.match(plan.body, /not notarized/)
})

test('refuses to publish a one-platform result', t => {
  const { options, directories } = fixture(t)
  rmSync(directories['win-x64'], { recursive: true })
  assert.throws(() => prepareRelease(options), /Missing verified win-x64/)
})

test('rejects changed installer contents even when the manifest and checksum file agree', t => {
  const { options, directories } = fixture(t)
  writeFileSync(join(directories['win-x64'], 'bamboo-desktop-0.1.0-preview.6-win-x64-unsigned.exe'), 'modified installer')
  assert.throws(() => prepareRelease(options), /checksum mismatch/)
})

for (const [name, update] of [
  ['a different commit', manifest => { manifest.commit = 'b'.repeat(40) }],
  ['a different workflow run', manifest => { manifest.run = '9999' }],
  ['an unclean checkout', manifest => { manifest.dirty = true }],
  ['an unexpected installer path', manifest => { manifest.artifacts[0].file = '../outside.exe' }],
]) {
  test(`rejects ${name}`, t => {
    const { options, directories } = fixture(t)
    changeJSON(join(directories['win-x64'], 'build-manifest.json'), update)
    assert.throws(() => prepareRelease(options), /provenance/)
  })
}

test('rejects failed runtime verification', t => {
  const { options, directories } = fixture(t)
  changeJSON(join(directories['mac-arm64'], 'verification.json'), value => { value.bambooHost = 'failed' })
  assert.throws(() => prepareRelease(options), /verification/)
})

test('uses the latest available artifact for each platform when failed jobs are retried', t => {
  const { options, directories } = fixture(t)
  const newer = join(options.input, 'bamboo-preview-win-x64-6-2')
  cpSync(directories['win-x64'], newer, { recursive: true })
  changeJSON(join(newer, 'build-manifest.json'), value => { value.attempt = '2' })
  const plan = prepareRelease(options)
  assert.equal(plan.files.find(file => file.name.endsWith('.exe')).path.startsWith(newer), true)
  rmSync(join(newer, 'verification.json'))
  assert.throws(() => prepareRelease(options), /verification.json/)
})

function service(plan, initial = null) {
  let release = initial
  const assets = initial ? plan.files.map((file, id) => ({ id: id + 1, name: file.name, size: file.size, digest: file.digest, state: 'uploaded' })) : []
  const calls = []
  const request = async (path, options = {}) => {
    calls.push({ path, ...options })
    if (path.includes('/git/ref/')) return release && !release.draft ? { object: { type: 'commit', sha: plan.commit } } : null
    if (path.includes('/releases/tags/')) return release
    if (path.endsWith('/releases') && options.method === 'POST') {
      assert.equal(options.json.draft, true)
      release = {
        id: 1, tag_name: plan.tag, prerelease: true, draft: true, target_commitish: plan.commit,
        html_url: `https://github.com/${plan.repository}/releases/tag/untagged-draft`,
      }
      return release
    }
    if (path.includes('/assets?name=')) {
      const file = options.file
      const asset = { id: assets.length + 1, name: file.name, size: file.size, digest: file.digest, state: 'uploaded' }
      assets.push(asset)
      return asset
    }
    if (path.endsWith('/assets?per_page=100')) return assets
    if (options.method === 'DELETE') {
      assets.splice(assets.findIndex(asset => path.endsWith('/' + asset.id)), 1)
      return null
    }
    if (options.method === 'PATCH') {
      assert.equal(assets.length, 7)
      assert.equal(options.json.make_latest, 'false')
      release = {
        ...release, ...options.json, published_at: '2026-11-13T00:00:00Z',
        html_url: `https://github.com/${plan.repository}/releases/tag/${plan.tag}`,
      }
      return release
    }
    throw new Error(`Unexpected request ${path}`)
  }
  return { request, calls, assets }
}

test('uploads and verifies every asset while the release is still a draft', async t => {
  const { options } = fixture(t)
  const plan = prepareRelease(options)
  const api = service(plan)
  const release = await publishRelease(plan, api.request)
  assert.equal(release.draft, false)
  assert.equal(api.calls.filter(call => call.file).length, 7)
  assert.equal(api.calls.at(-1).method, 'PATCH')
})

test('does not publish when GitHub reports a different uploaded checksum', async t => {
  const { options } = fixture(t)
  const plan = prepareRelease(options)
  const api = service(plan)
  await assert.rejects(publishRelease(plan, async (path, options) => {
    const result = await api.request(path, options)
    return options?.file ? { ...result, digest: 'sha256:wrong' } : result
  }), /Uploaded checksum mismatch/)
  assert.equal(api.calls.some(call => call.method === 'PATCH'), false)
})

test('resumes an unfinished draft and replaces only missing or mismatched assets', async t => {
  const { options } = fixture(t)
  const plan = prepareRelease(options)
  const api = service(plan, {
    id: 1, tag_name: plan.tag, draft: true, prerelease: true, target_commitish: plan.commit,
    html_url: `https://github.com/${plan.repository}/releases/tag/${plan.tag}`,
  })
  api.assets.pop()
  api.assets[0].digest = 'sha256:incomplete'
  await publishRelease(plan, api.request)
  assert.equal(api.calls.filter(call => call.method === 'DELETE').length, 1)
  assert.equal(api.calls.filter(call => call.file).length, 2)
  assert.equal(api.calls.at(-1).method, 'PATCH')
})

test('rerunning a completed release leaves identical published assets untouched', async t => {
  const { options } = fixture(t)
  const plan = prepareRelease(options)
  const api = service(plan, {
    id: 1, tag_name: plan.tag, draft: false, prerelease: true,
    html_url: `https://github.com/${plan.repository}/releases/tag/${plan.tag}`,
  })
  await publishRelease(plan, api.request)
  assert.equal(api.calls.some(call => call.method), false)
  api.assets[0].digest = 'sha256:different'
  await assert.rejects(publishRelease(plan, api.request), /cannot be overwritten/)
  assert.equal(api.calls.some(call => call.method), false)
})

test('rejects a tag that already identifies different source code', async t => {
  const { options } = fixture(t)
  const plan = prepareRelease(options)
  await assert.rejects(publishRelease(plan, async () => ({ object: { type: 'commit', sha: 'b'.repeat(40) } })), /different source commit/)
})

test('recovery uses the source run provenance after both packaging jobs succeeded', async () => {
  const source = {
    id: 1234, run_number: 6, run_attempt: 2, head_sha: 'a'.repeat(40),
    path: '.github/workflows/desktop-package.yml', head_branch: 'main', event: 'workflow_dispatch',
    status: 'completed', conclusion: 'failure', head_repository: { full_name: 'BambooRoute/desktop' },
  }
  const jobs = ['mac-arm64', 'win-x64'].map(target => ({ name: `Package ${target}`, conclusion: 'success' }))
  const request = async path => path.includes('/jobs?') ? { jobs }
    : path.includes('/contents/') ? { encoding: 'base64', content: Buffer.from('{"version":"0.1.0"}').toString('base64') }
      : source
  assert.deepEqual(await sourceReleaseRun('BambooRoute/desktop', '1234', request), {
    run: '1234', number: '6', attempt: '2', commit: source.head_sha, version: '0.1.0',
  })
  jobs[1].conclusion = 'failure'
  await assert.rejects(sourceReleaseRun('BambooRoute/desktop', '1234', request), /no successful win-x64/)
  source.head_branch = 'untrusted-feature'
  await assert.rejects(sourceReleaseRun('BambooRoute/desktop', '1234', request), /trusted/)
  source.head_branch = 'main'
  source.path = '.github/workflows/other.yml'
  await assert.rejects(sourceReleaseRun('BambooRoute/desktop', '1234', request), /trusted/)
})
