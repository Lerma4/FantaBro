/**
 * CodexProvider (spec §37). Due modalità, scelte dalla configurazione:
 *
 * 1. `codexWorkerUrl` impostato -> HTTP interno verso il codex-worker.
 *    È la modalità di produzione su Kubernetes: la sessione Codex autenticata
 *    vive in un solo pod con `CODEX_HOME` su volume persistente, e le repliche
 *    stateless di FantaBro non si contendono `auth.json` (spec §37).
 * 2. altrimenti -> `codex exec` locale non interattivo, per sviluppo e Compose.
 *
 * In nessuna delle due serve una API key OpenAI, e non c'è fallback su
 * `OPENAI_API_KEY`: la variabile non è nella allowlist di `buildEnv`, quindi il
 * processo `codex` non la vede nemmeno (spec §34, §37).
 */
import { z } from 'zod'
import {
  workerAskRequestSchema,
  workerAskResponseSchema,
  workerErrorResponseSchema,
} from '#shared/schemas/ai'
import { AI_PROVIDER_STATES } from '#shared/constants/ai'
import { AI_ERROR_CODES } from '#shared/constants/errors'
import { AiProviderError } from '#shared/types/ai'
import type { AiProvider, AiProviderStatus, AiResponse, AuctionContext } from '#shared/types/ai'
import type { AiErrorCode } from '#shared/types/domain'
import { parseAdvice } from '../../domain/ai-context'
import { buildStatus, cliStatus, runCliAsk } from './cli'
import { PROBE_TIMEOUT_MS, sanitizeDetail } from './exec'

/**
 * Flag verificati sull'help di `codex` 0.147 (`codex exec --help`) e provati
 * end-to-end contro la CLI installata:
 *
 * - `exec`                  esecuzione non interattiva.
 * - `-`                     l'help documenta che con `-` le istruzioni sono lette
 *                           da stdin: il prompt non passa da `argv`.
 * - `--sandbox read-only`   la policy più restrittiva fra quelle offerte; unita a
 *                           una cwd temporanea vuota non c'è nulla di leggibile
 *                           (spec §43).
 * - `--skip-git-repo-check` la cwd temporanea non è un repository git; senza
 *                           questo flag `codex exec` si rifiuta di partire.
 * - `--ephemeral`           "run without persisting session files to disk":
 *                           richieste stateless, nessuno stato condiviso fra
 *                           invocazioni concorrenti (spec §44).
 * - `--color never`         stdout pulito.
 * - `--cd <workdir>`        radice del workspace esplicita sulla cartella vuota.
 *
 * Deliberatamente NON si usa `--ignore-user-config`: quel flag scarterebbe
 * `$CODEX_HOME/config.toml`, cioè proprio `forced_login_method = "chatgpt"` e
 * `cli_auth_credentials_store = "file"` che la specifica vuole attivi (spec §37).
 * Nemmeno `--dangerously-bypass-approvals-and-sandbox`, per ragioni evidenti.
 *
 * Con questi flag la risposta arriva su stdout pulito; intestazione, eco del
 * prompt e conteggio token vanno su stderr (per questo stderr non va mai loggato
 * così com'è: contiene il prompt).
 */
const ASK_ARGS = [
  'exec',
  '--sandbox',
  'read-only',
  '--skip-git-repo-check',
  '--ephemeral',
  '--color',
  'never',
] as const

/** `codex login status` stampa `Logged in using ChatGPT` senza invocare il modello. */
const AUTH_ARGS = ['login', 'status'] as const

/** Risposta di `GET /status` del worker: solo stato, mai credenziali (spec §37). */
const workerStatusResponseSchema = z.object({
  state: z.enum(AI_PROVIDER_STATES),
  executable: z.string(),
  detail: z.string().optional(),
})

/**
 * Margine fra il timeout che imponiamo al worker e quello del nostro fetch:
 * così scade prima il worker e riceviamo un `TIMEOUT` esplicito invece di un
 * abort di rete senza diagnosi.
 */
const WORKER_TIMEOUT_MARGIN_MS = 5_000

const MIN_WORKER_TIMEOUT_MS = 1_000
const MAX_WORKER_TIMEOUT_MS = 600_000

export interface CodexProviderOptions {
  bin: string
  timeoutMs: number
  /** Se valorizzato attiva la modalità worker. */
  workerUrl?: string
}

function isAiErrorCode(value: string): value is AiErrorCode {
  return (AI_ERROR_CODES as readonly string[]).includes(value)
}

export class CodexProvider implements AiProvider {
  readonly id = 'codex' as const

  private readonly workerUrl?: string

  constructor(private readonly options: CodexProviderOptions) {
    // Una URL vuota in runtimeConfig significa "modalità locale".
    const url = options.workerUrl?.trim()
    this.workerUrl = url ? url.replace(/\/+$/, '') : undefined
  }

  async getStatus(): Promise<AiProviderStatus> {
    return this.workerUrl ? await this.getWorkerStatus(this.workerUrl) : await this.getLocalStatus()
  }

  async ask(context: AuctionContext, prompt: string): Promise<AiResponse> {
    return this.workerUrl
      ? await this.askWorker(this.workerUrl, context, prompt)
      : await this.askLocal(context, prompt)
  }

  // --- Modalità locale (sviluppo, Docker Compose) ---------------------------

  private async getLocalStatus(): Promise<AiProviderStatus> {
    return await cliStatus({
      providerId: this.id,
      bin: this.options.bin,
      installHintKey: 'ai.hint.notInstalled',
      loginHintKey: 'ai.hint.codexLogin',
      authArgs: [...AUTH_ARGS],
      env: this.codexEnv(),
      interpret: (result) => {
        // Verificato con `CODEX_HOME` vuoto: senza sessione `codex login status`
        // stampa "Not logged in" ed esce con **codice 0**. Il codice di uscita da
        // solo non distingue i due casi: la stringa è portante.
        if (result.code !== 0) return { state: 'NOT_AUTHENTICATED' }
        const output = `${result.stdout}\n${result.stderr}`
        // Si riconosce la forma **positiva** verificata ("Logged in using ChatGPT")
        // e tutto il resto non è `AVAILABLE`. Il contrario — cercare il negativo e
        // dedurre il positivo — è fragile nella direzione sbagliata: una riscrittura
        // tipo "not currently logged in" non contiene "not logged in" ma contiene
        // "logged in", e darebbe un falso AVAILABLE. Un falso AVAILABLE porta a
        // un'invocazione che resta appesa fino al timeout; un falso
        // NOT_AUTHENTICATED è solo un messaggio da rileggere.
        // DA RIVERIFICARE al primo deploy se si aggiorna la CLI Codex.
        if (/\blogged in using\b/i.test(output)) return { state: 'AVAILABLE' }
        if (/\bnot\b.{0,30}\blogged in\b/i.test(output)) return { state: 'NOT_AUTHENTICATED' }
        return { state: 'ERROR', detail: 'unexpected login status output' }
      },
    })
  }

  private async askLocal(context: AuctionContext, prompt: string): Promise<AiResponse> {
    // Verificato eseguendo l'immagine reale del worker: senza sessione
    // `codex exec` NON esce con errore, resta appeso fino al timeout. Senza
    // questo controllo l'utente vedrebbe `TIMEOUT` dopo due minuti invece del
    // `NOT_AUTHENTICATED` azionabile che la spec §37 richiede. Il probe è un
    // comando locale che non invoca il modello: costa una frazione di secondo
    // su una richiesta che ne dura decine.
    const status = await this.getLocalStatus()
    if (status.state !== 'AVAILABLE') {
      throw new AiProviderError(
        status.state === 'NOT_INSTALLED' ? 'CLI_NOT_INSTALLED' : 'NOT_AUTHENTICATED',
        `codex is ${status.state}`,
        status.detail
      )
    }

    return await runCliAsk({
      providerId: this.id,
      bin: this.options.bin,
      buildArgs: (workdir) => [...ASK_ARGS, '--cd', workdir, '-'],
      context,
      prompt,
      timeoutMs: this.options.timeoutMs,
      env: this.codexEnv(),
    })
  }

  /**
   * `CODEX_HOME` è un percorso di configurazione, non un segreto, ed è l'unico
   * modo per far trovare a `codex` la sessione sul volume persistente. Va passato
   * esplicitamente perché la allowlist di `buildEnv` non lo propaga.
   */
  private codexEnv(): Record<string, string> | undefined {
    const codexHome = process.env.CODEX_HOME
    return codexHome ? { CODEX_HOME: codexHome } : undefined
  }

  // --- Modalità worker (Kubernetes) -----------------------------------------

  private async getWorkerStatus(baseUrl: string): Promise<AiProviderStatus> {
    try {
      const response = await fetch(`${baseUrl}/status`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })

      if (!response.ok) {
        return buildStatus(this.id, this.options.bin, 'ERROR', {
          detail: `codex-worker responded ${response.status}`,
        })
      }

      const parsed = workerStatusResponseSchema.safeParse(await response.json())
      if (!parsed.success) {
        return buildStatus(this.id, this.options.bin, 'ERROR', {
          detail: 'unexpected codex-worker status payload',
        })
      }

      return buildStatus(this.id, parsed.data.executable, parsed.data.state, {
        hintKey: parsed.data.state === 'NOT_AUTHENTICATED' ? 'ai.hint.codexLogin' : undefined,
        detail: sanitizeDetail(parsed.data.detail),
      })
    } catch (error) {
      // Worker irraggiungibile o troppo lento: è un guasto, non uno stato di sessione.
      return buildStatus(this.id, this.options.bin, 'ERROR', {
        detail: sanitizeDetail(error instanceof Error ? error.message : undefined),
      })
    }
  }

  private async askWorker(
    baseUrl: string,
    context: AuctionContext,
    prompt: string
  ): Promise<AiResponse> {
    const timeoutMs = Math.min(
      Math.max(this.options.timeoutMs, MIN_WORKER_TIMEOUT_MS),
      MAX_WORKER_TIMEOUT_MS
    )

    // Si valida il payload in uscita con lo stesso schema che il worker usa in
    // ingresso: se il contratto cambia, il difetto emerge qui e non nel worker.
    // `parse` accetta `unknown`, quindi non serve forzare il tipo di `context`.
    const body = workerAskRequestSchema.parse({ prompt, context, timeoutMs })
    const startedAt = Date.now()

    let response: Response
    try {
      response = await fetch(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs + WORKER_TIMEOUT_MARGIN_MS),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new AiProviderError('TIMEOUT', 'codex-worker did not answer in time')
      }
      throw new AiProviderError(
        'PROCESS_FAILED',
        'codex-worker is unreachable',
        sanitizeDetail(error instanceof Error ? error.message : undefined)
      )
    }

    if (!response.ok) {
      throw await this.toWorkerError(response)
    }

    const parsed = workerAskResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new AiProviderError('INVALID_OUTPUT', 'unexpected codex-worker response payload')
    }

    const advice = parseAdvice(parsed.data.text)
    return {
      providerId: this.id,
      text: advice.text,
      advice: advice.advice,
      // Tempo di attesa reale del chiamante, coda del worker inclusa.
      durationMs: Date.now() - startedAt,
    }
  }

  /**
   * Ri-lancia l'errore del worker con lo **stesso** codice stabile, così l'utente
   * vede `PROVIDER_BUSY` o `NOT_AUTHENTICATED` e non un generico guasto HTTP.
   */
  private async toWorkerError(response: Response): Promise<AiProviderError> {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return new AiProviderError('PROCESS_FAILED', `codex-worker responded ${response.status}`)
    }

    const parsed = workerErrorResponseSchema.safeParse(payload)
    if (!parsed.success) {
      return new AiProviderError('PROCESS_FAILED', `codex-worker responded ${response.status}`)
    }

    const code = isAiErrorCode(parsed.data.code) ? parsed.data.code : 'PROCESS_FAILED'
    return new AiProviderError(
      code,
      `codex-worker: ${parsed.data.code}`,
      sanitizeDetail(parsed.data.detail)
    )
  }
}
