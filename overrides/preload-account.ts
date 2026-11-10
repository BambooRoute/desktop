import { contextBridge, ipcRenderer } from 'electron'
import type { BambooApi, BambooState } from './bamboo-types.ts'

const api: BambooApi = {
  state: () => ipcRenderer.invoke('bamboo-account:state') as Promise<BambooState>,
  signIn: () => ipcRenderer.invoke('bamboo-account:sign-in') as Promise<BambooState>,
  cancel: () => ipcRenderer.invoke('bamboo-account:cancel') as Promise<BambooState>,
  refresh: () => ipcRenderer.invoke('bamboo-account:refresh') as Promise<BambooState>,
  signOut: () => ipcRenderer.invoke('bamboo-account:sign-out') as Promise<BambooState>,
  openBrowser: () => ipcRenderer.invoke('bamboo-account:open-browser') as Promise<void>,
  openPage: page => ipcRenderer.invoke('bamboo-account:open-page', page) as Promise<void>,
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, state: BambooState) => listener(state)
    ipcRenderer.on('bamboo-account:changed', receive)
    return () => ipcRenderer.removeListener('bamboo-account:changed', receive)
  },
}

if (process.isMainFrame && (location.href.endsWith('/renderer/welcome.html') && location.protocol === 'file:' ||
  location.protocol === 'dsh-app:' && location.hostname === 'app')) contextBridge.exposeInMainWorld('bambooAccount', api)
