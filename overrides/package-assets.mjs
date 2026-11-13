import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const directory = join(import.meta.dirname, '../resources/bamboo')
mkdirSync(directory, { recursive: true })
const source = join(import.meta.dirname, '../renderer/assets/welcome-brand.svg')
await sharp(source).resize(1024, 1024).png().toFile(join(directory, 'icon.png'))
const png = await sharp(source).resize(256, 256).png().toBuffer()
const header = Buffer.alloc(22)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
header.writeUInt16LE(1, 10)
header.writeUInt16LE(32, 12)
header.writeUInt32LE(png.length, 14)
header.writeUInt32LE(22, 18)
writeFileSync(join(directory, 'icon.ico'), Buffer.concat([header, png]))
