import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function quoteShell(value) {
  if (value.includes('\0')) throw new Error('Shell arguments cannot contain NUL')
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function desktopLauncher(bundle, appRoot, environment) {
  const lines = ['#!/bin/sh', 'unset ELECTRON_RUN_AS_NODE']
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment variable name')
    lines.push(`export ${key}=${quoteShell(value)}`)
  }
  lines.push(`cd ${quoteShell(appRoot)} || exit 1`)
  lines.push(`exec ${quoteShell(join(bundle, 'Contents/MacOS/Electron'))} ${quoteShell('--user-data-dir=' + environment.DSH_DESKTOP_USER_DATA_DIR)} ${quoteShell(appRoot)} "$@"`)
  return lines.join('\n') + '\n'
}

export function prepareApp(electron, appRoot, directory, environment, icon) {
  const bundle = join(directory, 'Bamboo Desktop.app')
  const executable = join(bundle, 'Contents/MacOS/BambooDesktop')
  const stamp = join(bundle, 'Contents/Resources/bamboo-development.json')
  const source = dirname(dirname(dirname(electron)))
  const launcher = desktopLauncher(bundle, appRoot, environment)
  const identity = createHash('sha256').update(launcher).update(readFileSync(join(source, 'Contents/Info.plist'))).update(readFileSync(icon)).digest('hex')
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === identity) return executable
  rmSync(bundle, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  execFileSync('/usr/bin/ditto', [source, bundle])
  const plist = join(bundle, 'Contents/Info.plist')
  const values = {
    CFBundleIdentifier: 'com.bambooroute.desktop.dev',
    CFBundleName: 'Bamboo Desktop',
    CFBundleDisplayName: 'Bamboo Desktop',
    CFBundleExecutable: 'BambooDesktop',
    CFBundleIconFile: 'bamboo.icns',
    CFBundleURLTypes: [{ CFBundleURLName: 'Bamboo Desktop', CFBundleURLSchemes: ['bamboo'], CFBundleTypeRole: 'Viewer' }],
  }
  for (const [key, value] of Object.entries(values)) {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-json', JSON.stringify(value), plist])
  }
  const iconset = join(directory, 'Bamboo.iconset')
  mkdirSync(iconset, { recursive: true })
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale)
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
      execFileSync('/usr/bin/sips', ['-z', pixels, pixels, icon, '--out', join(iconset, name)], { stdio: 'pipe' })
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(bundle, 'Contents/Resources/bamboo.icns')])
  rmSync(iconset, { recursive: true, force: true })
  writeFileSync(executable, launcher, { mode: 0o755 })
  writeFileSync(stamp, identity)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' })
  return executable
}
