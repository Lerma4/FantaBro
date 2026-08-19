import { ALL_ERROR_CODES } from '#shared/constants'
import type { ErrorCode } from '#shared/types'

export type ApiFetchOptions = Parameters<typeof $fetch>[1]

/** Errore tipizzato lato client: trasporta solo il codice stabile del server. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status = 0,
    readonly issues?: unknown
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ALL_ERROR_CODES as readonly string[]).includes(value)

interface ErrorPayload {
  code?: unknown
  issues?: unknown
}

/**
 * Il server risponde `{ data: { code, issues? } }`. `$fetch` mette il body in
 * `err.data`, quindi il payload utile puo stare a `err.data.data` (createError)
 * o direttamente a `err.data`. Quando il codice manca si ricade sullo status.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err

  const raw = err as {
    status?: number
    statusCode?: number
    data?: ErrorPayload & { data?: ErrorPayload }
  } | null

  const status = raw?.status ?? raw?.statusCode ?? 0
  const payload = raw?.data?.data ?? raw?.data

  if (isErrorCode(payload?.code)) return new ApiError(payload.code, status, payload.issues)

  const byStatus: Record<number, ErrorCode> = {
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_FAILED',
  }
  return new ApiError(byStatus[status] ?? 'INTERNAL_ERROR', status)
}

/** `$fetch` che fallisce sempre con un `ApiError`. */
export async function apiFetch<T>(url: string, opts?: ApiFetchOptions) {
  try {
    return await $fetch<T, string>(url, opts)
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Toast tradotto. Dove esiste, aggiunge il suggerimento azionabile
 * (`errors.hint.<CODE>`): la spec 45 chiede di dire *cosa fare*, non solo
 * che qualcosa e andato storto.
 */
export function useToastError() {
  const { t, te } = useI18n()
  const toast = useToast()

  return (err: unknown): ApiError => {
    const apiError = toApiError(err)
    const hintKey = `errors.hint.${apiError.code}`
    toast.add({
      title: t(`errors.${apiError.code}`),
      description: te(hintKey) ? t(hintKey) : undefined,
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
    return apiError
  }
}

export function useToastOk() {
  const toast = useToast()
  return (title: string) =>
    toast.add({ title, color: 'success', icon: 'i-lucide-check', duration: 2500 })
}
