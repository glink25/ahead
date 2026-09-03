/** Placeholder for CI sync check — types are hand-maintained to match schemas/. */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '../schemas')
const files = readdirSync(schemasDir).filter((f) => f.endsWith('.json'))
console.log(`OEF schema authority files (${files.length}):`)
for (const f of files) console.log(`  - ${f}`)
console.log('Types live in src/types.ts and must stay in sync with schemas/.')
