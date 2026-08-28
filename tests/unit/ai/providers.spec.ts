import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaudeCodeProvider } from '../../../server/providers/ai/claude-code'
import { CodexProvider } from '../../../server/providers/ai/codex'
import { OpenCodeProvider } from '../../../server/providers/ai/opencode'
import { classifyFailure } from '../../../server/providers/ai/cli'
import { auctionContext } from './helpers/context'
import { fakeSpawn } from './helpers/fake-spawn'

// Nessuna CLI reale: `vi.mock` viene comunque issato sopra gli import da Vitest.
vi.mock('node:child_process', async () => {
  const { fakeSpawn } = await import('./helpers/fake-spawn')
  return { spawn: fakeSpawn.spawn }
})

const context = auctionContext()

/** Il probe `--version` di `commandExists` precede ogni controllo di stato. */
const INSTALLED = { stdout: '1.0.0', code: 0 }

/** Esito di `codex login status` con sessione attiva. */
const LOGGED_IN = { stdout: 'Logged in using ChatGPT\n', code: 0 }

const claude = new ClaudeCodeProvider({ bin: 'claude', timeoutMs: 500 })
const opencode = new OpenCodeProvider({ bin: 'opencode', timeoutMs: 500 })
const codex = new CodexProvider({ bin: 'codex', timeoutMs: 500 })

beforeEach(() => {
  fakeSpawn.reset()
})

describe('ClaudeCodeProvider.getStatus', () => {
  it('NOT_INSTALLED quando l’eseguibile manca', async () => {
    fakeSpawn.queue({ errorCode: 'ENOENT' })

    const status = await claude.getStatus()

    expect(status).toMatchObject({
      id: 'claude-code',
      state: 'NOT_INSTALLED',
      executable: 'claude',
      hintKey: 'ai.hint.notInstalled',
    })
  })

  it('AVAILABLE con sessione valida', async () => {
    fakeSpawn.queue(INSTALLED, { stdout: '{"loggedIn":true,"subscriptionType":"max"}', code: 0 })

    const status = await claude.getStatus()

    expect(status.state).toBe('AVAILABLE')
    expect(fakeSpawn.last().appArgs).toEqual(['auth', 'status', '--json'])
  })

  it('non riporta l’identità dell’account del server', async () => {
    // Spec §40: la pagina impostazioni non mostra mai chi è loggato lato server.
    fakeSpawn.queue(INSTALLED, {
      stdout: '{"loggedIn":false,"email":"admin@example.com","orgId":"074e6572"}',
      code: 0,
    })

    const status = await claude.getStatus()

    expect(status.state).toBe('NOT_AUTHENTICATED')
    expect(JSON.stringify(status)).not.toContain('admin@example.com')
    expect(JSON.stringify(status)).not.toContain('074e6572')
  })

  it('NOT_AUTHENTICATED con exit code diverso da zero', async () => {
    fakeSpawn.queue(INSTALLED, { stderr: 'not logged in', code: 1 })

    const status = await claude.getStatus()

    expect(status).toMatchObject({ state: 'NOT_AUTHENTICATED', hintKey: 'ai.hint.claudeCodeLogin' })
  })

  it('ERROR se l’output del probe non è interpretabile', async () => {
    // Non sappiamo se la sessione esista: dire NOT_AUTHENTICATED sarebbe falso.
    fakeSpawn.queue(INSTALLED, { stdout: 'not json at all', code: 0 })

    const status = await claude.getStatus()

    expect(status.state).toBe('ERROR')
    expect(status.hintKey).toBeUndefined()
  })
})

describe('ClaudeCodeProvider.ask', () => {
  it('invoca la CLI in modalità non interattiva e con i soli strumenti di rete', async () => {
    fakeSpawn.queue({ stdout: 'Conviene, ma non oltre 40.', code: 0 })

    await claude.ask(context, 'Conviene a 38?')

    const call = fakeSpawn.last()
    expect(call.appArgs).toContain('--print')
    // Solo WebSearch/WebFetch: niente Bash, Edit o Read (spec §43).
    expect(call.appArgs).toContain('--tools')
    expect(call.appArgs[call.appArgs.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch')
    // Senza pre-approvazione, in `--print` il permesso non ha chi lo conceda.
    expect(call.appArgs[call.appArgs.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch')
    expect(call.appArgs).toContain('--safe-mode')
    expect(call.appArgs).toContain('--no-session-persistence')
    // `--bare` forzerebbe l'autenticazione via ANTHROPIC_API_KEY (spec §34).
    expect(call.appArgs).not.toContain('--bare')
    expect(call.appArgs).not.toContain('--dangerously-skip-permissions')
  })

  it('non espone il progetto: la cwd è una cartella temporanea', async () => {
    fakeSpawn.queue({ stdout: 'ok', code: 0 })

    await claude.ask(context, 'Conviene?')

    const cwd = fakeSpawn.last().cwd
    expect(cwd).toBeDefined()
    expect(cwd).toContain('fantabro-ai-')
    expect(cwd).not.toBe(process.cwd())
  })

  it('passa contesto e domanda su stdin, non negli argomenti', async () => {
    fakeSpawn.queue({ stdout: 'ok', code: 0 })

    await claude.ask(context, 'Conviene Lautaro a 38?')

    const call = fakeSpawn.last()
    expect(call.stdin).toContain('Conviene Lautaro a 38?')
    expect(call.stdin).toContain('Maignan')
    expect(call.args.join(' ')).not.toContain('Lautaro')
  })

  it('estrae l’output strutturato e tiene sempre il testo', async () => {
    fakeSpawn.queue({
      stdout: [
        'A 38 il prezzo è corretto.',
        '```json',
        '{"recommendation":"BUY","suggestedMaxPrice":42,"confidence":0.7,"reasoning":"Rigorista","alternatives":["Vlahovic"]}',
        '```',
      ].join('\n'),
      code: 0,
    })

    const response = await claude.ask(context, 'Conviene?')

    expect(response.providerId).toBe('claude-code')
    expect(response.advice).toMatchObject({ recommendation: 'BUY', suggestedMaxPrice: 42 })
    expect(response.text).toContain('A 38 il prezzo è corretto.')
    expect(response.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('tiene il testo quando l’output strutturato manca', async () => {
    // Spec §46: il fallback testuale è sempre disponibile.
    fakeSpawn.queue({ stdout: 'Meglio aspettare.', code: 0 })

    const response = await claude.ask(context, 'Conviene?')

    expect(response.advice).toBeUndefined()
    expect(response.text).toBe('Meglio aspettare.')
  })

  it('TIMEOUT se il processo non termina', async () => {
    fakeSpawn.queue({ hang: true })

    await expect(claude.ask(context, 'Conviene?')).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('PROCESS_FAILED su exit code non zero non riconosciuto', async () => {
    fakeSpawn.queue({ stderr: 'segmentation fault', code: 139 })

    await expect(claude.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
    })
  })

  it('NOT_AUTHENTICATED quando la CLI segnala la sessione mancante', async () => {
    fakeSpawn.queue({ stderr: 'Error: not authenticated. Please run claude auth login', code: 1 })

    await expect(claude.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    })
  })

  it('PROVIDER_RATE_LIMITED quando la quota è esaurita', async () => {
    fakeSpawn.queue({ stderr: 'Usage limit reached, retry later', code: 1 })

    await expect(claude.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    })
  })

  it('INVALID_OUTPUT quando la CLI esce bene ma senza risposta', async () => {
    fakeSpawn.queue({ stdout: '   ', code: 0 })

    await expect(claude.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    })
  })

  it('non lascia mai un segreto nel detail di un errore', async () => {
    fakeSpawn.queue({
      stderr: 'request failed with ANTHROPIC_API_KEY=sk-ant-oat01-TOPSECRET123456',
      code: 1,
    })

    const error = await claude.ask(context, 'Conviene?').catch((e: unknown) => e)

    expect(JSON.stringify(error)).not.toContain('TOPSECRET123456')
  })
})

describe('OpenCodeProvider', () => {
  it('AVAILABLE con almeno una credenziale registrata', async () => {
    fakeSpawn.queue(INSTALLED, {
      stdout: '  Credentials\n  Google oauth\n  OpenAI oauth\n  2 credentials\n',
      code: 0,
    })

    const status = await opencode.getStatus()

    expect(status).toMatchObject({ id: 'opencode', state: 'AVAILABLE', executable: 'opencode' })
    expect(fakeSpawn.last().appArgs).toEqual(['providers', 'list'])
  })

  it('NOT_AUTHENTICATED quando nessun provider upstream è configurato', async () => {
    fakeSpawn.queue(INSTALLED, { stdout: '  Credentials\n  0 credentials\n', code: 0 })

    const status = await opencode.getStatus()

    expect(status).toMatchObject({
      state: 'NOT_AUTHENTICATED',
      hintKey: 'ai.hint.opencodeLogin',
    })
  })

  it('non riporta il percorso di auth.json', async () => {
    fakeSpawn.queue(INSTALLED, {
      stdout: 'Credentials ~/.local/share/opencode/auth.json\n',
      code: 0,
    })

    const status = await opencode.getStatus()

    expect(JSON.stringify(status)).not.toContain('auth.json')
  })

  it('NOT_INSTALLED quando l’eseguibile manca', async () => {
    fakeSpawn.queue({ errorCode: 'ENOENT' })

    await expect(opencode.getStatus()).resolves.toMatchObject({ state: 'NOT_INSTALLED' })
  })

  it('invoca `run` senza plugin esterni e senza auto-approvazione', async () => {
    fakeSpawn.queue({ stdout: 'Meglio passare.', code: 0 })

    const response = await opencode.ask(context, 'Conviene?')

    const call = fakeSpawn.last()
    expect(call.appArgs).toEqual(['run', '--pure'])
    // `--auto` approverebbe automaticamente l'uso degli strumenti (spec §43).
    expect(call.appArgs).not.toContain('--auto')
    expect(call.stdin).toContain('Conviene?')
    expect(response.providerId).toBe('opencode')
  })

  it('spegne shell, filesystem e delega lasciando solo webfetch', async () => {
    // Verificato contro la CLI reale: senza questa config un prompt che chiede di
    // eseguire un comando ottiene l'esecuzione, anche senza `--auto`. È la via di
    // prompt-injection che spec §43 vieta, e il prompt d'asta è testo dell'utente.
    fakeSpawn.queue({ stdout: 'Meglio passare.', code: 0 })

    await opencode.ask(context, 'Conviene?')

    const config = JSON.parse(fakeSpawn.last().cwdFiles['opencode.json'] ?? '{}')
    expect(config.tools).toMatchObject({
      bash: false,
      edit: false,
      write: false,
      read: false,
      // `task` delega a un subagente che la policy del primario non copre.
      task: false,
      webfetch: true,
    })
    expect(config.permission).toMatchObject({ bash: 'deny', webfetch: 'allow' })
  })

  it('la config vive solo nella cartella temporanea della richiesta', async () => {
    fakeSpawn.queue({ stdout: 'ok', code: 0 })

    await opencode.ask(context, 'Conviene?')

    const call = fakeSpawn.last()
    expect(call.cwd).toContain('fantabro-ai-')
    expect(Object.keys(call.cwdFiles)).toEqual(['opencode.json'])
  })

  it('TIMEOUT se il processo non termina', async () => {
    fakeSpawn.queue({ hang: true })

    await expect(opencode.ask(context, 'Conviene?')).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('CodexProvider in modalità locale', () => {
  it('AVAILABLE con login ChatGPT attivo', async () => {
    fakeSpawn.queue(INSTALLED, { stdout: 'Logged in using ChatGPT\n', code: 0 })

    const status = await codex.getStatus()

    expect(status).toMatchObject({ id: 'codex', state: 'AVAILABLE', executable: 'codex' })
    expect(fakeSpawn.last().appArgs).toEqual(['login', 'status'])
  })

  it('NOT_AUTHENTICATED quando non c’è login', async () => {
    // Output ed exit code verificati contro la CLI reale con `CODEX_HOME` vuoto:
    // stampa "Not logged in" ed esce con 0, quindi la stringa è portante.
    fakeSpawn.queue(INSTALLED, { stdout: 'Not logged in\n', code: 0 })

    const status = await codex.getStatus()

    expect(status).toMatchObject({ state: 'NOT_AUTHENTICATED', hintKey: 'ai.hint.codexLogin' })
  })

  it('un messaggio riscritto non diventa mai un falso AVAILABLE', async () => {
    // "not currently logged in" non contiene "not logged in" ma contiene
    // "logged in": dedurre il positivo dall'assenza del negativo darebbe
    // AVAILABLE, e la richiesta resterebbe appesa fino al timeout.
    fakeSpawn.queue(INSTALLED, { stdout: 'You are not currently logged in.\n', code: 0 })

    await expect(codex.getStatus()).resolves.toMatchObject({ state: 'NOT_AUTHENTICATED' })
  })

  it('un wording del tutto sconosciuto è ERROR, non AVAILABLE', async () => {
    fakeSpawn.queue(INSTALLED, { stdout: 'authentication state: unknown\n', code: 0 })

    await expect(codex.getStatus()).resolves.toMatchObject({ state: 'ERROR' })
  })

  it('NOT_INSTALLED quando l’eseguibile manca', async () => {
    fakeSpawn.queue({ errorCode: 'ENOENT' })

    await expect(codex.getStatus()).resolves.toMatchObject({ state: 'NOT_INSTALLED' })
  })

  it('usa `codex exec` con sandbox in sola lettura e sessione effimera', async () => {
    fakeSpawn.queue(INSTALLED, LOGGED_IN, { stdout: 'Passa.', code: 0 })

    await codex.ask(context, 'Conviene?')

    const call = fakeSpawn.last()
    expect(call.appArgs.slice(0, 2)).toEqual(['exec', '--sandbox'])
    expect(call.appArgs).toContain('read-only')
    expect(call.appArgs).toContain('--ephemeral')
    expect(call.appArgs).toContain('--skip-git-repo-check')
    // Questa versione della CLI non ha un flag dedicato: la ricerca web si
    // abilita solo da configurazione. È uno strumento lato modello, quindi non
    // allarga la sandbox.
    expect(call.appArgs).toContain('tools.web_search=true')
    expect(call.appArgs).toContain('--sandbox')
    // `-` in coda: il prompt arriva da stdin.
    expect(call.appArgs.at(-1)).toBe('-')
    // `--cd` punta alla cartella temporanea, non al progetto.
    expect(call.appArgs[call.appArgs.indexOf('--cd') + 1]).toBe(call.cwd)
    // Scartare la config del server disattiverebbe forced_login_method (spec §37).
    expect(call.appArgs).not.toContain('--ignore-user-config')
    expect(call.appArgs).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('propaga CODEX_HOME al processo e nient’altro di sensibile', async () => {
    vi.stubEnv('CODEX_HOME', '/var/lib/codex')
    vi.stubEnv('OPENAI_API_KEY', 'sk-should-not-leak')
    fakeSpawn.queue(INSTALLED, LOGGED_IN, { stdout: 'ok', code: 0 })

    await codex.ask(context, 'Conviene?')

    const env = fakeSpawn.last().env
    expect(env.CODEX_HOME).toBe('/var/lib/codex')
    // Nessun fallback silenzioso sulla fatturazione a consumo (spec §37).
    expect(env.OPENAI_API_KEY).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('PROCESS_FAILED su exit code non zero non riconosciuto', async () => {
    fakeSpawn.queue(INSTALLED, LOGGED_IN, { stderr: 'unexpected internal error', code: 2 })

    await expect(codex.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
    })
  })

  it('senza sessione fallisce subito, senza invocare `codex exec`', async () => {
    // Verificato sull'immagine reale: senza login `codex exec` non fallisce, resta
    // appeso fino al timeout. Il probe lo trasforma in un errore azionabile (spec §37).
    fakeSpawn.queue(INSTALLED, { stdout: 'Not logged in\n', code: 0 })

    await expect(codex.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    })

    // Solo i due probe: nessun `exec`.
    expect(fakeSpawn.calls).toHaveLength(2)
    expect(fakeSpawn.calls.some((c) => c.appArgs.includes('exec'))).toBe(false)
  })

  it('senza eseguibile fallisce con CLI_NOT_INSTALLED', async () => {
    fakeSpawn.queue({ errorCode: 'ENOENT' })

    await expect(codex.ask(context, 'Conviene?')).rejects.toMatchObject({
      code: 'CLI_NOT_INSTALLED',
    })
  })
})

describe('classifyFailure', () => {
  it('riconosce i codici stabili dai messaggi delle CLI', () => {
    expect(classifyFailure('Session expired, please login again')).toBe('SESSION_EXPIRED')
    expect(classifyFailure('429 Too Many Requests')).toBe('PROVIDER_RATE_LIMITED')
    expect(classifyFailure('Error: unauthorized')).toBe('NOT_AUTHENTICATED')
    expect(classifyFailure('provider not configured')).toBe('NOT_AUTHENTICATED')
  })

  it('non indovina: senza pattern noti lascia decidere al chiamante', () => {
    expect(classifyFailure('killed by signal 9')).toBeUndefined()
  })
})
