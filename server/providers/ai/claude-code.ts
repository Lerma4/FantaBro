/**
 * ClaudeCodeProvider (spec §36).
 *
 * Usa la CLI `claude` **già autenticata sul server** con la propria
 * sessione/abbonamento. Non serve una API key Anthropic e non esiste alcun
 * fallback su `ANTHROPIC_API_KEY`: la variabile non è nemmeno nella allowlist
 * di `buildEnv`, quindi il processo figlio non la vede (spec §34).
 */
import type { AiProvider, AiProviderStatus, AiResponse, AuctionContext } from '#shared/types/ai'
import { cliStatus, runCliAsk } from './cli'

/**
 * Flag di invocazione non interattiva, verificati sull'help di `claude` 2.1.x
 * (`claude --help`) e provati end-to-end contro la CLI installata:
 *
 * - `--print`                  modalità headless: stampa la risposta ed esce.
 * - `--output-format text`     solo testo su stdout, niente JSONL da spacchettare.
 * - `--tools ''`               l'help documenta `""` come "disable all tools":
 *                              è la disattivazione esplicita di Bash/Edit/Read,
 *                              cioè di tutto ciò che spec §43 vieta.
 * - `--permission-mode manual` nessuna azione auto-approvata, cintura oltre alle
 *                              bretelle di `--tools ''`.
 * - `--safe-mode`              ignora CLAUDE.md, skill, plugin, hook e server MCP
 *                              dell'utente del server: l'help garantisce che
 *                              l'autenticazione continua a funzionare normalmente,
 *                              quindi isola l'ambiente senza toccare la sessione.
 * - `--strict-mcp-config`      senza `--mcp-config` equivale a "nessun MCP".
 * - `--no-session-persistence` non scrive file di sessione su disco: le richieste
 *                              restano stateless e non c'è stato condiviso da
 *                              corrompere fra invocazioni concorrenti (spec §44).
 *
 * Deliberatamente NON si usa `--bare`: l'help dice che con quel flag
 * "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper (OAuth and
 * keychain are never read)", cioè esattamente la fatturazione a consumo che la
 * specifica vieta.
 */
const ASK_ARGS = [
  '--print',
  '--output-format',
  'text',
  '--tools',
  '',
  '--permission-mode',
  'manual',
  '--safe-mode',
  '--strict-mcp-config',
  '--no-session-persistence',
] as const

/**
 * `claude auth status --json` non invoca il modello. Entrambi gli esiti sono stati
 * verificati contro la CLI installata (2.1.235):
 *   sessione attiva  -> `{"loggedIn":true,"authMethod":"claude.ai",...}`, exit 0
 *   nessuna sessione -> `{"loggedIn":false,"authMethod":"none",...}`, exit 0
 * Il riconoscimento è su un **campo booleano JSON**, non su una stringa di
 * messaggio: è la forma più robusta fra i tre provider.
 */
const AUTH_ARGS = ['auth', 'status', '--json'] as const

export interface ClaudeCodeProviderOptions {
  bin: string
  timeoutMs: number
}

export class ClaudeCodeProvider implements AiProvider {
  readonly id = 'claude-code' as const

  constructor(private readonly options: ClaudeCodeProviderOptions) {}

  async getStatus(): Promise<AiProviderStatus> {
    return await cliStatus({
      providerId: this.id,
      bin: this.options.bin,
      installHintKey: 'ai.hint.notInstalled',
      loginHintKey: 'ai.hint.claudeCodeLogin',
      authArgs: [...AUTH_ARGS],
      interpret: (result) => {
        if (result.code !== 0) {
          // Exit code diverso da zero su `auth status`: nessuna sessione valida.
          return { state: 'NOT_AUTHENTICATED' }
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(result.stdout)
        } catch {
          return { state: 'ERROR', detail: 'unexpected auth status output' }
        }
        const loggedIn = (parsed as { loggedIn?: unknown } | null)?.loggedIn
        if (loggedIn === true) return { state: 'AVAILABLE' }
        if (loggedIn === false) return { state: 'NOT_AUTHENTICATED' }
        return { state: 'ERROR', detail: 'unexpected auth status output' }
        // Nota: `auth status` riporta anche email e organizzazione del server.
        // Non finiscono mai in `detail`: l'identità dell'account non è
        // informazione per gli utenti di FantaBro (spec §40).
      },
    })
  }

  async ask(context: AuctionContext, prompt: string): Promise<AiResponse> {
    return await runCliAsk({
      providerId: this.id,
      bin: this.options.bin,
      // La working directory è una cartella temporanea vuota creata da
      // `runCliAsk`: la CLI non vede il progetto (spec §43).
      buildArgs: () => [...ASK_ARGS],
      context,
      prompt,
      timeoutMs: this.options.timeoutMs,
    })
  }
}
