import { app, BrowserWindow, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BambooAccount, BambooError, type BambooCredential, type BambooStorage } from './bamboo-account.mjs'
import { createBambooBridge } from './bamboo-bridge.mjs'

let account: BambooAccount | undefined

export function bambooAccount(): BambooAccount {
  if (!account) throw new Error('Bamboo account is not initialized')
  return account
}

export async function createBambooDesktop() {
  const directory = join(app.getPath('userData'), 'bamboo-account')
  const file = join(directory, 'credential.enc')
  const storage: BambooStorage = {
    assertAvailable() {
      if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
        throw new BambooError('storage', 'Secure credential storage is unavailable. Unlock your system keychain and try again.')
      }
    },
    async read() {
      let bytes: Buffer
      try { bytes = await readFile(file) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      storage.assertAvailable()
      return JSON.parse(safeStorage.decryptString(bytes)) as BambooCredential
    },
    async write(credential) {
      storage.assertAvailable()
      const encrypted = safeStorage.encryptString(JSON.stringify(credential))
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(file + '.tmp', encrypted, { mode: 0o600 })
      await rename(file + '.tmp', file)
    },
    async clear() { await rm(file, { force: true }) },
  }
  account = new BambooAccount({
    site: process.env.BAMBOO_SITE_ORIGIN ?? 'https://bambooroute.com',
    gateway: process.env.BAMBOO_GATEWAY_ORIGIN ?? 'https://api.bambooroute.com',
    storage, openExternal: url => shell.openExternal(url),
  })
  await account.initialize()
  const bridge = await createBambooBridge(account)
  const welcome = pathToFileURL(join(app.getAppPath(), 'renderer', 'welcome.html')).href
  const assertSender = (event: IpcMainInvokeEvent) => {
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame || !BrowserWindow.fromWebContents(event.sender) ||
      !(frame.url === welcome || frame.url === 'dsh-app://app/')) throw new Error('Bamboo rejected an unowned renderer')
  }
  const handle = (name: string, action: (value?: unknown) => unknown) => {
    ipcMain.handle('bamboo-account:' + name, async (event, value: unknown) => {
      assertSender(event)
      try { return await action(value) }
      catch (error) { throw new Error(error instanceof BambooError ? error.message : 'Bamboo could not complete this action. Please try again.') }
    })
  }
  handle('state', () => bambooAccount().state())
  handle('sign-in', currency => {
    if (currency !== 'USD' && currency !== 'CNY') throw new BambooError('invalid_currency', 'Choose USD or CNY as the billing currency.')
    return bambooAccount().signIn(currency)
  })
  handle('cancel', () => bambooAccount().cancel())
  handle('refresh', () => bambooAccount().refresh(true))
  handle('sign-out', () => bambooAccount().signOut())
  handle('open-browser', () => bambooAccount().openBrowser())
  handle('open-page', page => {
    if (typeof page !== 'string') throw new Error('Invalid page')
    return bambooAccount().openPage(page)
  })
  const unsubscribe = account.subscribe(state => {
    for (const window of BrowserWindow.getAllWindows()) {
      const url = window.webContents.getURL()
      if (url === welcome || url === 'dsh-app://app/') window.webContents.send('bamboo-account:changed', state)
    }
  })
  app.once('will-quit', () => { unsubscribe(); account?.close(); bridge.close() })
  return bridge
}
