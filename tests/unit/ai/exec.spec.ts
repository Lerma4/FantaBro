import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiProviderError } from '#shared/types/ai'
import {
  buildEnv,
  commandExists,
  runCommand,
  sanitize,
  sanitizeDetail,
} from '../../../server/providers/ai/exec'
import { fakeSpawn } from './helpers/fake-spawn'

// Nessuna CLI reale: `vi.mock` viene comunque issato sopra gli import da Vitest.
vi.mock('node:child_process', async () => {
  const { fakeSpawn } = await import('./helpers/fake-spawn')
  return { spawn: fakeSpawn.spawn }
})

beforeEach(() => {
  fakeSpawn.reset()
})

describe('sanitize', () => {
  it('rimuove i token con prefisso noto', () => {
    expect(sanitize('key sk-ant-oat01-AbCdEf123456 fine')).toBe('key [redacted] fine')
    expect(sanitize('token gho_16C7e42F292c6912E7710c838347Ae178B4a')).toBe('token [redacted]')
    expect(sanitize('pat github_pat_11ABCDEFG0abcdefg')).toBe('pat [redacted]')
  })

  it('rimuove gli header di autorizzazione e i JWT', () => {
    expect(sanitize('Authorization: Bearer abcdef1234567890')).toContain('[redacted]')
    expect(sanitize('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890')
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K'
    expect(sanitize(`token=${jwt}`)).not.toContain(jwt)
  })

  it('rimuove le credenziali dalle URL conservando lo schema', () => {
    expect(sanitize('postgres://fantabro:s3gr3t0@db:5432/fantabro')).toBe(
      'postgres://[redacted]@db:5432/fantabro'
    )
    expect(sanitize('https://utente:password@example.com/x')).toBe(
      'https://[redacted]@example.com/x'
    )
  })

  it('rimuove le assegnazioni di variabili sensibili', () => {
    // Spec §45: mai un dump di environment in un messaggio di errore.
    expect(sanitize('DATABASE_URL=postgres://a:b@c/d BETTER_AUTH_SECRET=abc123')).not.toContain(
      'abc123'
    )
    expect(sanitize('OPENAI_API_KEY=hunter2')).not.toContain('hunter2')
  })

  it('rimuove i percorsi dei file di autenticazione', () => {
    expect(sanitize('failed reading /var/lib/codex/auth.json')).toBe('failed reading [redacted]')
    expect(sanitize('~/.claude/.credentials.json missing')).toBe('[redacted] missing')
  })

  it('lascia intatto un testo innocuo', () => {
    expect(sanitize('codex exited with 1')).toBe('codex exited with 1')
    expect(sanitize(undefined)).toBe('')
  })

  it('tronca un detail troppo lungo', () => {
    const detail = sanitizeDetail('x'.repeat(1000), 100)
    expect(detail).toHaveLength(101)
    expect(detail?.endsWith('…')).toBe(true)
  })
})

describe('buildEnv', () => {
  const secrets = {
    ANTHROPIC_API_KEY: 'sk-ant-should-not-leak',
    OPENAI_API_KEY: 'sk-should-not-leak',
    DATABASE_URL: 'postgres://fantabro:secret@localhost/fantabro',
    BETTER_AUTH_SECRET: 'super-secret',
  }

  beforeEach(() => {
    for (const [key, value] of Object.entries(secrets)) vi.stubEnv(key, value)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('non propaga segreti applicativi né API key al processo figlio', () => {
    const env = buildEnv()
    for (const key of Object.keys(secrets)) {
      expect(env[key]).toBeUndefined()
    }
    // L'assenza delle API key è strutturale: è ciò che rende impossibile il
    // fallback silenzioso alla fatturazione a consumo (spec §34).
    expect(Object.values(env).join(' ')).not.toContain('should-not-leak')
  })

  it('mantiene ciò che serve a trovare eseguibile e sessione', () => {
    vi.stubEnv('PATH', '/usr/bin')
    const env = buildEnv()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.NO_COLOR).toBe('1')
  })

  it('unisce le variabili passate esplicitamente', () => {
    expect(buildEnv({ CODEX_HOME: '/var/lib/codex' }).CODEX_HOME).toBe('/var/lib/codex')
  })
})

describe('runCommand', () => {
  it('passa il prompt su stdin e mai negli argomenti', async () => {
    fakeSpawn.queue({ stdout: 'ok', code: 0 })
    const prompt = 'Quanto devo spendere per Lautaro?'

    await runCommand('claude', ['--print'], { timeoutMs: 1000, input: prompt })

    const call = fakeSpawn.last()
    expect(call.stdin).toBe(prompt)
    expect(call.args).not.toContain(prompt)
    expect(call.args.join(' ')).not.toContain('Lautaro')
  })

  it('non usa mai la shell', async () => {
    fakeSpawn.queue({ stdout: 'ok', code: 0 })
    await runCommand('claude', ['--print'], { timeoutMs: 1000 })
    expect(fakeSpawn.last().shell).toBe(false)
  })

  it('restituisce stdout, stderr e exit code senza lanciare', async () => {
    fakeSpawn.queue({ stdout: 'risposta', stderr: 'rumore', code: 3 })

    const result = await runCommand('claude', [], { timeoutMs: 1000 })

    expect(result).toEqual({ stdout: 'risposta', stderr: 'rumore', code: 3 })
  })

  it('traduce ENOENT in CLI_NOT_INSTALLED', async () => {
    fakeSpawn.queue({ errorCode: 'ENOENT' })

    await expect(runCommand('claude', [], { timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'CLI_NOT_INSTALLED',
    })
  })

  it('lancia TIMEOUT e termina il processo che non finisce', async () => {
    fakeSpawn.queue({ hang: true })

    const error = await runCommand('claude', [], { timeoutMs: 30 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiProviderError)
    expect((error as AiProviderError).code).toBe('TIMEOUT')
    // Il processo non deve restare a consumare quota dopo il timeout.
    expect(fakeSpawn.children[0]?.kill).toHaveBeenCalled()
  })

  it('interrompe una CLI che produce output senza fine', async () => {
    fakeSpawn.queue({ stdout: 'x'.repeat(200), code: 0 })

    await expect(
      runCommand('claude', [], { timeoutMs: 1000, maxOutputBytes: 100 })
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
  })
})

describe('commandExists', () => {
  it('è falso quando l’eseguibile non c’è', async () => {
    fakeSpawn.queue({ errorCode: 'ENOENT' })
    await expect(commandExists('claude')).resolves.toBe(false)
  })

  it('è falso per uno shim non eseguibile senza shell (Windows)', async () => {
    fakeSpawn.queue({ errorCode: 'EINVAL' })
    await expect(commandExists('codex.cmd')).resolves.toBe(false)
  })

  it('è vero quando `--version` risponde', async () => {
    fakeSpawn.queue({ stdout: '2.1.235', code: 0 })
    await expect(commandExists('claude')).resolves.toBe(true)
    expect(fakeSpawn.last().args).toEqual(['--version'])
  })
})
