import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiProviderError } from '#shared/types/ai'
import { CodexProvider } from '../../../server/providers/ai/codex'
import { TaskQueue } from '../../../server/providers/ai/queue'
import { createWorkerDeps, handleAsk, handleStatus } from '../../../worker/codex/server'
import type { WorkerDeps } from '../../../worker/codex/server'
import { auctionContext } from './helpers/context'
import { fakeSpawn } from './helpers/fake-spawn'

// Nessuna CLI reale: `vi.mock` viene comunque issato sopra gli import da Vitest.
vi.mock('node:child_process', async () => {
  const { fakeSpawn } = await import('./helpers/fake-spawn')
  return { spawn: fakeSpawn.spawn }
})

const context = auctionContext()
const WORKER_URL = 'http://codex-worker:8787'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  fakeSpawn.reset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CodexProvider in modalità worker', () => {
  const codex = new CodexProvider({ bin: 'codex', timeoutMs: 2000, workerUrl: WORKER_URL })

  it('non esegue alcun processo locale: parla solo HTTP', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { text: 'Passa.', durationMs: 10 }))

    await codex.ask(context, 'Conviene?')

    expect(fakeSpawn.spawn).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invia un corpo conforme al contratto interno', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { text: 'Passa.', durationMs: 10 }))

    await codex.ask(context, 'Conviene a 38?')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${WORKER_URL}/ask`)
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['context', 'prompt', 'timeoutMs'])
    expect(body.prompt).toBe('Conviene a 38?')
  })

  it('estrae l’output strutturato dal testo del worker', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        text: 'Sì.\n```json\n{"recommendation":"BUY","reasoning":"Titolare","alternatives":[]}\n```',
        durationMs: 10,
      })
    )

    const response = await codex.ask(context, 'Conviene?')

    expect(response.providerId).toBe('codex')
    expect(response.advice?.recommendation).toBe('BUY')
  })

  it('ri-lancia PROVIDER_BUSY del worker con lo stesso codice', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { code: 'PROVIDER_BUSY' }))

    const error = await codex.ask(context, 'Conviene?').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiProviderError)
    expect((error as AiProviderError).code).toBe('PROVIDER_BUSY')
  })

  it('ri-lancia NOT_AUTHENTICATED del worker con lo stesso codice', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { code: 'NOT_AUTHENTICATED', detail: 'codex login required' })
    )

    await expect(codex.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
      detail: 'codex login required',
    })
  })

  it('un codice sconosciuto del worker diventa PROCESS_FAILED', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { code: 'WAT' }))

    await expect(codex.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
    })
  })

  it('INVALID_OUTPUT se la risposta non rispetta il contratto', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { texto: 'sbagliato' }))

    await expect(codex.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    })
  })

  it('PROCESS_FAILED se il worker è irraggiungibile', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8787'))

    await expect(codex.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
    })
  })

  it('getStatus rispecchia lo stato riportato dal worker', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { state: 'NOT_AUTHENTICATED', executable: 'codex' })
    )

    const status = await codex.getStatus()

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${WORKER_URL}/status`)
    expect(status).toMatchObject({
      id: 'codex',
      state: 'NOT_AUTHENTICATED',
      hintKey: 'ai.hint.codexLogin',
    })
  })

  it('getStatus non lancia se il worker non risponde', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    await expect(codex.getStatus()).resolves.toMatchObject({ state: 'ERROR' })
  })

  it('normalizza una URL con slash finale', async () => {
    const withSlash = new CodexProvider({
      bin: 'codex',
      timeoutMs: 2000,
      workerUrl: `${WORKER_URL}/`,
    })
    fetchMock.mockResolvedValue(jsonResponse(200, { state: 'AVAILABLE', executable: 'codex' }))

    await withSlash.getStatus()

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${WORKER_URL}/status`)
  })

  it('una workerUrl vuota lascia il provider in modalità locale', async () => {
    const local = new CodexProvider({ bin: 'codex', timeoutMs: 500, workerUrl: '  ' })
    // Modalità locale: probe di presenza, probe di sessione, poi `codex exec`.
    fakeSpawn.queue(
      { stdout: '1.0.0', code: 0 },
      { stdout: 'Logged in using ChatGPT\n', code: 0 },
      { stdout: 'ok', code: 0 }
    )

    await local.ask(context, 'Conviene?')

    expect(fakeSpawn.spawn).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('codex-worker: POST /ask', () => {
  function deps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
    return {
      runCodex: vi.fn(async () => 'Passa.'),
      codexStatus: vi.fn(async () => ({ state: 'AVAILABLE' as const, executable: 'codex' })),
      queue: new TaskQueue({ concurrency: 1, maxPending: 8, timeoutMs: 2000 }),
      defaultTimeoutMs: 2000,
      ...overrides,
    }
  }

  const validBody = { prompt: 'Conviene a 38?', context: { auction: { season: '2025-26' } } }

  it('accetta il contratto applicativo e risponde con il testo', async () => {
    const workerDeps = deps()

    const reply = await handleAsk(validBody, workerDeps)

    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ text: 'Passa.' })
    // Il prompt eseguito è quello reso dal dominio, non il testo grezzo.
    const prompt = vi.mocked(workerDeps.runCodex).mock.calls[0]?.[0] ?? ''
    expect(prompt).toContain('Conviene a 38?')
    expect(prompt).toContain('AUCTION CONTEXT')
  })

  it('rifiuta un payload che tenta di passare un comando', async () => {
    // Spec §37: l'endpoint interno non accetta comandi shell arbitrari.
    const workerDeps = deps()

    const reply = await handleAsk({ command: 'rm -rf /' }, workerDeps)

    expect(reply.status).toBe(400)
    expect(reply.body).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(workerDeps.runCodex).not.toHaveBeenCalled()
  })

  it('scarta i campi estranei invece di inoltrarli', async () => {
    const workerDeps = deps()

    const reply = await handleAsk({ ...validBody, cmd: 'whoami', bin: '/bin/sh' }, workerDeps)

    expect(reply.status).toBe(200)
    // Lo schema tiene solo prompt/context/timeoutMs: nulla di estraneo arriva a Codex.
    const prompt = vi.mocked(workerDeps.runCodex).mock.calls[0]?.[0] ?? ''
    expect(prompt).not.toContain('whoami')
    expect(prompt).not.toContain('/bin/sh')
  })

  it.each([
    ['corpo non oggetto', 'ciao'],
    ['prompt mancante', { context: {} }],
    ['contesto mancante', { prompt: 'Conviene?' }],
    ['prompt vuoto', { prompt: '   ', context: {} }],
    ['prompt oltre il limite', { prompt: 'a'.repeat(4001), context: {} }],
    ['timeout non plausibile', { prompt: 'Conviene?', context: {}, timeoutMs: 5 }],
  ])('rifiuta %s', async (_name, body) => {
    const workerDeps = deps()

    const reply = await handleAsk(body, workerDeps)

    expect(reply.status).toBe(400)
    expect(reply.body).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(workerDeps.runCodex).not.toHaveBeenCalled()
  })

  it('risponde 429 PROVIDER_BUSY quando la coda è piena', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 1, timeoutMs: 2000 })
    let release!: () => void
    const gate = new Promise<string>((resolve) => {
      release = () => resolve('finito')
    })
    const workerDeps = deps({ queue, runCodex: vi.fn(() => gate) })

    // Una in esecuzione, una in attesa: il limite è raggiunto.
    const first = handleAsk(validBody, workerDeps)
    const second = handleAsk(validBody, workerDeps)
    const third = await handleAsk(validBody, workerDeps)

    expect(third.status).toBe(429)
    expect(third.body).toMatchObject({ code: 'PROVIDER_BUSY' })

    release()
    await Promise.all([first, second])
  })

  it('risponde 504 TIMEOUT quando Codex non termina', async () => {
    const workerDeps = deps({
      runCodex: vi.fn(async () => {
        throw new AiProviderError('TIMEOUT', 'codex exceeded 2000ms')
      }),
    })

    const reply = await handleAsk(validBody, workerDeps)

    expect(reply.status).toBe(504)
    expect(reply.body).toMatchObject({ code: 'TIMEOUT' })
  })

  it('risponde 503 quando la sessione Codex manca', async () => {
    const workerDeps = deps({
      runCodex: vi.fn(async () => {
        throw new AiProviderError('NOT_AUTHENTICATED', 'codex login required')
      }),
    })

    const reply = await handleAsk(validBody, workerDeps)

    expect(reply.status).toBe(503)
    expect(reply.body).toMatchObject({ code: 'NOT_AUTHENTICATED' })
  })

  it('un errore inatteso non trasuda dettagli interni', async () => {
    const workerDeps = deps({
      runCodex: vi.fn(async () => {
        throw new Error('ENOENT /var/lib/codex/auth.json')
      }),
    })

    const reply = await handleAsk(validBody, workerDeps)

    expect(reply.status).toBe(500)
    expect(reply.body).toEqual({ code: 'PROCESS_FAILED' })
    expect(JSON.stringify(reply.body)).not.toContain('auth.json')
  })

  it('le dipendenze reali non invocano `codex exec` senza sessione', async () => {
    // Stesso motivo del provider locale: senza login `codex exec` resta appeso.
    const real = createWorkerDeps({
      host: '127.0.0.1',
      port: 8787,
      codexBin: 'codex',
      codexHome: '/var/lib/codex',
      timeoutMs: 500,
      maxPending: 8,
    })
    fakeSpawn.queue({ stdout: 'Not logged in\n', code: 0 })

    const reply = await handleAsk(validBody, deps({ runCodex: real.runCodex }))

    expect(reply.status).toBe(503)
    expect(reply.body).toMatchObject({ code: 'NOT_AUTHENTICATED' })
    expect(fakeSpawn.calls.some((c) => c.appArgs.includes('exec'))).toBe(false)
  })

  it('GET /status non restituisce credenziali', async () => {
    const reply = await handleStatus(deps())

    expect(reply.status).toBe(200)
    expect(Object.keys(reply.body as object).sort()).toEqual(['executable', 'state'])
  })
})
