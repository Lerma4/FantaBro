/**
 * Codex worker (spec §37).
 *
 * Servizio interno che mantiene **l'unica** sessione Codex autenticata del
 * cluster. Su Kubernetes gira come StatefulSet con una sola replica e
 * `CODEX_HOME` su PersistentVolume: le repliche stateless di FantaBro non
 * toccano `auth.json` e non se lo contendono.
 *
 * Superficie volutamente minima:
 * - `POST /ask`     prompt applicativo + contesto d'asta -> testo della risposta
 * - `GET  /status`  stato del provider, mai credenziali
 * - `GET  /healthz` probe liveness/readiness
 *
 * Non esiste alcuna route che legga il filesystem, esegua comandi arbitrari o
 * riveli l'environment. `POST /ask` accetta **solo** ciò che
 * `workerAskRequestSchema` descrive: un prompt e un contesto d'asta. Non c'è
 * nessun campo che possa diventare un comando (spec §37, §43).
 *
 * Nessuna connessione a PostgreSQL: il contesto arriva già costruito da FantaBro.
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  workerAskRequestSchema,
  workerAskResponseSchema,
  workerErrorResponseSchema,
} from '#shared/schemas/ai'
import { AiProviderError } from '#shared/types/ai'
import type { AiProviderState, AuctionContext } from '#shared/types/ai'
import type { AiErrorCode } from '#shared/types/domain'
// Riuso deliberato di due moduli puri di FantaBro (nessuna dipendenza da Nuxt):
// il prompt DEVE essere identico a quello della modalità locale, e la politica
// di coda è la stessa. Duplicarli li farebbe divergere.
import { renderContextPrompt } from '../../server/domain/ai-context'
import { TaskQueue } from '../../server/providers/ai/queue'
import { classifyFailure, runCommand, sanitizeDetail, withTempDir } from './exec'

/**
 * Flag di `codex exec`, gemelli di quelli in `server/providers/ai/codex.ts`
 * (vedi lì per la motivazione di ciascuno e per i flag scartati).
 */
const CODEX_ASK_ARGS = [
  'exec',
  '--sandbox',
  'read-only',
  '--skip-git-repo-check',
  '--ephemeral',
  '--color',
  'never',
] as const

const CODEX_AUTH_ARGS = ['login', 'status'] as const

/** Tetto sul corpo della richiesta: il contesto d'asta è compatto per definizione. */
const MAX_BODY_BYTES = 256 * 1024

const PROBE_TIMEOUT_MS = 10_000

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export interface WorkerConfig {
  host: string
  port: number
  codexBin: string
  codexHome: string
  timeoutMs: number
  maxPending: number
}

export function readConfig(): WorkerConfig {
  return {
    // Default 0.0.0.0: il pod deve essere raggiungibile dal Service ClusterIP.
    host: process.env.CODEX_WORKER_HOST ?? '0.0.0.0',
    port: envNumber('CODEX_WORKER_PORT', 8787),
    codexBin: process.env.CODEX_BIN ?? 'codex',
    codexHome: process.env.CODEX_HOME ?? '/var/lib/codex',
    timeoutMs: envNumber('CODEX_WORKER_TIMEOUT_MS', 120_000),
    maxPending: envNumber('CODEX_WORKER_MAX_PENDING', 8),
  }
}

/** Da codice errore stabile a status HTTP. Il codice resta la fonte di verità. */
function httpStatusFor(code: AiErrorCode): number {
  switch (code) {
    case 'PROVIDER_BUSY':
    case 'PROVIDER_RATE_LIMITED':
      return 429
    case 'TIMEOUT':
      return 504
    case 'CLI_NOT_INSTALLED':
    case 'NOT_AUTHENTICATED':
    case 'SESSION_EXPIRED':
      return 503
    case 'INVALID_OUTPUT':
      return 502
    case 'PROCESS_FAILED':
      return 500
  }
}

export interface WorkerReply {
  status: number
  body: unknown
}

function errorReply(code: AiErrorCode | 'VALIDATION_FAILED', detail?: string): WorkerReply {
  return {
    status: code === 'VALIDATION_FAILED' ? 400 : httpStatusFor(code),
    body: workerErrorResponseSchema.parse({ code, detail }),
  }
}

export interface WorkerDeps {
  /** Esegue Codex e restituisce il testo della risposta. */
  runCodex: (prompt: string, timeoutMs: number) => Promise<string>
  /** Stato del provider, senza credenziali. */
  codexStatus: () => Promise<{ state: AiProviderState; executable: string; detail?: string }>
  queue: TaskQueue
  defaultTimeoutMs: number
}

/**
 * Gestisce `POST /ask` a partire dal corpo già deserializzato.
 *
 * Separato dal layer HTTP per essere verificabile senza aprire una porta.
 */
export async function handleAsk(rawBody: unknown, deps: WorkerDeps): Promise<WorkerReply> {
  const parsed = workerAskRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    // Validazione al confine di fiducia: qualunque campo estraneo (per esempio
    // un tentativo di passare un comando) viene scartato dallo schema.
    const first = parsed.error.issues[0]
    const where = first?.path.join('.')
    return errorReply(
      'VALIDATION_FAILED',
      where ? `invalid field: ${where}` : 'invalid request body'
    )
  }

  const timeoutMs = parsed.data.timeoutMs ?? deps.defaultTimeoutMs

  // `renderContextPrompt` serializza il contesto: la forma esatta non influisce
  // sull'esecuzione, e il confine di fiducia è già lo schema qui sopra.
  const prompt = renderContextPrompt(
    parsed.data.context as unknown as AuctionContext,
    parsed.data.prompt
  )

  const startedAt = Date.now()
  try {
    // Coda FIFO a concorrenza 1: `auth.json` non è concurrency-safe (spec §37).
    const text = await deps.queue.run(() => deps.runCodex(prompt, timeoutMs))
    return {
      status: 200,
      body: workerAskResponseSchema.parse({ text, durationMs: Date.now() - startedAt }),
    }
  } catch (error) {
    if (error instanceof AiProviderError) {
      return errorReply(error.code, error.detail)
    }
    return errorReply('PROCESS_FAILED')
  }
}

/** `GET /status`: solo stato ed eseguibile atteso, mai token o path di credenziali. */
export async function handleStatus(deps: WorkerDeps): Promise<WorkerReply> {
  try {
    return { status: 200, body: await deps.codexStatus() }
  } catch (error) {
    return {
      status: 200,
      body: {
        state: 'ERROR' satisfies AiProviderState,
        executable: 'codex',
        detail: sanitizeDetail(error instanceof Error ? error.message : undefined),
      },
    }
  }
}

/** Legge il corpo con un tetto: una richiesta enorme non deve esaurire la memoria. */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(res: ServerResponse, reply: WorkerReply): void {
  const payload = JSON.stringify(reply.body)
  res.writeHead(reply.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // Nessuna cache: le risposte sono per singola richiesta.
    'cache-control': 'no-store',
  })
  res.end(payload)
}

export interface WorkerServer {
  server: Server
  /** Smette di accettare nuove richieste; quelle in volo proseguono. */
  beginShutdown: () => void
}

export function createWorkerServer(deps: WorkerDeps): WorkerServer {
  let shuttingDown = false

  const server = createServer((req, res) => {
    void (async () => {
      // `req.url` è sempre un path relativo; si scarta la query.
      const path = (req.url ?? '/').split('?')[0]

      if (req.method === 'GET' && path === '/healthz') {
        send(res, { status: shuttingDown ? 503 : 200, body: { ok: !shuttingDown } })
        return
      }

      if (shuttingDown) {
        // Rollout in corso: si rifiutano le nuove richieste con un codice che
        // FantaBro sa già mostrare in modo sensato.
        send(res, errorReply('PROVIDER_BUSY', 'worker is shutting down'))
        return
      }

      if (req.method === 'GET' && path === '/status') {
        send(res, await handleStatus(deps))
        return
      }

      if (req.method === 'POST' && path === '/ask') {
        let body: unknown
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          send(res, errorReply('VALIDATION_FAILED', 'invalid JSON body'))
          return
        }
        send(res, await handleAsk(body, deps))
        return
      }

      send(res, { status: 404, body: { code: 'NOT_FOUND' } })
    })().catch(() => {
      // Ultima rete di sicurezza: nessun dettaglio interno verso il chiamante.
      if (!res.headersSent) send(res, errorReply('PROCESS_FAILED'))
    })
  })

  return {
    server,
    beginShutdown: () => {
      shuttingDown = true
    },
  }
}

/** Dipendenze reali: `codex` eseguito in modo non interattivo con `CODEX_HOME`. */
export function createWorkerDeps(config: WorkerConfig): WorkerDeps {
  // `CODEX_HOME` è un percorso di configurazione, non un segreto, ed è l'unico
  // modo per far trovare a `codex` la sessione sul volume persistente.
  const env = { CODEX_HOME: config.codexHome }

  const codexStatus: WorkerDeps['codexStatus'] = async () => {
    let result
    try {
      result = await runCommand(config.codexBin, [...CODEX_AUTH_ARGS], {
        timeoutMs: PROBE_TIMEOUT_MS,
        env,
      })
    } catch (error) {
      if (error instanceof AiProviderError && error.code === 'CLI_NOT_INSTALLED') {
        return { state: 'NOT_INSTALLED', executable: config.codexBin }
      }
      return {
        state: 'ERROR',
        executable: config.codexBin,
        detail: sanitizeDetail(error instanceof AiProviderError ? error.code : undefined),
      }
    }

    // Gemello di `getLocalStatus` in `server/providers/ai/codex.ts`, stessa
    // motivazione: verificato che senza sessione `codex login status` stampa
    // "Not logged in" con **codice di uscita 0**, quindi la stringa è portante; e
    // si riconosce la forma positiva ("Logged in using ...") invece di dedurla
    // dall'assenza del negativo, perché un falso AVAILABLE lascia la richiesta
    // appesa fino al timeout.
    // DA RIVERIFICARE al primo deploy se si aggiorna la CLI Codex.
    const output = `${result.stdout}\n${result.stderr}`
    if (result.code !== 0) {
      return { state: 'NOT_AUTHENTICATED', executable: config.codexBin }
    }
    if (/\blogged in using\b/i.test(output)) {
      return { state: 'AVAILABLE', executable: config.codexBin }
    }
    if (/\bnot\b.{0,30}\blogged in\b/i.test(output)) {
      return { state: 'NOT_AUTHENTICATED', executable: config.codexBin }
    }
    return {
      state: 'ERROR',
      executable: config.codexBin,
      detail: 'unexpected login status output',
    }
  }

  const runCodex: WorkerDeps['runCodex'] = async (prompt, timeoutMs) => {
    // Verificato eseguendo l'immagine reale: senza sessione `codex exec` NON
    // esce con errore, resta appeso fino al timeout. Senza questo controllo il
    // worker risponderebbe `TIMEOUT` dopo due minuti invece del
    // `NOT_AUTHENTICATED` azionabile che la spec §37 richiede. Il probe è un
    // comando locale che non invoca il modello.
    const status = await codexStatus()
    if (status.state !== 'AVAILABLE') {
      throw new AiProviderError(
        status.state === 'NOT_INSTALLED' ? 'CLI_NOT_INSTALLED' : 'NOT_AUTHENTICATED',
        `codex is ${status.state}`,
        status.detail
      )
    }

    const result = await withTempDir(async (workdir) =>
      runCommand(config.codexBin, [...CODEX_ASK_ARGS, '--cd', workdir, '-'], {
        timeoutMs,
        // Prompt su stdin: fuori da `argv` e quindi da `ps`.
        input: prompt,
        cwd: workdir,
        env,
      })
    )

    if (result.code !== 0) {
      const code = classifyFailure(result.stderr) ?? classifyFailure(result.stdout)
      throw new AiProviderError(
        code ?? 'PROCESS_FAILED',
        `codex exited with ${result.code}`,
        sanitizeDetail(result.stderr)
      )
    }

    const text = result.stdout.trim()
    if (!text) {
      throw new AiProviderError('INVALID_OUTPUT', 'codex returned no output')
    }
    return text
  }

  return {
    defaultTimeoutMs: config.timeoutMs,

    queue: new TaskQueue({
      // Una sola invocazione per volta: la sessione su disco è condivisa.
      concurrency: 1,
      maxPending: config.maxPending,
      timeoutMs: config.timeoutMs,
    }),

    runCodex,
    codexStatus,
  }
}

export function main(): void {
  const config = readConfig()
  const { server, beginShutdown } = createWorkerServer(createWorkerDeps(config))

  server.listen(config.port, config.host, () => {
    // Unico log di avvio: nessun valore sensibile, nessun riferimento al
    // contenuto di CODEX_HOME.
    console.info(`codex-worker in ascolto su ${config.host}:${config.port}`)
  })

  const shutdown = (signal: string): void => {
    console.info(`codex-worker: ${signal} ricevuto, chiusura in corso`)
    beginShutdown()
    server.close(() => process.exit(0))
    // Tetto oltre il quale si esce a forza: la richiesta in volo ha comunque il
    // proprio timeout, questo copre solo il caso patologico.
    setTimeout(() => process.exit(0), config.timeoutMs + 5_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

// Avvio solo se eseguito direttamente (`pnpm worker:codex`): i test importano le
// funzioni senza aprire una porta.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
