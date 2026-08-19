/**
 * Esecuzione sicura di `codex` dentro il worker (spec §37).
 *
 * DUPLICAZIONE DELIBERATA di `server/providers/ai/exec.ts`.
 * Il worker è un processo separato che gira in un container **senza Nuxt e senza
 * il codice applicativo di FantaBro**: importare il modulo dell'app trascinerebbe
 * il layer provider completo attraverso un confine di processo. Le poche decine
 * di righe qui sotto sono la copia minima che serve, con gli stessi vincoli:
 * `spawn` con array di argomenti e `shell: false`, prompt su stdin, environment
 * costruito da una allowlist, timeout obbligatorio.
 *
 * Se cambia una regola di sicurezza va cambiata in **entrambi** i file.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AiProviderError } from '#shared/types/ai'
import type { AiErrorCode } from '#shared/types/domain'

const KILL_GRACE_MS = 2_000
const MAX_OUTPUT_BYTES = 1_000_000

/**
 * Allowlist di environment: `OPENAI_API_KEY` non è in elenco, quindi `codex` non
 * può ripiegare in silenzio sulla fatturazione a consumo (spec §37). `CODEX_HOME`
 * viene passato esplicitamente da chi chiama.
 */
const ALLOWED_ENV_KEYS = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'TMPDIR',
] as const

function buildEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  env.NO_COLOR = '1'
  return { ...env, ...extra }
}

const REDACTED = '[redacted]'

/**
 * Pattern di credenziali. Il worker non deve poter stampare un token nemmeno per
 * sbaglio: `auth.json` vive nello stesso container (spec §37, §45).
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|sess|rk)-[A-Za-z0-9_-]{6,}/gi,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{6,}/gi,
  /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
  /\b([a-z][a-z0-9+.-]*):\/\/[^\s:/@]+:[^\s/@]+@/gi,
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|CREDENTIALS)[A-Z0-9_]*\s*[=:]\s*\S+/g,
  /\S*(?:auth\.json|\.credentials\.json)\S*/gi,
]

export function sanitize(text: string | undefined): string {
  if (!text) return ''
  let out = text
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, scheme?: string) =>
      typeof scheme === 'string' ? `${scheme}://${REDACTED}@` : REDACTED
    )
  }
  return out.trim()
}

export function sanitizeDetail(text: string | undefined, maxLength = 400): string | undefined {
  const clean = sanitize(text)
  if (!clean) return undefined
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean
}

/**
 * Riconoscimento dei fallimenti di `codex` sul suo output (spec §45).
 * Gemello ridotto di `classifyFailure` in `server/providers/ai/cli.ts`: qui
 * bastano i casi che `codex` produce davvero.
 */
const FAILURE_PATTERNS: Array<[RegExp, AiErrorCode]> = [
  [/\bsession (?:has )?expired\b/i, 'SESSION_EXPIRED'],
  [/\b(?:access |refresh )?token (?:has )?(?:expired|been revoked)\b/i, 'SESSION_EXPIRED'],
  [/\brate ?limit|\btoo many requests\b|\b429\b/i, 'PROVIDER_RATE_LIMITED'],
  [/\b(?:usage|quota) (?:limit )?(?:exceeded|reached)\b/i, 'PROVIDER_RATE_LIMITED'],
  [/\bnot logged in\b|\bnot authenticated\b/i, 'NOT_AUTHENTICATED'],
  [/\b(?:unauthorized|unauthenticated)\b|\b401\b/i, 'NOT_AUTHENTICATED'],
  [/\bauthentication (?:failed|required|error)\b/i, 'NOT_AUTHENTICATED'],
  [/\bplease run [`'"]?codex login\b/i, 'NOT_AUTHENTICATED'],
]

/** `undefined` = nessun pattern noto: chi chiama usa `PROCESS_FAILED`. */
export function classifyFailure(text: string): AiErrorCode | undefined {
  for (const [pattern, code] of FAILURE_PATTERNS) {
    if (pattern.test(text)) return code
  }
  return undefined
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface RunOptions {
  timeoutMs: number
  input?: string
  cwd?: string
  env?: Record<string, string>
}

function killTree(child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean }): void {
  if (child.pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      // Gruppo già terminato.
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // Processo già terminato.
  }
}

function forceKillTree(child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean }): void {
  if (child.pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // Gruppo già terminato.
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Processo già terminato.
  }
}

/** Esegue un comando senza shell. Non logga né il prompt né l'output. */
export async function runCommand(
  bin: string,
  args: string[],
  options: RunOptions
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: buildEnv(options.env ?? {}),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      action()
    }

    const abort = (error: AiProviderError): void => {
      killTree(child)
      killTimer = setTimeout(() => forceKillTree(child), KILL_GRACE_MS)
      killTimer.unref?.()
      finish(() => reject(error))
    }

    const timeoutTimer = setTimeout(() => {
      abort(new AiProviderError('TIMEOUT', `${bin} exceeded ${options.timeoutMs}ms`))
    }, options.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_OUTPUT_BYTES) {
        abort(new AiProviderError('INVALID_OUTPUT', `${bin} produced too much output`))
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_OUTPUT_BYTES)
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      const code = error.code === 'ENOENT' ? 'CLI_NOT_INSTALLED' : 'PROCESS_FAILED'
      finish(() => reject(new AiProviderError(code, `${bin} failed to start`)))
    })

    child.on('close', (code) => {
      finish(() => resolve({ stdout, stderr, code }))
    })

    child.stdin.on('error', () => {
      // EPIPE se il processo è già uscito: l'esito arriva da `close`.
    })
    child.stdin.end(options.input ?? '')
  })
}

/**
 * Esegue `fn` in una cartella temporanea vuota: `codex` è un coding agent e non
 * deve vedere né il codice del worker né `CODEX_HOME` come workspace (spec §43).
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-worker-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Pulizia best-effort.
    })
  }
}
