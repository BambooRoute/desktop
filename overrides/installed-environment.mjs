import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function configureInstalledApp(app, resources, environment = process.env) {
  if (!app.isPackaged) return
  const config = JSON.parse(readFileSync(join(resources, 'bamboo', 'config.json'), 'utf8'))
  if (config.channel !== 'preview' || config.appId !== 'com.bambooroute.desktop.preview'
    || config.productName !== 'Bamboo Desktop Preview' || config.protocol !== 'bamboo-preview') {
    throw new Error('Bamboo installation has an invalid application identity')
  }
  for (const key of ['site', 'gateway']) {
    const url = new URL(config[key])
    if (url.protocol !== 'https:' || url.origin !== config[key] || url.username || url.password) {
      throw new Error('Bamboo installation has an invalid service address')
    }
  }
  const profile = join(resources, 'bamboo', 'profile.json')
  if (!existsSync(profile) || !Array.isArray(JSON.parse(readFileSync(profile, 'utf8')))) {
    throw new Error('Bamboo installation is missing its runtime profile')
  }
  const home = join(app.getPath('appData'), config.productName)
  const desktop = join(home, 'desktop')
  mkdirSync(desktop, { recursive: true })
  mkdirSync(join(home, 'runtime'), { recursive: true })
  for (const key of Object.keys(environment)) {
    if (key.startsWith('DSH_') || key.startsWith('BAMBOO_')) delete environment[key]
  }
  Object.assign(environment, {
    BAMBOO_HOME: home,
    BAMBOO_PRODUCT_NAME: config.productName,
    BAMBOO_APP_ID: config.appId,
    BAMBOO_PROTOCOL: config.protocol,
    BAMBOO_PROFILE: profile,
    BAMBOO_SITE_ORIGIN: config.site,
    BAMBOO_GATEWAY_ORIGIN: config.gateway,
    DSH_HOME: join(home, 'runtime'),
    DSH_DESKTOP_USER_DATA_DIR: desktop,
    DSH_DESKTOP_OPEN_DEVTOOLS: '0',
    DSH_TELEMETRY_DISABLED: '1',
  })
  app.setName(config.productName)
  app.setPath('userData', desktop)
  app.setAppUserModelId(config.appId)
}
