import { Octokit } from '@octokit/core'
import { paginateRest } from '@octokit/plugin-paginate-rest'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'

const AheadOctokit = Octokit.plugin(paginateRest, throttling, retry)

export type AheadOctokit = InstanceType<typeof Octokit>

export function createOctokit(getAccessToken: () => Promise<string>): AheadOctokit {
  const octokit = new AheadOctokit({
    request: {
      // Do not force Request.cache here. In Chromium, `no-store` adds
      // Cache-Control and Pragma request headers; GitHub's CORS preflight does
      // not allow those headers. GitHub response cache directives remain in
      // control, while immutable content is cached by the application at SHA.
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, init),
    },
    throttle: {
      onRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 1,
      onSecondaryRateLimit: () => false,
    },
    retry: {
      doNotRetry: [400, 401, 403, 404, 409, 422],
    },
  })

  // A request hook is used instead of Octokit's static `auth` option so token
  // refreshes are observed by every request.
  octokit.hook.before('request', async (options) => {
    const token = await getAccessToken()
    if (!token) {
      throw new Error('GitHub access token is unavailable')
    }
    options.headers.authorization = `Bearer ${token}`
  })

  return octokit
}
