export function configureInstalledApp(app: {
  isPackaged: boolean
  getPath(name: 'appData'): string
  setPath(name: 'userData', path: string): void
  setName(name: string): void
  setAppUserModelId(id: string): void
}, resources: string, environment?: NodeJS.ProcessEnv): void
