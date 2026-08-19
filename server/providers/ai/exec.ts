/**
 * Esecuzione sicura di processi per i provider AI (spec §36, §43, §45).
 *
 * Regole non negoziabili applicate qui:
 * - `spawn` con array di argomenti e `shell: false`: nessuna interpolazione di shell,
 *   quindi un prompt utente non può mai diventare un comando;
 * - il prompt viaggia su **stdin**, non in `argv`: non compare in `ps` e non può
 *   essere interpretato come flag;
 * - environment costruito da zero con una allowlist: il processo AI non vede
 *   `DATABASE_URL`, `BETTER_AUTH_SECRET` né `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`.
 *   L'assenza delle API key è strutturale, non una convenzione: è ciò che rende
 *   impossibile il fallback silenzioso alla fatturazione a consumo (spec §34, §37);
 * - timeout obbligatorio con escalation SIGTERM -> SIGKILL.
 *
 * Questo modulo non logga nulla: né il prompt, né stdout, né stderr (spec §45
 * vieta di esporre segreti o dump di environment). Chi chiama decide cosa
 * riportare, sempre passando da `sanitize`.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, extname, isAbsolute, join, sep } from 'node:path'
import { AiProviderError } from '#shared/types/ai'

export interface RunCommandOptions {
  timeoutMs: number
  /** Passato su stdin e mai in `argv`. */
  input?: string
  /** Working directory: per i provider AI è sempre una cartella temporanea vuota. */
  cwd?: string
  /** Variabili aggiuntive da unire alla allowlist (es. `CODEX_HOME`). */
  env?: Record<string, string>
  /** Tetto su stdout/stderr: protegge dalla CLI che sputa output senza fine. */
  maxOutputBytes?: number
}

export interface RunCommandResult {
  stdout: string
  stderr: string
  code: number | null
}

/** Grazia fra SIGTERM e SIGKILL quando il processo ignora la richiesta di uscita. */
const KILL_GRACE_MS = 2_000

const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000

/**
 * Timeout breve per i probe di presenza/autenticazione: sono comandi locali che
 * non invocano il modello, quindi 10s sono già molto generosi.
 */
export const PROBE_TIMEOUT_MS = 10_000

/**
 * Allowlist di environment. Contiene solo ciò che serve a un eseguibile per
 * partire e per ritrovare la propria configurazione utente (dove vivono le
 * sessioni CLI già autenticate). Nessuna variabile applicativa, nessuna API key.
 */
const ALLOWED_ENV_KEYS = [
  // POSIX
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  // Config utente delle CLI (OpenCode usa ~/.local/share, Codex/Claude ~/.<tool>)
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  // Windows
  'Path',
  'PATHEXT',
  'COMSPEC',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TEMP',
  'TMP',
  'PROCESSOR_ARCHITECTURE',
] as const

/** Costruisce l'environment minimo del processo figlio. */
export function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  // Output pulito e deterministico: nessuna sequenza ANSI da ripulire dopo.
  env.NO_COLOR = '1'
  return { ...env, ...extra }
}

/**
 * Risoluzione dell'eseguibile, con `shell: false` sempre.
 *
 * Su Windows `spawn` senza shell risolve **solo** eseguibili nativi: non consulta
 * `PATHEXT`, quindi un `bin` come `codex` installato via npm — che sul disco è
 * `codex.cmd` — restituisce `ENOENT` e il provider risulta `NOT_INSTALLED` anche
 * quando è installato e autenticato. Si risolve quindi il percorso concreto e, se
 * è uno script di comandi, lo si esegue tramite l'interprete batch.
 *
 * `shell: true` NON è un'opzione: reintrodurrebbe l'interpolazione di shell che la
 * spec §36 vieta, e il prompt utente passerebbe per un interprete di comandi.
 */
export interface ResolvedCommand {
  command: string
  /** Argomenti da premettere a quelli del chiamante. */
  prefixArgs: string[]
  /** `true` se si passa per l'interprete batch: allora gli argomenti vanno validati. */
  viaCmd: boolean
}

/** Estensioni che `spawn` può eseguire direttamente, senza interprete. */
const NATIVE_EXTENSIONS = new Set(['.exe', '.com'])

/** Script di comandi: eseguibili solo tramite `cmd.exe`. */
const BATCH_EXTENSIONS = new Set(['.cmd', '.bat'])

/**
 * `cmd.exe` ri-analizza questi caratteri **dopo** la quotatura di Node, quindi un
 * argomento che li contiene può uscire dal comando e farne eseguire un altro
 * (è la ragione per cui Node rifiuta di eseguire `.cmd` senza shell: CVE-2024-27980).
 *
 * In FantaBro nessun dato utente arriva in `argv` — il prompt viaggia su stdin e
 * gli altri argomenti sono flag letterali più un percorso temporaneo generato da
 * `mkdtemp`. Questo controllo trasforma quell'invariante in un errore rumoroso
 * invece di un commento: se un domani qualcuno passasse un prompt in `argv` su
 * Windows, otterrebbe un rifiuto e non una esecuzione arbitraria.
 */
const CMD_METACHARACTERS = /[&|<>^"%!]/

/**
 * Da chiamare solo sul ramo `cmd.exe`. Lancia se un argomento contiene un
 * metacarattere dell'interprete batch.
 */
export function assertSafeForBatch(bin: string, args: string[]): void {
  const unsafe = args.find((arg) => CMD_METACHARACTERS.test(arg))
  if (unsafe === undefined) return
  throw new AiProviderError(
    'PROCESS_FAILED',
    `${bin}: unsafe argument for the batch interpreter`,
    'Un argomento contiene un metacarattere di cmd.exe. Il prompt va su stdin, non in argv.'
  )
}

/**
 * Cerca `bin` nelle directory di `pathDirs` con le estensioni di `extensions`.
 * Pura e con le dipendenze iniettate, così è verificabile senza toccare
 * `process.platform` né il filesystem.
 */
export function resolveWindowsExecutable(
  bin: string,
  options: {
    pathDirs: string[]
    extensions: string[]
    comspec: string
    exists: (candidate: string) => boolean
  }
): ResolvedCommand {
  const viaCmd = (fullPath: string): ResolvedCommand => ({
    command: options.comspec,
    // `/d` disabilita gli AutoRun del registro, che altrimenti girerebbero prima
    // del nostro comando. `/c` esegue e esce.
    prefixArgs: ['/d', '/c', fullPath],
    viaCmd: true,
  })

  const classify = (fullPath: string): ResolvedCommand => {
    const ext = extname(fullPath).toLowerCase()
    if (BATCH_EXTENSIONS.has(ext)) return viaCmd(fullPath)
    return { command: fullPath, prefixArgs: [], viaCmd: false }
  }

  // Percorso già esplicito: niente da cercare, serve solo capire come lanciarlo.
  if (isAbsolute(bin) || bin.includes(sep) || bin.includes('/')) {
    return classify(bin)
  }

  // Se il nome porta già un'estensione eseguibile, non si prova ad aggiungerne altre.
  const declared = extname(bin).toLowerCase()
  const suffixes =
    NATIVE_EXTENSIONS.has(declared) || BATCH_EXTENSIONS.has(declared) ? [''] : options.extensions

  for (const dir of options.pathDirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, bin + suffix)
      if (options.exists(candidate)) return classify(candidate)
    }
  }

  // Non trovato: si lascia il nome nudo e `spawn` produrrà ENOENT, che i provider
  // traducono già in `NOT_INSTALLED`.
  return { command: bin, prefixArgs: [], viaCmd: false }
}

/** Su POSIX non serve nulla: gli shim npm sono file con shebang, già eseguibili. */
export function resolveCommand(bin: string): ResolvedCommand {
  if (process.platform !== 'win32') {
    return { command: bin, prefixArgs: [], viaCmd: false }
  }

  const rawPath = process.env.Path ?? process.env.PATH ?? ''
  const rawPathExt = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'

  return resolveWindowsExecutable(bin, {
    pathDirs: rawPath.split(delimiter).filter(Boolean),
    extensions: rawPathExt
      .split(';')
      .filter(Boolean)
      .map((ext) => ext.toLowerCase()),
    comspec: process.env.COMSPEC ?? 'cmd.exe',
    exists: existsSync,
  })
}

function killProcessTree(child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean }): void {
  // ponytail: su POSIX il figlio è capogruppo (`detached`), così il pid negativo
  // raggiunge anche i nipoti — le CLI AI lanciano sottoprocessi. Su Windows non
  // esistono i process group POSIX: si termina il solo figlio.
  if (child.pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      // Il gruppo non esiste più o non è segnalabile: si prova la via diretta.
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // Processo già terminato: niente da fare.
  }
}

function forceKillProcessTree(child: {
  pid?: number
  kill: (signal: NodeJS.Signals) => boolean
}): void {
  if (child.pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // Vedi sopra.
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Processo già terminato.
  }
}

/**
 * Esegue un comando senza shell e ne restituisce output e exit code.
 *
 * Non lancia per exit code diverso da zero: la classificazione dell'errore
 * dipende dal provider e vive in `cli.ts`. Lancia solo per condizioni
 * strutturali: eseguibile assente, timeout, output fuori scala.
 */
export async function runCommand(
  bin: string,
  args: string[],
  options: RunCommandOptions
): Promise<RunCommandResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const resolved = resolveCommand(bin)
  const spawnArgs = [...resolved.prefixArgs, ...args]

  // Vale solo per il ramo `cmd.exe`: lì gli argomenti vengono ri-analizzati
  // dall'interprete. Vedi `CMD_METACHARACTERS`.
  if (resolved.viaCmd) assertSafeForBatch(bin, args)

  return await new Promise<RunCommandResult>((resolve, reject) => {
    const child = spawn(resolved.command, spawnArgs, {
      cwd: options.cwd,
      env: buildEnv(options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Nessuna shell: l'unico modo di garantire che gli argomenti restino dati.
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
      // Si termina il processo prima di rispondere: nessun figlio orfano che
      // continua a consumare quota dopo che la richiesta è già fallita.
      killProcessTree(child)
      killTimer = setTimeout(() => forceKillProcessTree(child), KILL_GRACE_MS)
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
      if (stdout.length > maxOutputBytes) {
        abort(new AiProviderError('INVALID_OUTPUT', `${bin} produced too much output`))
      }
    })

    child.stderr.on('data', (chunk: string) => {
      // Si tiene solo la coda: stderr delle CLI contiene l'eco del prompt.
      stderr = (stderr + chunk).slice(-maxOutputBytes)
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish(() => reject(new AiProviderError('CLI_NOT_INSTALLED', `${bin} not found`)))
        return
      }
      if (error.code === 'EINVAL') {
        // Non dovrebbe più capitare: `resolveCommand` instrada gli script `.cmd`
        // attraverso `cmd.exe /d /c`. Se accade, il percorso risolto non è
        // eseguibile e il nome nudo non basta a diagnosticarlo.
        finish(() =>
          reject(
            new AiProviderError(
              'PROCESS_FAILED',
              `${bin} is not directly executable`,
              'Eseguibile risolto ma non avviabile senza shell: verificare PATH e PATHEXT.'
            )
          )
        )
        return
      }
      finish(() =>
        reject(
          new AiProviderError('PROCESS_FAILED', `${bin} failed to start`, sanitize(error.code))
        )
      )
    })

    child.on('close', (code) => {
      finish(() => resolve({ stdout, stderr, code }))
    })

    // Chiudere stdin è obbligatorio: senza EOF le CLI restano in attesa di input
    // e la richiesta finirebbe sempre in timeout.
    child.stdin.on('error', () => {
      // EPIPE se il processo è già uscito: l'esito arriva comunque da `close`.
    })
    child.stdin.end(options.input ?? '')
  })
}

/**
 * Verifica la presenza di un eseguibile senza shell.
 * `ENOENT` (e su Windows `EINVAL` sugli shim) significa "non utilizzabile".
 */
export async function commandExists(bin: string): Promise<boolean> {
  try {
    await runCommand(bin, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS })
    return true
  } catch (error) {
    if (error instanceof AiProviderError) return false
    return false
  }
}

/** Sostituto usato al posto di qualunque cosa somigli a una credenziale. */
const REDACTED = '[redacted]'

/**
 * Pattern di segreti da rimuovere prima che un testo finisca in un `detail`
 * o in un log (spec §45). Meglio una redazione in eccesso che un token in chiaro.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Token con prefisso noto: Anthropic/OpenAI (`sk-`, `sk-ant-`, `sess-`), GitHub.
  /\b(?:sk|sess|rk)-[A-Za-z0-9_-]{6,}/gi,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{6,}/gi,
  // Header di autorizzazione.
  /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // JWT.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
  // URL con credenziali inline: postgres://utente:password@host, https://user:pw@host
  /\b([a-z][a-z0-9+.-]*):\/\/[^\s:/@]+:[^\s/@]+@/gi,
  // Assegnazioni di variabili sensibili (anche in un eventuale dump di env).
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|CREDENTIALS)[A-Z0-9_]*\s*[=:]\s*\S+/g,
  // Percorsi dei file di autenticazione dei provider.
  /\S*(?:auth\.json|\.credentials\.json)\S*/gi,
]

/**
 * Ripulisce un testo destinato all'utente o ai log.
 * Applicato a *tutto* ciò che esce dal layer AI verso l'esterno.
 */
export function sanitize(text: string | undefined): string {
  if (!text) return ''
  let out = text
  for (const pattern of SECRET_PATTERNS) {
    // Le URL con credenziali conservano lo schema: `postgres://[redacted]@`.
    out = out.replace(pattern, (match, scheme?: string) =>
      typeof scheme === 'string' ? `${scheme}://${REDACTED}@` : REDACTED
    )
  }
  return out.trim()
}

/** Come `sanitize`, ma tronca: un `detail` è una diagnostica, non un log. */
export function sanitizeDetail(text: string | undefined, maxLength = 400): string | undefined {
  const clean = sanitize(text)
  if (!clean) return undefined
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean
}

/**
 * Esegue `fn` con una working directory temporanea **vuota**.
 *
 * Le CLI AI sono coding agent: puntarle alla root del progetto significherebbe
 * dargli in mano il codice e i file di configurazione (spec §43 lo vieta).
 * Una cartella vuota e usa-e-getta è il perimetro minimo.
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'fantabro-ai-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // La pulizia è best-effort: il sistema svuota comunque la cartella temp.
    })
  }
}
