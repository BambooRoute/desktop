import { appendFileSync } from 'node:fs'
import { githubRequest, sourceReleaseRun } from './releasing.mjs'

try {
  const source = await sourceReleaseRun(process.env.GITHUB_REPOSITORY, process.env.BAMBOO_SOURCE_RUN, githubRequest(process.env.GH_TOKEN))
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(source).map(([key, value]) => `${key}=${value}\n`).join(''))
  console.log(`Verified packaging run ${source.run} at ${source.commit}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
