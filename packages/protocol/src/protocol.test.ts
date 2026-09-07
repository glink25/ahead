import { describe, expect, it } from 'vitest'
import {
  manifestPath,
  parseLocator,
  parseSourceKey,
  resolveLocalizedText,
  serialize,
  sourceKey,
} from './index.js'

describe('OEF protocol helpers', () => {
  it('round trips GitHub locators and source keys', () => {
    const locator = parseLocator('github:Alice/Events')
    expect(serialize(locator)).toBe('github:Alice/Events')

    const key = sourceKey({
      locator: 'github:Alice/Events',
      manifestPath: 'feeds/中文.yaml',
    })
    expect(parseSourceKey(key)).toEqual({
      locator: 'github:alice/events',
      manifestPath: 'feeds/中文.yaml',
    })
  })

  it('rejects unsafe repository paths', () => {
    expect(() => manifestPath('../ahead.yaml')).toThrow(TypeError)
    expect(() => parseLocator('github:owner')).toThrow(TypeError)
  })

  it('resolves localized text by locale and language', () => {
    const text = { en: 'Ahead', zh: '盼头' }
    expect(resolveLocalizedText(text, 'zh-CN')).toBe('盼头')
    expect(resolveLocalizedText(text, 'fr', ['en'])).toBe('Ahead')
  })
})

