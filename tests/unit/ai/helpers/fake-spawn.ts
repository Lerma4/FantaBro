/**
 * Doppio di `node:child_process.spawn` per i test dei provider AI.
 *
 * Nessuna CLI reale viene mai invocata: i test devono girare senza `claude`,
 * `codex` o `opencode` installati, senza rete e senza consumare quota.
 *
 * Il modulo esporta un'istanza singola perché il mock di `vi.mock` e il test
 * devono vedere lo stesso stato. Vitest isola il registry dei moduli per file,
 * quindi ogni spec ha comunque la propria istanza.
 */
import { EventEmitter } from 'node:events'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { vi } from 'vitest'

/** Comportamento programmato per la prossima `spawn`. */
export interface SpawnScript {
  stdout?: string
  stderr?: string
  code?: number | null
  /** Codice di errore di avvio, es. `ENOENT` per "eseguibile assente". */
  errorCode?: string
  /** Non termina mai: serve a provocare il timeout. */
  hang?: boolean
  /** Ritardo prima della chiusura, per verificare la serializzazione. */
  delayMs?: number
}

/** Cosa è stato realmente chiesto al sistema operativo. */
export interface SpawnCall {
  bin: string
  /** Argomenti effettivi, prefisso di risoluzione incluso. */
  args: string[]
  /**
   * Argomenti del provider, senza il prefisso `cmd.exe /d /c <percorso>` che su
   * Windows `resolveCommand` aggiunge per gli shim `.cmd`. È questo che va
   * asserito quando il test parla dei flag della CLI: altrimenti l'asserzione
   * passerebbe su Linux e fallirebbe su Windows.
   */
  appArgs: string[]
  cwd?: string
  env: Record<string, string>
  shell: boolean
  /** Quello che è stato scritto su stdin del processo. */
  stdin: string
  /**
   * File presenti nella cwd nell'istante della `spawn`, per nome e contenuto.
   * Si leggono qui perché la cartella temporanea viene cancellata appena il
   * comando termina: dopo, un test non troverebbe piu nulla da verificare.
   */
  cwdFiles: Record<string, string>
}

/** Istantanea della cwd: best-effort, una cartella assente non e un errore del test. */
function readCwdFiles(cwd?: string): Record<string, string> {
  if (!cwd) return {}
  try {
    return Object.fromEntries(
      readdirSync(cwd, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => [entry.name, readFileSync(join(cwd, entry.name), 'utf8')])
    )
  } catch {
    return {}
  }
}

/** Rimuove il prefisso dell'interprete batch, se presente. */
function stripBatchPrefix(args: string[]): string[] {
  return args[0] === '/d' && args[1] === '/c' ? args.slice(3) : args
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new PassThrough()

  /**
   * Volutamente `undefined`: così `runCommand` termina il processo con
   * `child.kill()` invece di `process.kill(-pid)`, e un test non può mai
   * segnalare per sbaglio un process group reale della macchina che lo esegue.
   */
  readonly pid: number | undefined = undefined

  readonly kill = vi.fn((_signal?: NodeJS.Signals) => true)
}

interface SpawnOptions {
  cwd?: string
  env?: Record<string, string>
  shell?: boolean
}

function createFakeSpawn() {
  const scripts: SpawnScript[] = []
  const calls: SpawnCall[] = []
  const children: FakeChild[] = []

  const spawn = vi.fn((bin: string, args: string[], options: SpawnOptions) => {
    // Senza script si assume un successo silenzioso: comodo per i probe
    // `--version` che precedono il comando davvero sotto test.
    const script = scripts.shift() ?? { code: 0, stdout: '' }
    const child = new FakeChild()
    children.push(child)

    const call: SpawnCall = {
      bin,
      args,
      appArgs: stripBatchPrefix(args),
      cwd: options.cwd,
      env: options.env ?? {},
      shell: options.shell ?? false,
      stdin: '',
      cwdFiles: readCwdFiles(options.cwd),
    }
    calls.push(call)
    child.stdin.on('data', (chunk: Buffer | string) => {
      call.stdin += String(chunk)
    })

    setImmediate(() => {
      if (script.errorCode) {
        const error: NodeJS.ErrnoException = new Error(`spawn ${script.errorCode}`)
        error.code = script.errorCode
        child.emit('error', error)
        return
      }
      if (script.hang) return

      const emit = (): void => {
        if (script.stdout) child.stdout.write(script.stdout)
        if (script.stderr) child.stderr.write(script.stderr)
        // `close` solo dopo che i dati sono stati consegnati ai listener,
        // come fa Node: altrimenti il test perderebbe stdout.
        setImmediate(() => setImmediate(() => child.emit('close', script.code ?? 0)))
      }

      if (script.delayMs) setTimeout(emit, script.delayMs)
      else emit()
    })

    return child
  })

  return {
    spawn,
    calls,
    children,
    /** Programma le prossime `spawn`, in ordine. */
    queue(...next: SpawnScript[]): void {
      scripts.push(...next)
    },
    reset(): void {
      scripts.length = 0
      calls.length = 0
      children.length = 0
      spawn.mockClear()
    },
    /** L'ultima invocazione registrata. */
    last(): SpawnCall {
      const call = calls.at(-1)
      if (!call) throw new Error('nessuna spawn registrata')
      return call
    },
  }
}

export const fakeSpawn = createFakeSpawn()
