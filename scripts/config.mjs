import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, relative as relativePath } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const upstream = JSON.parse(readFileSync(join(root, 'config/upstream.json'), 'utf8'))
export const checkout = join(root, '.runtime', 'upstream')

export function runtimeEnvironment(directory, parent = process.env) {
  const home = resolve(parent.BAMBOO_HOME || join(directory, '.local', 'bamboo'))
  const environment = { ...parent }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('DSH_') || key.startsWith('ELECTRON_')) delete environment[key]
  }
  return {
    ...environment,
    BAMBOO_HOME: home,
    DSH_HOME: join(home, 'runtime'),
    DSH_DESKTOP_USER_DATA_DIR: join(home, 'desktop'),
    DSH_DESKTOP_OPEN_DEVTOOLS: '0',
    DSH_TELEMETRY_DISABLED: '1',
  }
}

export function checkedPath(directory, relative) {
  const path = resolve(directory, relative)
  const result = relativePath(directory, path)
  if (isAbsolute(relative) || isAbsolute(result) || result === '..' || result.startsWith('../') || result.startsWith('..\\') || result === '') {
    throw new Error(`Path is outside the managed checkout: ${relative}`)
  }
  return path
}

export function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Pinned upstream source changed: ${label}`)
  return text.replaceAll(before, after)
}
