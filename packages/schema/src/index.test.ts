import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { createValidator, type SchemaName } from './index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const validDir = join(root, 'fixtures/valid')
const invalidDir = join(root, 'fixtures/invalid')

function loadFixture(path: string): { schema: SchemaName; data: unknown } {
  const raw = readFileSync(path, 'utf8')
  const doc = path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
  if (!doc || typeof doc !== 'object' || !('schema' in doc) || !('data' in doc)) {
    throw new Error(`Fixture must have { schema, data }: ${path}`)
  }
  return doc as { schema: SchemaName; data: unknown }
}

describe('OEF schema fixtures', () => {
  const validator = createValidator()

  const valid = readdirSync(validDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.json'))
  const invalid = readdirSync(invalidDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.json'))

  it('has at least 20 valid and 20 invalid fixtures', () => {
    expect(valid.length).toBeGreaterThanOrEqual(20)
    expect(invalid.length).toBeGreaterThanOrEqual(20)
  })

  for (const file of valid) {
    it(`valid: ${file}`, () => {
      const { schema, data } = loadFixture(join(validDir, file))
      const result = validator.validate(schema, data)
      expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true)
    })
  }

  for (const file of invalid) {
    it(`invalid: ${file}`, () => {
      const { schema, data } = loadFixture(join(invalidDir, file))
      const result = validator.validate(schema, data)
      expect(result.ok).toBe(false)
    })
  }
})
