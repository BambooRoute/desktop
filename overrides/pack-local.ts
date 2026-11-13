import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readClientBuildRecord, repositoryClientBuildEnvironment } from '../../../scripts/client-build-environment.ts'
import { releaseFamily } from '../../../scripts/release/families.ts'
import { packFamilyMembers, parsePackConcurrency } from '../../../scripts/release/pack.ts'

const { values } = parseArgs({ options: { out: { type: 'string' }, concurrency: { type: 'string' } } })
if (!values.out) throw new Error('Bamboo package staging requires --out')
const root = process.cwd()
readClientBuildRecord(root, repositoryClientBuildEnvironment(root))
const packed = await packFamilyMembers(root, releaseFamily('dsh'), resolve(root, values.out), parsePackConcurrency(values.concurrency))
console.log(`Bamboo: staged ${packed.length} local packages`)
