/**
 * OpenCodeProvider (spec §38).
 *
 * Usa l'autenticazione OpenCode già configurata sul server
 * (`opencode providers login`, storicamente `opencode auth login`), con config
 * persistente su volume. OpenCode può parlare con diversi provider upstream:
 * per FantaBro è un dettaglio interno di questo adapter.
 *
 * "Provider upstream non configurato" e "sessione mancante" sono la stessa
 * condizione osservabile — zero credenziali registrate — e producono entrambe
 * `NOT_AUTHENTICATED`. Nessun passaggio a una API key separata: le variabili
 * `*_API_KEY` non sono nella allowlist di `buildEnv`.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiProvider, AiProviderStatus, AiResponse, AuctionContext } from '#shared/types/ai'
import { cliStatus, runCliAsk } from './cli'

/**
 * Flag verificati sull'help di `opencode` 1.18.x (`opencode run --help`) e
 * provati end-to-end contro la CLI installata:
 *
 * - `run`      sottocomando non interattivo. Con stdin collegato legge il prompt
 *              da stdin: verificato, quindi il prompt non passa da `argv`.
 * - `--pure`   "run without external plugins": esclude i plugin dell'utente del
 *              server, che sono codice arbitrario che non vogliamo nel percorso.
 *
 * Deliberatamente NON si usa `--auto` ("auto-approve permissions that are not
 * explicitly denied (dangerous!)").
 *
 * ATTENZIONE, verificato contro la CLI installata (1.18.18): omettere `--auto`
 * NON basta. Senza terminale interattivo OpenCode esegue comunque gli strumenti,
 * shell inclusa: un prompt che chiede di eseguire `echo` ottiene l'esecuzione ed
 * exit 0. Nemmeno `permission.bash = "deny"` chiude il buco, perché il modello
 * delega a un subagente che la policy del primario non copre. L'unica barriera
 * che ha retto alla prova è spegnere gli strumenti in `tools`: vedi
 * `TOOLS_POLICY`. Il prompt d'asta è testo libero dell'utente, quindi questa non
 * è un'ipotesi remota ma la via di prompt-injection che spec §43 vieta.
 *
 * In `run` la risposta va su stdout pulito; il banner del modello va su stderr.
 */
const ASK_ARGS = ['run', '--pure'] as const

/**
 * Config scritta nella cwd temporanea a ogni invocazione (spec §43, §44).
 *
 * `tools` è un elenco chiuso: si spegne tutto ciò che tocca disco, shell o
 * delega, e resta acceso solo `webfetch`, che serve per i fatti che il listone
 * non ha (infortuni, squalifiche, formazioni). `task` è spento perché è la via
 * con cui il modello aggirava `permission`.
 *
 * `permission` resta come seconda barriera: se una versione futura di OpenCode
 * introducesse un nome di strumento non previsto qui, `tools` non lo
 * spegnerebbe, ma la policy di permesso lo intercetterebbe comunque.
 *
 * DA RIVERIFICARE all'aggiornamento della CLI OpenCode: sono nomi di strumenti,
 * e un rename li rende silenziosamente inefficaci.
 */
const TOOLS_POLICY = {
  $schema: 'https://opencode.ai/config.json',
  tools: {
    bash: false,
    edit: false,
    write: false,
    patch: false,
    read: false,
    grep: false,
    glob: false,
    list: false,
    task: false,
    todowrite: false,
    todoread: false,
    webfetch: true,
  },
  permission: {
    bash: 'deny',
    edit: 'deny',
    write: 'deny',
    webfetch: 'allow',
  },
} as const

/** Elenca le credenziali registrate senza invocare alcun modello. */
const AUTH_ARGS = ['providers', 'list'] as const

/**
 * Rimozione delle sequenze ANSI: OpenCode decora l'output anche con `NO_COLOR`.
 * Costruita da `fromCharCode` per non mettere un carattere di controllo in un
 * literal (che `no-control-regex` rifiuterebbe a ragione).
 */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')

/**
 * Coda dell'elenco. Entrambi gli esiti verificati contro la CLI installata (1.18.18):
 *   con credenziali -> `└  2 credentials`, exit 0
 *   senza           -> `└  0 credentials`, exit 0
 * Il riconoscimento è quindi su un **numero**, non sul testo di un messaggio: una
 * riscrittura del wording lo fa cadere nel ramo `ERROR`, non in un falso AVAILABLE.
 * DA RIVERIFICARE al primo deploy se si aggiorna la CLI OpenCode.
 */
const CREDENTIALS_COUNT_PATTERN = /(\d+)\s+credentials?\b/i

export interface OpenCodeProviderOptions {
  bin: string
  timeoutMs: number
}

export class OpenCodeProvider implements AiProvider {
  readonly id = 'opencode' as const

  constructor(private readonly options: OpenCodeProviderOptions) {}

  async getStatus(): Promise<AiProviderStatus> {
    return await cliStatus({
      providerId: this.id,
      bin: this.options.bin,
      installHintKey: 'ai.hint.notInstalled',
      loginHintKey: 'ai.hint.opencodeLogin',
      authArgs: [...AUTH_ARGS],
      interpret: (result) => {
        if (result.code !== 0) {
          return { state: 'NOT_AUTHENTICATED' }
        }
        const plain = result.stdout.replace(ANSI_PATTERN, '')
        const match = CREDENTIALS_COUNT_PATTERN.exec(plain)
        if (!match?.[1]) {
          // Formato non riconosciuto: non sappiamo se ci sia una sessione.
          return { state: 'ERROR', detail: 'unexpected providers list output' }
        }
        // Zero credenziali = nessun provider upstream collegato.
        return { state: Number(match[1]) > 0 ? 'AVAILABLE' : 'NOT_AUTHENTICATED' }
        // L'elenco stampa anche il path di `auth.json`: non entra mai in `detail`.
      },
    })
  }

  async ask(context: AuctionContext, prompt: string): Promise<AiResponse> {
    return await runCliAsk({
      providerId: this.id,
      bin: this.options.bin,
      buildArgs: () => [...ASK_ARGS],
      // OpenCode legge `opencode.json` dalla cwd: la policy vive e muore con la
      // cartella temporanea, senza toccare la configurazione del server.
      prepare: async (workdir) => {
        await writeFile(join(workdir, 'opencode.json'), JSON.stringify(TOOLS_POLICY), 'utf8')
      },
      context,
      prompt,
      timeoutMs: this.options.timeoutMs,
    })
  }
}
