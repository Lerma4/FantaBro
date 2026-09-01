import type { H3Event } from 'h3'
import { ALL_ERROR_CODES } from '#shared/constants'
import { AiProviderError } from '#shared/types'
import type { AiErrorCode, DomainErrorCode, ErrorCode } from '#shared/types'

/**
 * Errore di dominio: trasporta solo un codice stabile di `DOMAIN_ERROR_CODES`.
 * Il messaggio utente lo produce il client con `t('errors.<CODE>')` (spec AGENTS.md 6).
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly issues?: unknown,
    readonly status?: number
  ) {
    super(code)
    this.name = 'DomainError'
  }
}

/** Interrompe l'operazione con un codice di dominio. */
export function fail(code: DomainErrorCode, status?: number): never {
  throw new DomainError(code, undefined, status)
}

/**
 * Status HTTP per ogni codice di dominio. La mappa e esaustiva di proposito: aggiungere un
 * codice a `DOMAIN_ERROR_CODES` senza decidere il suo status non compila.
 *
 * `PLAYER_NOT_OWNED` / `PLAYER_NOT_SOLD` sono 409: sono rifiuti per stato del giocatore
 * incompatibile con l'operazione, esattamente come `PLAYER_NOT_AVAILABLE`.
 */
const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  AUCTION_NOT_FOUND: 404,
  PLAYER_NOT_FOUND: 404,
  CONFLICT: 409,
  LAST_ADMIN_REQUIRED: 409,
  BOOTSTRAP_ADMIN_IMMUTABLE: 409,
  PLAYER_NOT_AVAILABLE: 409,
  PLAYER_ALREADY_OWNED: 409,
  PLAYER_NOT_OWNED: 409,
  PLAYER_NOT_SOLD: 409,
  PLAYER_IN_USE: 409,
  LISTONE_IN_USE: 409,
  EVENT_ALREADY_REVERTED: 409,
  VALIDATION_FAILED: 422,
  ROLE_SLOTS_FULL: 422,
  BUDGET_EXCEEDED: 422,
  REMAINING_SLOTS_UNFILLABLE: 422,
  PRICE_BELOW_MINIMUM: 422,
  IMPORT_INVALID_FILE: 422,
  IMPORT_MISSING_COLUMNS: 422,
  IMPORT_NO_VALID_ROWS: 422,
  EVENT_NOT_REVERTABLE: 422,
  INTERNAL_ERROR: 500,
}

/** Un provider AI non disponibile e un 503; solo coda piena e timeout hanno uno status proprio. */
const AI_STATUS: Partial<Record<AiErrorCode, number>> = {
  PROVIDER_BUSY: 429,
  TIMEOUT: 504,
}
const AI_DEFAULT_STATUS = 503

/** Codice stabile per errori che arrivano da fuori (h3, Better Auth) e portano solo lo status. */
const CODE_BY_STATUS: Record<number, DomainErrorCode> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
}

const PG_UNIQUE_VIOLATION = '23505'

const KNOWN_CODES: ReadonlySet<string> = new Set(ALL_ERROR_CODES)

/**
 * Violazione di vincolo unico Postgres, anche se incapsulata da Drizzle: la catena `cause`
 * viene percorsa fino in fondo. Due utenti che comprano lo stesso giocatore nello stesso
 * istante finiscono qui (spec 48).
 */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  while (current !== null && typeof current === 'object') {
    if ((current as { code?: unknown }).code === PG_UNIQUE_VIOLATION) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Corpo di errore dell'API: solo il codice stabile e, se serve, le issue di validazione. */
export interface ErrorResponse {
  statusCode: number
  code: ErrorCode
  issues?: unknown
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && KNOWN_CODES.has(value)
}

/**
 * Normalizza qualunque errore nel corpo che l'API espone. Niente messaggi, niente stack,
 * niente dettagli di database: solo un codice che il client traduce via i18n.
 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof DomainError) {
    const statusCode = err.status ?? DOMAIN_STATUS[err.code]
    return err.issues === undefined
      ? { statusCode, code: err.code }
      : { statusCode, code: err.code, issues: err.issues }
  }

  if (err instanceof AiProviderError) {
    return { statusCode: AI_STATUS[err.code] ?? AI_DEFAULT_STATUS, code: err.code }
  }

  if (isUniqueViolation(err)) return { statusCode: 409, code: 'CONFLICT' }

  // Errori h3 gia formati (es. `requireUser`): si tiene lo status e si ricava un codice stabile.
  if (err !== null && typeof err === 'object') {
    const candidate = err as { statusCode?: unknown; data?: { code?: unknown } }
    if (typeof candidate.statusCode === 'number') {
      const fromData = candidate.data?.code
      return {
        statusCode: candidate.statusCode,
        code: isErrorCode(fromData)
          ? fromData
          : (CODE_BY_STATUS[candidate.statusCode] ?? 'INTERNAL_ERROR'),
      }
    }
  }

  return { statusCode: 500, code: 'INTERNAL_ERROR' }
}

/** Converte un errore qualsiasi nell'errore HTTP restituito da una route. */
export function toHttpError(err: unknown) {
  const { statusCode, code, issues } = toErrorResponse(err)

  // Un 5xx e sempre un bug o un guasto: va nei log del server, mai nella risposta.
  if (statusCode >= 500) console.error('[api]', code, err)

  return createError({
    statusCode,
    data: issues === undefined ? { code } : { code, issues },
  })
}

/**
 * Handler di route con conversione degli errori centralizzata: evita di ripetere
 * try/catch in ognuna delle route.
 */
export function defineApiHandler<T>(handler: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (err) {
      throw toHttpError(err)
    }
  })
}
