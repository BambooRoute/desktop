import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './config.mjs'
import { githubRequest, prepareRelease, publishRelease, recordRelease } from './releasing.mjs'

try {
  const product = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const plan = prepareRelease({
    input: join(root, '.local/release-artifacts'), output: join(root, '.local/release-assets'),
    version: process.env.BAMBOO_RELEASE_VERSION ?? product.version,
    commit: process.env.BAMBOO_RELEASE_COMMIT ?? process.env.GITHUB_SHA,
    run: process.env.BAMBOO_RELEASE_RUN ?? process.env.GITHUB_RUN_ID,
    number: process.env.BAMBOO_RELEASE_NUMBER ?? process.env.GITHUB_RUN_NUMBER,
    attempt: process.env.BAMBOO_RELEASE_ATTEMPT ?? process.env.GITHUB_RUN_ATTEMPT,
    repository: process.env.GITHUB_REPOSITORY,
  })
  const release = await publishRelease(plan, githubRequest(process.env.GH_TOKEN))
  recordRelease(release, process.env.GITHUB_STEP_SUMMARY)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
