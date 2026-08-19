import type { H3Event } from 'h3'
import type { ZodError, ZodType } from 'zod'
import { uuidSchema } from '#shared/schemas'
import { DomainError } from './errors'

/** Dimensione massima di un listone caricato. Oltre, si rifiuta senza parsare (spec 13). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * Issue compatta: percorso del campo e codice zod, nessun messaggio.
 * I messaggi utente vivono in i18n lato client (AGENTS.md 6, 7).
 */
export interface CompactIssue {
  path: string
  code: string
}

function compactIssues(error: ZodError): CompactIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
}

function parseOrFail<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', compactIssues(parsed.error))
  return parsed.data
}

export async function readValidatedBodyOrFail<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  // Un body assente o non JSON e un errore di validazione, non un 500.
  const body = await readBody(event).catch(() => undefined)
  return parseOrFail(schema, body)
}

export function getValidatedQueryOrFail<T>(event: H3Event, schema: ZodType<T>): T {
  return parseOrFail(schema, getQuery(event))
}

export function getValidatedParam<T>(event: H3Event, name: string, schema: ZodType<T>): T {
  return parseOrFail(schema, getRouterParam(event, name))
}

/** Parametro di rotta uuid. Un id malformato non deve arrivare al database. */
export function getUuidParam(event: H3Event, name: string): string {
  return getValidatedParam(event, name, uuidSchema)
}

export interface ValidatedUpload<T> {
  data: T
  buffer: Buffer
  filename: string
}

/**
 * Upload multipart di un singolo `.xlsx` con i campi testuali validati dallo schema.
 * `mapping` arriva come JSON serializzato: l'unico campo non scalare del form.
 */
export async function readValidatedUpload<T>(
  event: H3Event,
  schema: ZodType<T>
): Promise<ValidatedUpload<T>> {
  // Unica protezione applicativa sulla dimensione del body: Nitro 2 non ha un limite
  // globale. `readMultipartFormData` bufferizza tutto in memoria, quindi si decide prima
  // di chiamarlo e si **falla chiuso**: header assente o non numerico (body chunked, client
  // artigianale) vuol dire dimensione ignota, e una dimensione ignota non passa.
  const declaredSize = Number(getRequestHeader(event, 'content-length'))
  if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_UPLOAD_BYTES) {
    throw new DomainError('IMPORT_INVALID_FILE')
  }

  const parts = await readMultipartFormData(event).catch(() => undefined)
  if (!parts || parts.length === 0) throw new DomainError('IMPORT_INVALID_FILE')

  const file = parts.find((part) => typeof part.filename === 'string' && part.filename.length > 0)
  if (!file?.filename || !file.filename.toLowerCase().endsWith('.xlsx')) {
    throw new DomainError('IMPORT_INVALID_FILE')
  }
  if (file.data.length === 0 || file.data.length > MAX_UPLOAD_BYTES) {
    throw new DomainError('IMPORT_INVALID_FILE')
  }

  const fields: Record<string, unknown> = {}
  for (const part of parts) {
    if (part.filename || !part.name) continue
    fields[part.name] = part.data.toString('utf8')
  }

  if (typeof fields.mapping === 'string') {
    try {
      fields.mapping = JSON.parse(fields.mapping)
    } catch {
      throw new DomainError('VALIDATION_FAILED', [{ path: 'mapping', code: 'invalid_json' }])
    }
  }

  return { data: parseOrFail(schema, fields), buffer: file.data, filename: file.filename }
}
