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
  for (const file of ['brand-font.css', 'instrument-sans-latin.woff2', 'instrument-sans-OFL.txt']) {
    copy(file, 'apps/desktop/renderer/assets/bamboo/' + file)
    copy(file, 'apps/web/public/assets/bamboo/' + file)
  }
  copy('mark.svg', 'apps/web/public/assets/bamboo/mark.svg')
  copy('workspace.css', 'apps/web/public/assets/bamboo/workspace.css')
  copy('apple-touch-icon.png', 'apps/web/public/assets/bamboo/apple-touch-icon.png')
  copy('manifest.webmanifest', 'apps/web/public/manifest.webmanifest')
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
    ['- id: webserver\\n  config:\\n    host: 127.0.0.1\\n    port: 0\\n', '- id: webserver\\n  config:\\n    host: 127.0.0.1\\n    port: 0\\n- id: web-runtime\\n  config:\\n    openBrowser: false\\n    printUrl: false\\n    surfaceContext: true\\n'],
  ])
  copy('preload-account.ts', 'apps/desktop/src/preload-bamboo.ts')
  copy('welcome-backend.ts', 'apps/desktop/src/welcome-backend.ts')
  copy('host-bridge.ts', 'apps/desktop-host/src/bamboo-bridge.ts')
  copy('llm-bamboo.ts', 'packages/llm/llm-pi-ai/src/bamboo.ts')
  for (const directory of ['packages/llm/llm-pi-ai/src', 'packages/client/ui-chat/src/client', 'packages/client/ui-trajectory/src/client']) {
    copy('bamboo-failure.ts', directory + '/bamboo-failure.ts')
    copy('account-locales.ts', directory + '/bamboo-account-locales.ts')
  }
  for (const path of ['packages/client/ui-chat/src/client/locale.ts', 'packages/client/ui-trajectory/src/client/locales.ts']) {
    let text = original(path)
    for (const locale of ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
      const declaration = path.includes('ui-trajectory') && locale === 'en' ? 'export const en: Record<TrajectoryKey, string> = {' : `export const ${locale} = {`
      text = replaceRequired(text, declaration, `${declaration}\n  ...bambooFailureLocales.${locale},`, path)
    }
    output.set(path, "import { bambooFailureLocales } from './bamboo-failure.ts'\n" + text)
  }
  replace('packages/client/ui-chat/src/client/chat/MessageItem.tsx', [
    ["import { memo,", "import { bambooFailureMessage } from '../bamboo-failure.ts'\nimport { memo,"],
    ["  if (code === 'ACCOUNT_SIGNED_OUT')", "  const bamboo = bambooFailureMessage(message, code, t)\n  if (bamboo !== undefined) return bamboo\n  if (code === 'ACCOUNT_SIGNED_OUT')"],
  ])
  replace('packages/client/ui-trajectory/src/client/TrajectoryTable.tsx', [
    ["import { useCallback,", "import { bambooFailureMessage } from './bamboo-failure.ts'\nimport { useCallback,"],
    ["  if (request.errorCode === 'AUTH')", "  const bamboo = bambooFailureMessage(request.error ?? '', request.errorCode, t)\n  if (bamboo !== undefined) return bamboo\n  if (request.errorCode === 'AUTH')"],
  ])
  for (const [path, module] of [
    ['packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts', '../bamboo-failure.ts'],
    ['packages/client/ui-trajectory/src/client/trajectory-event-projection.ts', './bamboo-failure.ts'],
  ]) {
    const text = replaceRequired(original(path), "  if (code === 'AUTH') return { code, message: '' }",
      "  const bamboo = typeof record.message === 'string' ? decodeBambooFailure({ code, message: record.message }) : undefined\n  if (bamboo) return bamboo\n  if (code === 'AUTH') return { code, message: '' }", path)
    output.set(path, `import { decodeBambooFailure } from '${module}'\n` + text)
  }

  output.set('packages/llm/llm-pi-ai/tests/bamboo-chat.spec.ts', readFileSync(join(root, 'test/bamboo-chat.spec.ts')))
  copy('account-client.ts', 'packages/client/ui-settings-account/src/client/index.ts')
  copy('account-locales.ts', 'packages/client/ui-settings-account/src/client/bamboo-account-locales.ts')
  copy('AccountPanel.tsx', 'packages/client/ui-settings-account/src/client/BambooAccount.tsx')
  copy('AccountPanel.module.css', 'packages/client/ui-settings-account/src/client/BambooAccount.module.css')
  copy('bamboo-types.ts', 'packages/client/ui-settings-account/src/client/bamboo-types.ts')
  copy('catalog-account.ts', 'packages/client/ui-model-selection/src/client/bamboo-account.ts')
  output.set('apps/desktop/tests/bamboo-account.client.spec.tsx', readFileSync(join(root, 'test/account.client.spec.tsx')))
  output.set('apps/desktop/tests/bamboo-welcome.client.spec.tsx', readFileSync(join(root, 'test/welcome.client.spec.tsx')))
  output.set('apps/desktop/tests/welcome-host.spec.ts', readFileSync(join(root, 'test/welcome-host.spec.ts')))
  output.set('apps/desktop/tests/bamboo-catalog.client.spec.tsx', readFileSync(join(root, 'test/catalog-account.spec.tsx')))
  output.set('apps/desktop/scripts/bamboo-profile.json', readFileSync(join(root, 'config/profile.patch.json')))

  replace('apps/desktop/src/locale.ts', [['DeepSeek Harness', 'Bamboo Desktop']])
  replace('apps/desktop/renderer/welcome.html', [
    ['../lib/welcome/brand-font.css', 'assets/bamboo/brand-font.css'],
  ])
  replace('apps/web/index.html', [
    ['<title>DSH Local Build</title>', '<title>Bamboo Desktop</title>'],
    ['<body>', '<body class="bamboo-workspace">'],
    ['href="/apple-touch-icon.png"', 'href="/assets/bamboo/apple-touch-icon.png"'],
    ['name="apple-mobile-web-app-title" content="DSH"', 'name="apple-mobile-web-app-title" content="Bamboo Desktop"'],
    ['    <link rel="icon" type="image/svg+xml" href="/favicon-dark.svg" media="(prefers-color-scheme: dark)" />\n    <link rel="icon" type="image/svg+xml" href="/favicon.svg" media="(prefers-color-scheme: light)" />', '    <link rel="icon" type="image/svg+xml" href="/assets/bamboo/mark.svg" />\n    <link rel="stylesheet" href="/assets/bamboo/brand-font.css" />\n    <link rel="stylesheet" href="/assets/bamboo/workspace.css" />'],
  ])
  replace('apps/web/src/main.ts', [
    ["/** Browser entry for the Web client. */\nimport '@deepseek-ai/dsh-client-ui-theme/brand-font.css'\n", ''],
  ])
  replace('packages/client/web/src/boot-page.ts', [
    ["this.wordmark = div(css.wordmark, 'HARNESS')", "this.wordmark = div(css.wordmark, 'Bamboo Desktop')\n    this.wordmark.dataset.bambooBootBrand = ''"],
  ])
  replace('packages/client/ui-layout/src/client/AppFrame.tsx', [
    ['<div className={css.sidebarCol}', '<div className={css.sidebarCol} data-bamboo-sidebar'],
  ])
  replace('packages/client/ui-conversation/src/client/skeleton/InputBar.tsx', [
    ['className={css.primary}', 'className={css.primary} data-bamboo-composer-action'],
  ])
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
  replace('packages/llm/llm-pi-ai/src/adapter.ts', [
    ['  ImageAttachmentAccess,\n  LlmModelInfo,', '  ImageAttachmentAccess,\n  LlmFailure,\n  LlmModelInfo,'],
    ['export interface PiAiAdapterOptions {', 'export interface PiAiAdapterOptions {\n  waitForUpstream?: boolean\n  mapFailure?: (failure: LlmFailure, headers?: Readonly<Record<string, string>>) => LlmFailure'],
    ["    using watchdog = idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')", "    using watchdog = this.config.waitForUpstream ? undefined : idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')\n    const streamSignal = watchdog?.signal ?? upstream"],
    ['{ ...request, signal: watchdog.signal }', '{ ...request, signal: streamSignal }'],
    ['        signal: watchdog.signal,', '        signal: streamSignal,'],
    ['      const events = snapshot.models.streamSimple', "      const mapFailure = this.config.mapFailure\n      let responseHeaders: Readonly<Record<string, string>> | undefined\n      const onResponse: SimpleStreamOptions['onResponse'] = ({ headers }) => { responseHeaders = headers }\n      const events = snapshot.models.streamSimple"],
    ['        headers: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders),', '        headers: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders),\n        ...mapFailure ? { onResponse } : {},'],
    ['await watchdog.next(iterator)', 'await (watchdog?.next(iterator) ?? iterator.next())'],
    ['      const events = snapshot.models.streamSimple(model, context, {', `      const requestModel = model.provider === 'bamboo' && reasoning === undefined && model.thinkingLevelMap?.off === 'none'
        ? { ...model, thinkingLevelMap: { ...model.thinkingLevelMap, off: null } }
        : model
      const events = snapshot.models.streamSimple(requestModel, context, {`],
    ['          yield result.value', "          const chunk = result.value\n          if (mapFailure && chunk.type === 'finish' && chunk.reason.kind === 'error') {\n            yield { ...chunk, reason: { kind: 'error', failure: mapFailure(chunk.reason.failure, responseHeaders) } }\n          } else {\n            yield chunk\n          }"],
    ["if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined)", "if (watchdog && timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined)"],
  ])
  replace('packages/llm/llm-pi-ai/src/catalog.ts', [
    ["if (!declared.some(([level]) => level !== 'off'))", "if (!declared.some(([level]) => level !== 'off') && !(provider === 'bamboo' && efforts.off === 'none'))"],
  ])
  replace('packages/api/session-controller/src/catalog.ts', [
    ['defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),', 'defaultSelection?: ModelSelection,'],
    ['default: { ...defaultSelection },', 'default: { ...(defaultSelection ?? ctx.agentDefaultModel.currentSelection()) },'],
  ])
  replace('packages/client/ui-model-selection/src/client/service.ts', [
    ["import { ModelCatalogDirectory } from './catalog.ts'", "import { ModelCatalogDirectory } from './catalog.ts'\nimport { watchDesktopCatalog } from './bamboo-account.ts'"],
    ["this.catalog = new ModelCatalogDirectory(ctx)", "this.catalog = new ModelCatalogDirectory(ctx)\n    ctx.effect(() => watchDesktopCatalog(() => this.catalog.resetGeneration()))"],
  ])
  replace('packages/client/ui-model-selection/src/client/ModelSelect.tsx', [
    ['  const reasoning = currentChoice?.model.reasoning', `  const resetSavedEffort = currentChoice?.group.id === 'bamboo' && state.current?.reasoningEffort !== undefined
  const reasoning = currentChoice?.model.reasoning ?? (resetSavedEffort ? { efforts: [], defaultEffort: undefined } : undefined)`],
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
    ['  const systemLanguages = app.getPreferredSystemLanguages()', "  const systemLanguages = ['en']"],
    ['systemLanguages', 'defaultDesktopLanguages'],
    ["applicationName: 'DeepSeek Harness'", "applicationName: 'Bamboo Desktop'"],
    ["'resources', 'icon-windows.png'", "'resources', 'bamboo', 'icon.png'"],
    ["'resources', 'tray-windows.ico'", "'resources', 'bamboo', 'icon.ico'"],
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
