import { parseLocator } from '@ahead/protocol'
import { githubMediaUrl } from '../adapters/github-content'
import type { Source } from './providers'
const resolvers = new Map([["github", githubMediaUrl]])
export function mediaUrl(source: Source, version: string | undefined, path: string) {
  return resolvers.get(parseLocator(source.locator).scheme)?.(source, version, path)
}
