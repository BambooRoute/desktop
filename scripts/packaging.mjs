import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const targets = Object.freeze({
  'mac-arm64': Object.freeze({ platform: 'darwin', arch: 'arm64', extension: '.dmg' }),
  'win-x64': Object.freeze({ platform: 'win32', arch: 'x64', extension: '.exe' }),
})

export function packageTarget(name, platform = process.platform, arch = process.arch) {
  if (!Object.hasOwn(targets, name)) throw new Error('Choose mac-arm64 or win-x64. Intel Macs are not supported.')
  const target = targets[name]
  if (platform !== target.platform || arch !== target.arch) {
    throw new Error(`${name} requires a ${target.platform} ${target.arch} build machine`)
  }
  return target
}

export function previewVersion(version, build = '0') {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    || !/^(0|[1-9]\d*)$/.test(build) || Number(build) > 65535) {
    throw new Error('Preview builds require a stable product version and a build number from 0 to 65535')
  }
  return `${version}-preview.${build}`
}

export function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

