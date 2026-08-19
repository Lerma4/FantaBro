import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiProviderError } from '#shared/types'
import {
  DomainError,
  isUniqueViolation,
  toErrorResponse,
  toHttpError,
} from '../../../server/utils/errors'
import { uniqueViolation } from './fixtures'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('toErrorResponse', () => {
  it.each([
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['AUCTION_NOT_FOUND', 404],
    ['PLAYER_NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['PLAYER_NOT_AVAILABLE', 409],
    ['PLAYER_ALREADY_OWNED', 409],
    ['EVENT_ALREADY_REVERTED', 409],
    ['VALIDATION_FAILED', 422],
    ['ROLE_SLOTS_FULL', 422],
    ['BUDGET_EXCEEDED', 422],
    ['REMAINING_SLOTS_UNFILLABLE', 422],
    ['PRICE_BELOW_MINIMUM', 422],
    ['IMPORT_INVALID_FILE', 422],
    ['IMPORT_MISSING_COLUMNS', 422],
    ['IMPORT_NO_VALID_ROWS', 422],
    ['EVENT_NOT_REVERTABLE', 422],
    ['INTERNAL_ERROR', 500],
  ] as const)('mappa %s su %i', (code, statusCode) => {
    expect(toErrorResponse(new DomainError(code))).toEqual({ statusCode, code })
  })

  it.each([
    ['PROVIDER_BUSY', 429],
    ['TIMEOUT', 504],
    ['CLI_NOT_INSTALLED', 503],
    ['NOT_AUTHENTICATED', 503],
    ['SESSION_EXPIRED', 503],
    ['PROVIDER_RATE_LIMITED', 503],
    ['INVALID_OUTPUT', 503],
    ['PROCESS_FAILED', 503],
  ] as const)('mappa il codice AI %s su %i', (code, statusCode) => {
    expect(toErrorResponse(new AiProviderError(code, 'dettaglio interno'))).toEqual({
      statusCode,
      code,
    })
  })

  it('porta le issue di validazione senza messaggi', () => {
    const issues = [{ path: 'price', code: 'too_small' }]
    expect(toErrorResponse(new DomainError('VALIDATION_FAILED', issues))).toEqual({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      issues,
    })
  })

  it('traduce una violazione di vincolo unico in CONFLICT', () => {
    expect(toErrorResponse(uniqueViolation())).toEqual({ statusCode: 409, code: 'CONFLICT' })
  })

  it('conserva codice e status di un errore h3 gia formato', () => {
    expect(toErrorResponse({ statusCode: 401, data: { code: 'UNAUTHORIZED' } })).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    })
  })

  it('ricava un codice stabile da un errore h3 che porta solo lo status', () => {
    expect(toErrorResponse({ statusCode: 403 })).toEqual({ statusCode: 403, code: 'FORBIDDEN' })
    expect(toErrorResponse({ statusCode: 418 })).toEqual({
      statusCode: 418,
      code: 'INTERNAL_ERROR',
    })
  })

  it('non espone messaggio ne stack di un errore inatteso', () => {
    const response = toErrorResponse(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
    expect(response).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR' })
    expect(JSON.stringify(response)).not.toContain('5432')
  })
})

describe('toHttpError', () => {
  it('costruisce un errore HTTP il cui corpo contiene solo codice e issue', () => {
    const created = vi.fn((input: unknown) => input)
    vi.stubGlobal('createError', created)

    const issues = [{ path: 'playerId', code: 'invalid_format' }]
    toHttpError(new DomainError('VALIDATION_FAILED', issues))

    expect(created).toHaveBeenCalledWith({
      statusCode: 422,
      data: { code: 'VALIDATION_FAILED', issues },
    })
  })

  it('non mette messaggi ne stack nel corpo di un 500', () => {
    const created = vi.fn((input: unknown) => input)
    vi.stubGlobal('createError', created)
    // Il 500 va nei log del server, non nella risposta.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    toHttpError(new Error('password=segretissima'))

    expect(created).toHaveBeenCalledWith({ statusCode: 500, data: { code: 'INTERNAL_ERROR' } })
    expect(logged).toHaveBeenCalled()
  })
})

describe('isUniqueViolation', () => {
  it('riconosce il codice 23505 anche in fondo alla catena di cause', () => {
    expect(isUniqueViolation(uniqueViolation())).toBe(true)
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: '23505' }))).toBe(true)
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: '23503' }))).toBe(false)
    expect(isUniqueViolation(new Error('x'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
