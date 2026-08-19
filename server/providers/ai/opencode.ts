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
 * explicitly denied (dangerous!)"): senza quel flag, e senza un terminale
 * interattivo, un eventuale tentativo di usare strumenti non viene approvato
 * (spec §43). Il perimetro è completato dalla working directory temporanea
 * vuota impostata come cwd da `runCliAsk`.
 *
 * In `run` la risposta va su stdout pulito; il banner del modello va su stderr.
 */
const ASK_ARGS = ['run', '--pure'] as const

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
      context,
      prompt,
      timeoutMs: this.options.timeoutMs,
    })
  }
}
