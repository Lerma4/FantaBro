/**
 * Registry dei provider AI (spec §33, §44).
 *
 * Riceve la configurazione dall'esterno invece di leggere `runtimeConfig` da sé:
 * così l'assemblaggio è verificabile con un test e `index.ts` resta un semplice
 * adattatore verso Nitro.
 *
 * Ogni provider ha la **propria** coda: un Codex lento non blocca chi sta
 * chiedendo un consiglio a Claude Code.
 */
import { AiProviderError } from '#shared/types/ai'
import type {
  AiProvider,
  AiProviderId,
  AiProviderStatus,
  AiResponse,
  AuctionContext,
} from '#shared/types/ai'
import { ClaudeCodeProvider } from './claude-code'
import { CodexProvider } from './codex'
import { OpenCodeProvider } from './opencode'
import { buildStatus, executableName } from './cli'
import { sanitizeDetail } from './exec'
import { TaskQueue } from './queue'

/** Sottoinsieme di `runtimeConfig.ai` che serve al layer AI. */
export interface AiRuntimeConfig {
  timeoutMs: number
  maxPending: number
  claudeBin: string
  opencodeBin: string
  codexBin: string
  codexWorkerUrl: string
}

export interface AiRegistry {
  getAiProvider: (id: AiProviderId) => AiProvider
  listAiProviders: () => AiProvider[]
  getAllProviderStatuses: () => Promise<AiProviderStatus[]>
  askWithProvider: (
    id: AiProviderId,
    context: AuctionContext,
    prompt: string
  ) => Promise<AiResponse>
}

/**
 * Le CLI condividono i file di sessione sul disco del server: due invocazioni in
 * parallelo li corrompono. Un solo task per volta per provider (spec §37, §44).
 */
const CLI_CONCURRENCY = 1

/**
 * Tetto complessivo su un controllo di stato. I due probe interni valgono al
 * massimo `2 × PROBE_TIMEOUT_MS`: questo è il paracadute se una CLI si impianta
 * in un modo che il singolo timeout non copre.
 */
const STATUS_TIMEOUT_MS = 25_000

interface RegisteredProvider {
  provider: AiProvider
  /** Solo il nome del file: serve a comporre uno stato di errore sensato. */
  executable: string
  queue: TaskQueue
}

/**
 * Risolve entro `ms` oppure produce `fallback`. Non lascia timer appesi, che
 * terrebbero vivo il process handle di Nitro.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback()), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createAiRegistry(config: AiRuntimeConfig): AiRegistry {
  const queueOptions = {
    concurrency: CLI_CONCURRENCY,
    maxPending: config.maxPending,
    timeoutMs: config.timeoutMs,
  }

  const entries: RegisteredProvider[] = [
    {
      provider: new ClaudeCodeProvider({ bin: config.claudeBin, timeoutMs: config.timeoutMs }),
      executable: executableName(config.claudeBin),
      queue: new TaskQueue(queueOptions),
    },
    {
      provider: new OpenCodeProvider({ bin: config.opencodeBin, timeoutMs: config.timeoutMs }),
      executable: executableName(config.opencodeBin),
      queue: new TaskQueue(queueOptions),
    },
    {
      provider: new CodexProvider({
        bin: config.codexBin,
        timeoutMs: config.timeoutMs,
        workerUrl: config.codexWorkerUrl,
      }),
      executable: executableName(config.codexBin),
      queue: new TaskQueue(queueOptions),
    },
  ]

  const registered = new Map<AiProviderId, RegisteredProvider>(
    entries.map((entry) => [entry.provider.id, entry])
  )

  const resolve = (id: AiProviderId): RegisteredProvider => {
    const entry = registered.get(id)
    if (!entry) {
      // Irraggiungibile: l'id arriva già validato da `aiProviderIdSchema`.
      throw new Error(`Unknown AI provider: ${id}`)
    }
    return entry
  }

  /** Uno stato non deve mai lanciare: la pagina impostazioni deve poter caricare. */
  const safeStatus = async (entry: RegisteredProvider): Promise<AiProviderStatus> => {
    const onFailure = (detail?: string): AiProviderStatus =>
      buildStatus(entry.provider.id, entry.executable, 'ERROR', { detail: sanitizeDetail(detail) })

    try {
      return await withDeadline(entry.provider.getStatus(), STATUS_TIMEOUT_MS, () =>
        onFailure('status check timed out')
      )
    } catch (error) {
      if (error instanceof AiProviderError) return onFailure(error.detail ?? error.code)
      return onFailure(error instanceof Error ? error.message : undefined)
    }
  }

  return {
    getAiProvider: (id) => resolve(id).provider,

    listAiProviders: () => entries.map((entry) => entry.provider),

    getAllProviderStatuses: async () =>
      // In parallelo: i provider sono indipendenti e la pagina li mostra insieme.
      // `safeStatus` non rigetta, quindi `Promise.all` non può fallire.
      await Promise.all(entries.map((entry) => safeStatus(entry))),

    askWithProvider: async (id, context, prompt) => {
      const entry = resolve(id)
      // La coda applica `maxPending` e il timeout complessivo della richiesta.
      return await entry.queue.run(() => entry.provider.ask(context, prompt))
    },
  }
}
