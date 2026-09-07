import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { injectHeadHtml } from '../build-html'

describe('head HTML injection', () => {
  it('leaves HTML unchanged when no content is configured', () => {
    const html = '<html><head><title>Ahead</title></head><body></body></html>'
    expect(injectHeadHtml(html)).toBe(html)
    expect(injectHeadHtml(html, '')).toBe(html)
  })

  it('inserts configured content verbatim before the closing head tag', () => {
    const html = '<html><head><title>Ahead</title></head><body></body></html>'
    const content = '<meta name="deployment-note" content="enabled">\n'

    expect(injectHeadHtml(html, content)).toBe(
      '<html><head><title>Ahead</title>' + content + '</head><body></body></html>',
    )
  })

  it('fails when configured content has no valid insertion point', () => {
    expect(() => injectHeadHtml('<html><body></body></html>', '<meta>')).toThrow(
      'closing head tag not found',
    )
  })
})

describe('private deployment content policy', () => {
  it('keeps provider fingerprints out of repository files', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../..')
    const paths = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ).split('\0').filter(Boolean)
    const fingerprints = [
      ['g', 'tm'].join(''),
      ['g', 'tag'].join(''),
      ['google', 'tagmanager'].join(''),
      ['data', 'layer'].join(''),
      ['g-n7', 'rssp9vwn'].join(''),
    ]

    const matches = paths.flatMap((path) => {
      const absolutePath = resolve(repositoryRoot, path)
      if (!existsSync(absolutePath)) return []
      const content = readFileSync(absolutePath, 'utf8').toLowerCase()
      return fingerprints
        .filter((fingerprint) => content.includes(fingerprint))
        .map((fingerprint) => `${path}: ${fingerprint}`)
    })

    expect(matches).toEqual([])
  })
})
