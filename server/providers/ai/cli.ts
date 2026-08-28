/**
 * Logica comune ai tre provider basati su CLI (spec §36, §37, §38).
 *
 * I tre adapter differiscono solo per: nome dell'eseguibile, flag di invocazione
 * non interattiva e comando con cui si verifica la sessione. Tutto il resto —
 * perimetro di esecuzione, classificazione degli errori, parsing dell'output —
 * è identico e vive qui, così una correzione di sicurezza vale per tutti.
 */
import { basename } from 'node:path'
import { parseAdvice, renderContextPrompt } from '../../domain/ai-context'
import { AiProviderError } from '#shared/types/ai'
import type {
  AiProviderId,
  AiProviderState,
  AiProviderStatus,
  AiResponse,
  AuctionContext,
} from '#shared/types/ai'
import type { AiErrorCode } from '#shared/types/domain'
import { PROBE_TIMEOUT_MS, commandExists, runCommand, sanitizeDetail, withTempDir } from './exec'
import type { RunCommandResult } from './exec'

/**
 * Frasi con cui le CLI segnalano una sessione mancante o scaduta.
 * Sono euristiche su testo di terze parti: per questo il *default* di un
 * fallimento resta `PROCESS_FAILED`, mai un `AVAILABLE` ottimista.
 */
const SESSION_EXPIRED_PATTERNS: RegExp[] = [
  /\bsession (?:has )?expired\b/i,
  /\b(?:access |refresh |oauth )?token (?:has )?(?:expired|been revoked)\b/i,
  /\bre-?authenticate\b/i,
]

const NOT_AUTHENTICATED_PATTERNS: RegExp[] = [
  /\bnot (?:logged in|authenticated|signed in)\b/i,
  /\bno (?:valid )?(?:credentials|authentication|login)\b/i,
  /\bauthentication (?:failed|required|error)\b/i,
  /\b(?:unauthorized|unauthenticated)\b/i,
  /\b401\b/,
  /\bplease (?:run )?[`'"]?\w+ (?:auth )?login\b/i,
  /\binvalid (?:api key|credentials|token)\b/i,
  /\bprovider not configured\b/i,
]

const RATE_LIMITED_PATTERNS: RegExp[] = [
  /\brate ?limit/i,
  /\btoo many requests\b/i,
  /\b(?:usage|quota) (?:limit )?(?:exceeded|reached)\b/i,
  /\b429\b/,
  /\boverloaded\b/i,
]

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

/**
 * Traduce l'output di una CLI fallita in un codice errore stabile (spec §45).
 * `undefined` significa "nessun pattern riconosciuto": sta a chi chiama scegliere
 * il fallback, che è sempre `PROCESS_FAILED`.
 */
export function classifyFailure(text: string): AiErrorCode | undefined {
  if (matchesAny(text, SESSION_EXPIRED_PATTERNS)) return 'SESSION_EXPIRED'
  if (matchesAny(text, RATE_LIMITED_PATTERNS)) return 'PROVIDER_RATE_LIMITED'
  if (matchesAny(text, NOT_AUTHENTICATED_PATTERNS)) return 'NOT_AUTHENTICATED'
  return undefined
}

/** `executable` è solo il nome del file: un path completo rivelerebbe il layout del server. */
export function executableName(bin: string): string {
  return basename(bin)
}

export function buildStatus(
  id: AiProviderId,
  bin: string,
  state: AiProviderState,
  extra?: { hintKey?: string; detail?: string }
): AiProviderStatus {
  return {
    id,
    state,
    executable: executableName(bin),
    hintKey: extra?.hintKey,
    detail: extra?.detail,
    checkedAt: new Date().toISOString(),
  }
}

export interface CliStatusParams {
  providerId: AiProviderId
  bin: string
  /** Chiave i18n con l'azione richiesta all'amministratore se manca l'eseguibile. */
  installHintKey: string
  /** Chiave i18n con il comando di login da eseguire sul server. */
  loginHintKey: string
  /** Comando che verifica la sessione. Non deve invocare il modello. */
  authArgs: string[]
  /**
   * Interpreta l'esito del probe. `AVAILABLE` solo con sessione certa;
   * `ERROR` quando l'output non è riconoscibile, perché in quel caso non
   * sappiamo se la sessione esista e dire `NOT_AUTHENTICATED` sarebbe una bugia.
   * `detail` non deve contenere l'identità dell'account del server.
   */
  interpret: (result: RunCommandResult) => {
    state: Extract<AiProviderState, 'AVAILABLE' | 'NOT_AUTHENTICATED' | 'ERROR'>
    detail?: string
  }
  env?: Record<string, string>
}

/**
 * Stato di un provider CLI: eseguibile assente -> `NOT_INSTALLED`, sessione
 * mancante -> `NOT_AUTHENTICATED` con il suggerimento amministrativo, altrimenti
 * `AVAILABLE`. Non lancia mai per un fallimento del probe: lo traduce in stato.
 */
export async function cliStatus(params: CliStatusParams): Promise<AiProviderStatus> {
  const { providerId, bin, loginHintKey } = params

  if (!(await commandExists(bin))) {
    return buildStatus(providerId, bin, 'NOT_INSTALLED', { hintKey: params.installHintKey })
  }

  let result: RunCommandResult
  try {
    result = await runCommand(bin, params.authArgs, {
      timeoutMs: PROBE_TIMEOUT_MS,
      env: params.env,
    })
  } catch (error) {
    // Il probe stesso è fallito (timeout, processo non avviabile): stato ERROR,
    // non NOT_AUTHENTICATED — non sappiamo nulla della sessione.
    const detail = error instanceof AiProviderError ? (error.detail ?? error.code) : undefined
    return buildStatus(providerId, bin, 'ERROR', { detail: sanitizeDetail(detail) })
  }

  const verdict = params.interpret(result)
  if (verdict.state === 'AVAILABLE') {
    return buildStatus(providerId, bin, 'AVAILABLE')
  }

  return buildStatus(providerId, bin, verdict.state, {
    hintKey: verdict.state === 'NOT_AUTHENTICATED' ? loginHintKey : undefined,
    detail: sanitizeDetail(verdict.detail),
  })
}

export interface CliAskParams {
  providerId: AiProviderId
  bin: string
  /**
   * Flag di invocazione non interattiva. Riceve la working directory temporanea
   * perché alcune CLI vogliono la radice del workspace come argomento esplicito.
   */
  buildArgs: (workdir: string) => string[]
  context: AuctionContext
  prompt: string
  timeoutMs: number
  env?: Record<string, string>
  /**
   * Scrive nella cartella temporanea i file che la CLI cerca nella cwd prima di
   * partire. È l'unico modo di imporre una policy a una CLI che la legge solo da
   * file di configurazione, e resta per invocazione: nessuno stato condiviso.
   */
  prepare?: (workdir: string) => Promise<void>
}

/**
 * Invocazione non interattiva di una CLI e conversione dell'output in `AiResponse`.
 *
 * Ogni chiamata è indipendente: prompt costruito da zero, cartella di lavoro
 * temporanea nuova, nessuna sessione riusata. È così che si esclude per
 * costruzione la perdita di contesto fra richieste (spec §44).
 */
export async function runCliAsk(params: CliAskParams): Promise<AiResponse> {
  const { providerId, bin, timeoutMs } = params
  const fullPrompt = renderContextPrompt(params.context, params.prompt)
  const startedAt = Date.now()

  const result = await withTempDir(async (workdir) => {
    await params.prepare?.(workdir)
    return runCommand(bin, params.buildArgs(workdir), {
      timeoutMs,
      // Il prompt su stdin: fuori da `argv`, quindi fuori da `ps`.
      input: fullPrompt,
      cwd: workdir,
      env: params.env,
    })
  })

  const durationMs = Date.now() - startedAt

  if (result.code !== 0) {
    // stderr prima di stdout: le CLI scrivono lì la diagnostica.
    const code = classifyFailure(result.stderr) ?? classifyFailure(result.stdout)
    throw new AiProviderError(
      code ?? 'PROCESS_FAILED',
      `${executableName(bin)} exited with ${result.code}`,
      sanitizeDetail(result.stderr)
    )
  }

  const text = result.stdout.trim()
  if (!text) {
    // Exit code 0 senza risposta: non c'è nulla da mostrare all'utente.
    throw new AiProviderError(
      'INVALID_OUTPUT',
      `${executableName(bin)} returned no output`,
      sanitizeDetail(result.stderr)
    )
  }

  // `parseAdvice` non lancia: se il JSON manca resta il testo (spec §46).
  const parsed = parseAdvice(text)
  return { providerId, text: parsed.text, advice: parsed.advice, durationMs }
}
