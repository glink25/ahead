export enum AheadErrorCode {
  AUTH_PROVIDER_NOT_FOUND = 'AUTH_PROVIDER_NOT_FOUND',
  AUTH_FAILED = 'AUTH_FAILED',
  CREDENTIAL_UNAVAILABLE = 'CREDENTIAL_UNAVAILABLE',
  CREDENTIAL_EXPIRED = 'CREDENTIAL_EXPIRED',
  INVALID_LOCATOR = 'INVALID_LOCATOR',
  REPOSITORY_NOT_FOUND = 'REPOSITORY_NOT_FOUND',
  REPOSITORY_FORBIDDEN = 'REPOSITORY_FORBIDDEN',
  REPOSITORY_CONFLICT = 'REPOSITORY_CONFLICT',
  STORAGE_ERROR = 'STORAGE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface AheadErrorOptions {
  cause?: unknown
  details?: Readonly<Record<string, unknown>>
}

export class AheadError extends Error {
  readonly code: AheadErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(code: AheadErrorCode, message: string, options: AheadErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'AheadError'
    this.code = code
    this.details = options.details
  }
}
