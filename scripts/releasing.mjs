import { appendFileSync, cpSync, mkdirSync, openAsBlob, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileHash, previewVersion, targets } from './packaging.mjs'

const checks = ['runtime', 'officeConversion', 'offlinePlugins', 'bambooHost', 'bambooCatalog']
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'))

export function prepareRelease({ input, output, version, commit, run, number, attempt, repository }) {
  if (repository !== 'BambooRoute/desktop' || !/^[a-f0-9]{40}$/.test(commit)
    || !/^[1-9]\d*$/.test(run) || !/^[1-9]\d*$/.test(attempt)) {
    throw new Error('Release requires the Bamboo repository and valid workflow provenance')
  }
  const preview = previewVersion(version, number)
  const selected = Object.entries(targets).map(([target, { extension }]) => {
    const candidates = readdirSync(input).map(name => ({
      name, match: new RegExp(`^bamboo-preview-${target}-${number}-([1-9]\\d*)$`).exec(name),
    })).filter(item => item.match && Number(item.match[1]) <= Number(attempt))
      .sort((a, b) => Number(b.match[1]) - Number(a.match[1]))
    if (!candidates.length) throw new Error(`Missing verified ${target} artifact`)
    const directory = join(input, candidates[0].name)
    const manifest = readJSON(join(directory, 'build-manifest.json'))
    const verification = readJSON(join(directory, 'verification.json'))
    const file = `bamboo-desktop-${preview}-${target}-unsigned${extension}`
    if (manifest.schemaVersion !== 1 || manifest.commit !== commit || manifest.version !== preview
      || manifest.run !== run || manifest.attempt !== candidates[0].match[1]
      || manifest.target !== target || manifest.dirty !== false || manifest.signing !== 'unsigned'
      || manifest.artifacts?.length !== 1 || manifest.artifacts[0].file !== file) {
      throw new Error(`Invalid ${target} build provenance`)
    }
    for (const report of [verification, manifest.verification]) {
      if (!report || report.paidModelCalls !== 0 || checks.some(check => report[check] !== 'passed')) {
        throw new Error(`Missing successful ${target} verification`)
      }
    }
    const installer = manifest.artifacts[0]
    if (installer.bytes <= 0 || statSync(join(directory, file)).size !== installer.bytes
      || fileHash(join(directory, file)) !== installer.sha256
      || readFileSync(join(directory, 'SHA256SUMS'), 'utf8') !== `${installer.sha256}  ${file}\n`) {
      throw new Error(`Installer checksum mismatch for ${target}`)
    }
    return { target, directory, installer }
  })
  mkdirSync(output, { recursive: true })
  const files = []
  for (const { target, directory, installer } of selected) {
    files.push({ name: installer.file, path: join(directory, installer.file) })
    for (const kind of ['build-manifest', 'verification']) {
      const name = `${kind}-${target}.json`
      cpSync(join(directory, `${kind}.json`), join(output, name))
      files.push({ name, path: join(output, name) })
    }
  }
  writeFileSync(join(output, 'SHA256SUMS'), selected.map(({ installer }) => `${installer.sha256}  ${installer.file}\n`).join(''))
  files.push({ name: 'SHA256SUMS', path: join(output, 'SHA256SUMS') })
  return {
    repository, commit, version: preview, tag: `desktop-v${preview}`,
    files: files.map(file => ({ ...file, size: statSync(file.path).size, digest: `sha256:${fileHash(file.path)}` })),
    body: [
      'Bamboo Desktop preview installers for macOS Apple Silicon and Windows x64. Intel Macs are not supported.',
      'Download the `.dmg` for Apple Silicon or the `.exe` for Windows x64. Node.js and a source checkout are not required.',
      'This is an unsigned preview for testing. macOS uses an ad-hoc signature and is not notarized; the Windows installer is not Authenticode signed. Automatic updates are disabled.',
      'Both packages passed build and type checks, UI tests, packaged native-runtime checks, offline plugin installation, Office-to-PDF conversion, and Bamboo Host/model-catalog verification. No paid model calls were made. Interactive Windows installation and real-account sign-in have not been manually verified.',
      'SHA-256 checksums, build manifests, and verification reports are included. The workflow verifies every uploaded asset before publishing this release.',
      `Source commit: \`${commit}\`.`,
      `[Verified GitHub Actions build](https://github.com/${repository}/actions/runs/${run})`,
    ].join('\n\n') + '\n',
  }
}

export function githubRequest(token) {
  if (!token) throw new Error('GH_TOKEN is required for release publication')
  return async (path, options = {}) => {
    const url = new URL(path, 'https://api.github.com')
    if (url.protocol !== 'https:' || !['api.github.com', 'uploads.github.com'].includes(url.hostname)) {
      throw new Error('Unexpected GitHub API destination')
    }
    const response = await fetch(url, {
      method: options.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(10 * 60_000),
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Bamboo-Desktop-Release',
        ...(options.file ? { 'Content-Type': 'application/octet-stream', 'Content-Length': String(options.file.size) }
          : options.json ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.file ? { body: await openAsBlob(options.file.path) }
        : options.json ? { body: JSON.stringify(options.json) } : {}),
    })
    if (response.status === 404 && options.optional) return null
    if (!response.ok) throw new Error(`GitHub ${options.method ?? 'GET'} ${url.pathname} failed (${response.status})`)
    return response.status === 204 ? null : response.json()
  }
}

const matches = (asset, file) => asset?.state === 'uploaded' && asset.size === file.size && asset.digest === file.digest

export async function publishRelease(plan, request) {
  const root = `/repos/${plan.repository}`
  let ref = await request(`${root}/git/ref/tags/${plan.tag}`, { optional: true })
  for (let depth = 0; ref?.object.type === 'tag' && depth < 5; depth++) {
    ref = await request(`${root}/git/tags/${ref.object.sha}`)
  }
  if (ref && (ref.object.type !== 'commit' || ref.object.sha !== plan.commit)) {
    throw new Error('Existing release tag points to a different source commit')
  }
  let release = await request(`${root}/releases/tags/${plan.tag}`, { optional: true })
  if (!release) release = await request(`${root}/releases`, {
    method: 'POST', json: {
      tag_name: plan.tag, target_commitish: plan.commit, name: `Bamboo Desktop ${plan.version}`,
      body: plan.body, draft: true, prerelease: true, make_latest: 'false',
    },
  })
  if (release.tag_name !== plan.tag || release.prerelease !== true
    || (release.draft && release.target_commitish !== plan.commit)
    || (!release.draft && release.html_url !== `https://github.com/${plan.repository}/releases/tag/${plan.tag}`)) {
    throw new Error('Existing release does not match this preview')
  }
  const assetsPath = `${root}/releases/${release.id}/assets?per_page=100`
  const existing = await request(assetsPath)
  if (existing.some(asset => !plan.files.some(file => file.name === asset.name))) {
    throw new Error('Release contains unexpected assets')
  }
  if (!release.draft) {
    if (!ref || existing.length !== plan.files.length
      || plan.files.some(file => !matches(existing.find(asset => asset.name === file.name), file))) {
      throw new Error('Published releases cannot be overwritten; start a new workflow run')
    }
    return release
  }
  for (const file of plan.files) {
    const asset = existing.find(asset => asset.name === file.name)
    if (matches(asset, file)) continue
    if (asset) await request(`${root}/releases/assets/${asset.id}`, { method: 'DELETE' })
    const uploaded = await request(`https://uploads.github.com${root}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST', file,
    })
    if (!matches(uploaded, file)) throw new Error(`Uploaded checksum mismatch for ${file.name}`)
  }
  const uploaded = await request(assetsPath)
  if (uploaded.length !== plan.files.length
    || plan.files.some(file => !matches(uploaded.find(asset => asset.name === file.name), file))) {
    throw new Error('Release assets are incomplete or do not match the verified packages')
  }
  release = await request(`${root}/releases/${release.id}`, {
    method: 'PATCH', json: { body: plan.body, draft: false, prerelease: true, make_latest: 'false' },
  })
  if (release.draft || !release.prerelease || !release.published_at
    || release.html_url !== `https://github.com/${plan.repository}/releases/tag/${plan.tag}`) {
    throw new Error('Release publication was not confirmed')
  }
  return release
}

export function recordRelease(release, summary) {
  console.log(`Published preview: ${release.html_url}`)
  if (summary) appendFileSync(summary, `## Bamboo Desktop preview\n\n[${release.tag_name}](${release.html_url})\n\nBoth installers and all verification assets were checked before publication.\n`)
}

export async function sourceReleaseRun(repository, runID, request) {
  if (repository !== 'BambooRoute/desktop' || !/^[1-9]\d*$/.test(runID)) throw new Error('A Bamboo packaging run ID is required')
  const root = `/repos/${repository}`
  const run = await request(`${root}/actions/runs/${runID}`)
  if (String(run.id) !== runID || run.path !== '.github/workflows/desktop-package.yml'
    || run.status !== 'completed' || run.head_repository?.full_name !== repository
    || !['workflow_dispatch', 'push'].includes(run.event)
    || (run.head_branch !== 'main' && !run.head_branch?.startsWith('desktop-preview-'))
    || !/^[a-f0-9]{40}$/.test(run.head_sha)
    || !Number.isSafeInteger(run.run_number) || run.run_number < 1
    || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error('Source must be a completed trusted desktop packaging run')
  }
  const { jobs } = await request(`${root}/actions/runs/${runID}/jobs?filter=latest&per_page=100`)
  for (const target of Object.keys(targets)) {
    if (!jobs.some(job => job.name === `Package ${target}` && job.conclusion === 'success')) {
      throw new Error(`Source run has no successful ${target} packaging job`)
    }
  }
  const source = await request(`${root}/contents/package.json?ref=${run.head_sha}`)
  if (source.encoding !== 'base64') throw new Error('Source package metadata could not be read')
  const { version } = JSON.parse(Buffer.from(source.content, 'base64').toString('utf8'))
  previewVersion(version, String(run.run_number))
  return {
    run: runID, number: String(run.run_number), attempt: String(run.run_attempt),
    commit: run.head_sha, version,
  }
}
