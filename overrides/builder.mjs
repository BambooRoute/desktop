import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareWindowsAsarUnpack, verifyWindowsAsarUnpack } from './windows-asar-unpack.mjs'
import { officePackageDirectories } from '../../../scripts/libreoffice-packages.mjs'
import { relative, sep } from 'node:path'

const metadata = JSON.parse(readFileSync(process.env.BAMBOO_PACKAGE_METADATA, 'utf8'))
const target = resolveDesktopBuildTarget()
if (!['mac-arm64', 'win-x64'].includes(target) || metadata.target !== target) throw new Error('Unsupported Bamboo package target')
const paths = desktopTargetBuildPaths(target)
const windows = target === 'win-x64'
const appRoot = join(import.meta.dirname, '..')
let windowsCode = []

export default {
  appId: metadata.appId,
  productName: metadata.productName,
  artifactName: `bamboo-desktop-\${version}-${target}-unsigned.\${ext}`,
  protocols: [{ name: metadata.productName, schemes: [metadata.protocol] }],
  extraMetadata: {
    name: '@bambooroute/desktop',
    version: metadata.version,
    productName: metadata.productName,
    description: 'BambooRoute desktop workspace',
    author: { name: 'BambooRoute', url: metadata.site },
    homepage: metadata.site,
    dshDesktopAppId: metadata.appId,
    dshDesktopUpdateChannel: 'nightly',
    bamboo: { channel: 'preview', commit: metadata.commit, upstreamCommit: metadata.upstream.commit },
  },
  directories: { output: process.env.BAMBOO_PACKAGE_OUTPUT },
  electronDist: paths.electron,
  asar: true,
  electronFuses: { runAsNode: true },
  files: [
    'lib/main.js', 'lib/operation-report-worker.js', 'lib/welcome/**/*',
    'lib/preload-*.cjs', 'renderer/**/*', 'package.json',
    '!node_modules/**/*.{js,cjs,mjs,ts,cts,mts,css}.map', '!node_modules/**/*.tsbuildinfo',
    { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
    { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
  ],
  asarUnpack: [
    '**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep-*/bin/rg',
    '**/node_modules/@deepseek-ai/dsh-experimental-cua-macos/native/bin/**/*',
  ],
  extraResources: [
    { from: paths.runtime, to: 'runtime' },
    { from: process.env.BAMBOO_PACKAGE_RESOURCES, to: 'bamboo' },
    { from: join(appRoot, 'resources/bamboo/icon.png'), to: 'icon.png' },
    ...(windows ? [{ from: join(appRoot, 'resources/bamboo/icon.ico'), to: 'tray.ico' }] : []),
  ],
  mac: {
    icon: join(appRoot, 'resources/bamboo/icon.png'),
    category: 'public.app-category.developer-tools',
    identity: '-',
    hardenedRuntime: true,
    entitlements: join(import.meta.dirname, 'macos-entitlements.plist'),
    entitlementsInherit: join(import.meta.dirname, 'macos-entitlements.plist'),
    signIgnore: ['/Contents/Resources/app\\.asar\\.unpacked/dsh(?:/|$)', '/Contents/Resources/runtime/primary-runtime(?:/|$)', '\\.pak$'],
    notarize: false,
    target: [{ target: 'dmg', arch: ['arm64'] }],
    extendInfo: { NSMicrophoneUsageDescription: 'Bamboo uses your microphone to transcribe speech into message drafts.' },
  },
  dmg: { format: 'UDZO', sign: false, writeUpdateInfo: false },
  win: {
    icon: join(appRoot, 'resources/bamboo/icon.ico'),
    target: [{ target: 'nsis', arch: ['x64'] }],
    signAndEditExecutable: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    differentialPackage: false,
    uninstallDisplayName: metadata.productName,
  },
  publish: null,
  beforePack: async context => {
    const office = await officePackageDirectories(paths.dsh, { platform: windows ? 'win32' : 'darwin', arch: windows ? 'x64' : 'arm64' })
    context.packager.config.asarUnpack.push(...office.map(directory =>
      `**/${relative(paths.dsh, directory).split(sep).join('/')}/**/*`))
    if (windows) windowsCode = await prepareWindowsAsarUnpack(context, paths.dsh)
  },
  afterPack: async context => {
    if (windows) await verifyWindowsAsarUnpack(paths.dsh, context.packager.getResourcesDir(context.appOutDir), windowsCode)
  },
}
