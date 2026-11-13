import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkedPath, replaceRequired, root, upstream } from './config.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')

export function applyOverrides(directory) {
  const git = args => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trimEnd()
  if (git(['rev-parse', 'HEAD']) !== upstream.commit) throw new Error('Upstream checkout does not match config/upstream.json')
  const original = path => execFileSync('git', ['-C', directory, 'show', `${upstream.commit}:${path}`], { encoding: 'utf8' })
  const output = new Map()
  const replace = (path, changes) => {
    let text = original(path)
    for (const [before, after] of changes) text = replaceRequired(text, before, after, path)
    output.set(path, text)
  }
  const copy = (source, destination) => output.set(destination, readFileSync(join(root, 'overrides', source)))

  copy('WelcomePage.tsx', 'apps/desktop/src/client/WelcomePage.tsx')
  copy('welcome.css', 'apps/desktop/renderer/welcome.css')
  copy('mark.svg', 'apps/desktop/renderer/assets/welcome-brand.svg')
  copy('launch.ts', 'apps/desktop/scripts/bamboo.ts')
  copy('brand.ts', 'packages/client/ui-brand-official/src/client/index.ts')
  copy('Brand.tsx', 'packages/client/ui-brand-official/src/client/Brand.tsx')
  copy('prepare-app.mjs', 'apps/desktop/scripts/bamboo-app.mjs')
  copy('prepare-app.d.mts', 'apps/desktop/scripts/bamboo-app.d.mts')
  copy('vitest.config.ts', 'apps/desktop/scripts/bamboo.vitest.config.ts')
  for (const file of ['bamboo-account.mjs', 'bamboo-account.d.mts', 'bamboo-bridge.mjs', 'bamboo-bridge.d.mts', 'bamboo-types.ts']) {
    copy(file, 'apps/desktop/src/' + file)
  }
  copy('desktop-account.ts', 'apps/desktop/src/bamboo-desktop.ts')
  copy('bootstrap.ts', 'apps/desktop/src/bamboo-bootstrap.ts')
  copy('builder.mjs', 'apps/desktop/scripts/bamboo-builder.mjs')
  copy('package-assets.mjs', 'apps/desktop/scripts/bamboo-package-assets.mjs')
  copy('pack-local.ts', 'apps/desktop/scripts/bamboo-pack-local.ts')
  copy('smoke-package.ts', 'apps/desktop/scripts/bamboo-smoke-package.ts')
  copy('installed-environment.mjs', 'apps/desktop/src/bamboo-installed-environment.mjs')
  copy('installed-environment.d.mts', 'apps/desktop/src/bamboo-installed-environment.d.mts')
  replace('apps/desktop/scripts/prepare-runtime.ts', [
    ['artifactName: \'electron\', cacheRoot: BUILD_PATHS.downloads', "artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads, checksums: require('electron/checksums.json') as Record<string, string>"],
  ])
  replace('apps/desktop/scripts/smoke-runtime.ts', [
    ['- id: webserver\\n  config:\\n    host: 127.0.0.1\\n    port: 0\\n', '- id: webserver\\n  config:\\n    host: 127.0.0.1\\n    port: 0\\n- id: web-runtime\\n  config:\\n    printUrl: false\\n'],
  ])
  copy('preload-account.ts', 'apps/desktop/src/preload-bamboo.ts')
  copy('welcome-backend.ts', 'apps/desktop/src/welcome-backend.ts')
  copy('host-bridge.ts', 'apps/desktop-host/src/bamboo-bridge.ts')
  copy('llm-bamboo.ts', 'packages/llm/llm-pi-ai/src/bamboo.ts')
  copy('account-client.ts', 'packages/client/ui-settings-account/src/client/index.ts')
  copy('AccountPanel.tsx', 'packages/client/ui-settings-account/src/client/BambooAccount.tsx')
  copy('AccountPanel.module.css', 'packages/client/ui-settings-account/src/client/BambooAccount.module.css')
  copy('bamboo-types.ts', 'packages/client/ui-settings-account/src/client/bamboo-types.ts')
  copy('catalog-account.ts', 'packages/client/ui-model-selection/src/client/bamboo-account.ts')
  output.set('apps/desktop/tests/bamboo-account.client.spec.tsx', readFileSync(join(root, 'test/account.client.spec.tsx')))
  output.set('apps/desktop/tests/bamboo-welcome.client.spec.tsx', readFileSync(join(root, 'test/welcome.client.spec.tsx')))
  output.set('apps/desktop/tests/welcome-host.spec.ts', readFileSync(join(root, 'test/welcome-host.spec.ts')))
  output.set('apps/desktop/tests/bamboo-catalog.client.spec.tsx', readFileSync(join(root, 'test/catalog-account.spec.ts')))
  output.set('apps/desktop/scripts/bamboo-profile.json', readFileSync(join(root, 'config/profile.patch.json')))

  replace('apps/desktop/src/locale.ts', [['DeepSeek Harness', 'Bamboo Desktop']])
  replace('apps/web/index.html', [['<title>DSH Local Build</title>', '<title>Bamboo Desktop</title>']])
  replace('packages/client/ui-conversation/src/client/locales.ts', [["'hero.headline': 'Into the Unknown'", "'hero.headline': 'What will you build?'" ]])
  replace('apps/desktop-host/src/index.ts', [
    ["import { delimiter, join } from 'node:path'", "import { delimiter, join } from 'node:path'\nimport { receiveBambooBridge } from './bamboo-bridge.ts'"],
    ["  const runtimeDir = process.argv[2] as string", "  if (process.env.BAMBOO_PROFILE) await receiveBambooBridge()\n  const runtimeDir = process.argv[2] as string"],
    ['    patchFiles: [],', "    patchFiles: process.env.BAMBOO_PROFILE ? [process.env.BAMBOO_PROFILE] : [],"],
  ])
  replace('packages/llm/llm-pi-ai/src/index.ts', [
    ["import { PiAiAdapter } from './adapter.ts'", "import { PiAiAdapter } from './adapter.ts'\nimport { applyBamboo } from './bamboo.ts'"],
    ['export function apply(ctx: Context, config: Config): void {', 'export function apply(ctx: Context, config: Config): void {\n  if (applyBamboo(ctx)) return'],
  ])
  replace('packages/api/session-controller/src/catalog.ts', [
    ['defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),', 'defaultSelection?: ModelSelection,'],
    ['default: { ...defaultSelection },', 'default: { ...(defaultSelection ?? ctx.agentDefaultModel.currentSelection()) },'],
  ])
  replace('packages/client/ui-model-selection/src/client/service.ts', [
    ["import { ModelCatalogDirectory } from './catalog.ts'", "import { ModelCatalogDirectory } from './catalog.ts'\nimport { watchDesktopCatalog } from './bamboo-account.ts'"],
    ["this.catalog = new ModelCatalogDirectory(ctx)", "this.catalog = new ModelCatalogDirectory(ctx)\n    ctx.effect(() => watchDesktopCatalog(() => this.catalog.resetGeneration()))"],
  ])
  replace('apps/desktop/src/host-process.ts', [
    ['private readonly onPluginOperation?: (record: PluginOperationRecord) => void,', 'private readonly onPluginOperation?: (record: PluginOperationRecord) => void,\n    private readonly bambooBridge?: { url: string; token: string },'],
    ["if (message.type === 'starting') this.runId = message.runId", "if (message.type === 'starting') {\n        this.runId = message.runId\n        if (this.bambooBridge) child.send({ type: 'bamboo-bridge', url: this.bambooBridge.url, token: this.bambooBridge.token }, error => { if (error) this.fail(new Error('Bamboo Host connection failed')) })\n      }"],
  ])
  for (const path of ['apps/desktop/src/preload-app.ts', 'apps/desktop/src/preload-welcome.ts']) {
    output.set(path, "import './preload-bamboo.ts'\n" + original(path))
  }
  replace('apps/desktop/tsdown.config.ts', [
    ['    define: clientVersionDefine,', "    define: clientVersionDefine,\n    alias: {\n      './bamboo-account.mjs': fileURLToPath(new URL('./src/bamboo-account.mjs', import.meta.url)),\n      './bamboo-bridge.mjs': fileURLToPath(new URL('./src/bamboo-bridge.mjs', import.meta.url)),\n      './bamboo-installed-environment.mjs': fileURLToPath(new URL('./src/bamboo-installed-environment.mjs', import.meta.url)),\n    },"],
  ])
  const clientConfig = JSON.parse(original('apps/desktop/tsconfig.client.json'))
  clientConfig.include.push('src/bamboo-types.ts')
  output.set('apps/desktop/tsconfig.client.json', JSON.stringify(clientConfig, null, 2) + '\n')
  replace('apps/desktop/src/login-shell-environment.ts', [
    ["['DSH_', 'ELECTRON_']", "['DSH_', 'ELECTRON_', 'BAMBOO_']"],
  ])
  replace('apps/desktop/src/main.ts', [
    ["import { installFileActions }", "import './bamboo-bootstrap.ts'\nimport { installFileActions }"],
    ["import { openWelcomeWindow } from './welcome-window.ts'", "import { openWelcomeWindow } from './welcome-window.ts'\nimport { createBambooDesktop } from './bamboo-desktop.ts'"],
    ['async function main(): Promise<void> {', 'async function main(): Promise<void> {\n  const bambooBridge = await createBambooDesktop()'],
    ['operationJournal.enqueue(JSON.stringify(record))\n      })', 'operationJournal.enqueue(JSON.stringify(record))\n      }, bambooBridge)'],
    ['let focusPrimaryWindow = (): void => {}', "app.setName(process.env.BAMBOO_PRODUCT_NAME ?? 'Bamboo Desktop')\napp.setAppUserModelId(process.env.BAMBOO_APP_ID ?? 'com.bambooroute.desktop')\n\nlet focusPrimaryWindow = (): void => {}"],
    ["app.setAppLogsPath()", "app.setAppLogsPath(join(app.getPath('userData'), 'logs'))"],
    ["readDesktopLocaleCache(app.getPath('userData'))", "readDesktopLocaleCache(app.getPath('userData')) ?? 'en'"],
    ["applicationName: 'DeepSeek Harness'", "applicationName: 'Bamboo Desktop'"],
    ["app.setAsDefaultProtocolClient('dsh')", "app.setAsDefaultProtocolClient(process.env.BAMBOO_PROTOCOL ?? 'bamboo')"],
    ["url === 'dsh://open' || url === 'dsh://open/'", "url === `${process.env.BAMBOO_PROTOCOL ?? 'bamboo'}://open` || url === `${process.env.BAMBOO_PROTOCOL ?? 'bamboo'}://open/`"],
    ["    { label: currentDesktopLocale().messages.checkUpdatesMenu, click: () => { void openUpdatePrompt(true) } },\n", ''],
    ["    ...process.platform === 'darwin' || process.platform === 'win32'\n      ? [{ label: currentDesktopLocale().messages.cliCommandMenu, click: () => { void commandManager.show() } }] : [],\n", ''],
  ])
  replace('apps/desktop/src/update-coordinator.ts', [
    ["import { existsSync } from 'node:fs'\n", ''],
    ["import { join } from 'node:path'\n", ''],
    ["private readonly enabled: () => boolean = () => app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))", 'private readonly enabled: () => boolean = () => false'],
  ])
  const manifest = JSON.parse(original('apps/desktop/package.json'))
  manifest.productName = 'Bamboo Desktop'
  manifest.description = 'BambooRoute desktop workspace'
  output.set('apps/desktop/package.json', JSON.stringify(manifest, null, 2) + '\n')

  const manifestPath = join(directory, '.bamboo-overrides.json')
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  for (const [path, content] of output) {
    const target = checkedPath(directory, path)
    if (!existsSync(target) || readFileSync(target).equals(Buffer.from(content))) continue
    const current = readFileSync(target)
    if (previous[path] === digest(current)) continue
    let source
    try { source = Buffer.from(original(path)) } catch { throw new Error(`Refusing to replace an unmanaged file: ${path}`) }
    if (!source.equals(current)) throw new Error(`Unmanaged edits in upstream checkout: ${path}`)
  }
  const hashes = {}
  for (const [path, content] of output) {
    const target = checkedPath(directory, path)
    hashes[path] = digest(content)
    if (existsSync(target) && digest(readFileSync(target)) === hashes[path]) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target + '.bamboo-tmp', content)
    renameSync(target + '.bamboo-tmp', target)
  }
  writeFileSync(manifestPath, JSON.stringify(hashes, null, 2) + '\n')
  return hashes
}
