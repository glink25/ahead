import { describe, expect, it } from 'vitest'
import { corsHeaders, isAllowedOrigin, preflightResponse } from './cors.js'

describe('isAllowedOrigin', () => {
  it('matches any origin in a comma-separated allowlist', () => {
    const allowlist = 'http://localhost:4455,https://app.example.com'
    expect(isAllowedOrigin('https://app.example.com', allowlist)).toBe(true)
    expect(isAllowedOrigin('http://localhost:4455', allowlist)).toBe(true)
    expect(isAllowedOrigin('https://evil.example', allowlist)).toBe(false)
    expect(isAllowedOrigin(null, allowlist)).toBe(false)
  })
})

describe('corsHeaders', () => {
  it('reflects an allowed Origin and enables credentials', () => {
    const headers = corsHeaders(
      new Request('https://auth.example.com/api/github/refresh', {
        headers: { Origin: 'https://app.example.com' },
      }),
      'http://localhost:4455,https://app.example.com',
    )
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  it('omits ACAO for disallowed origins', () => {
    const headers = corsHeaders(
      new Request('https://auth.example.com/api/github/refresh', {
        headers: { Origin: 'https://evil.example' },
      }),
      'https://app.example.com',
    )
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('preflightResponse', () => {
  it('rejects disallowed origins with 403', () => {
    const response = preflightResponse(
      new Request('https://auth.example.com/api/github/refresh', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      }),
      'https://app.example.com',
    )
    expect(response.status).toBe(403)
  })

  it('allows listed origins with 204', () => {
    const response = preflightResponse(
      new Request('https://auth.example.com/api/github/refresh', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com' },
      }),
      'http://localhost:4455,https://app.example.com',
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })
})
