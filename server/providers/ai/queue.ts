/**
 * Coda FIFO con concorrenza limitata (spec §44).
 *
 * Serve perché più utenti possono chiedere un consiglio quasi insieme mentre
 * l'asta è in corso, e le CLI AI condividono file di sessione sul disco del
 * server che non sono concurrency-safe: due invocazioni in parallelo possono
 * corrompersi a vicenda. Il default è quindi `concurrency = 1` per provider.
 *
 * La coda è un dettaglio del layer AI: non compare in nessuna firma del dominio
 * asta, che non sa nulla di attese o di slot occupati.
 */
import { AiProviderError } from '#shared/types/ai'

export interface TaskQueueOptions {
  /** Task eseguiti insieme. 1 per le CLI: la sessione su disco è condivisa. */
  concurrency: number
  /** Task in attesa oltre i quali si risponde `PROVIDER_BUSY` invece di accodare. */
  maxPending: number
  /** Timeout per richiesta, che copre **anche** il tempo passato in coda. */
  timeoutMs: number
}

export class TaskQueue {
  private active = 0

  /** Task in attesa, in ordine di arrivo. */
  private readonly waiting: Array<() => void> = []

  constructor(private readonly options: TaskQueueOptions) {}

  /** Osservabilità per i test e per un'eventuale diagnostica. */
  get stats(): { active: number; pending: number } {
    return { active: this.active, pending: this.waiting.length }
  }

  /**
   * Accoda `task` e ne restituisce il risultato.
   *
   * Ogni chiamata riceve la propria promise: il valore risolto è sempre quello
   * del task che l'ha originata, mai di un altro in coda. Non esiste stato
   * mutabile condiviso fra i task, quindi non c'è modo che il contesto di una
   * richiesta finisca nella risposta di un'altra.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    // Il limite conta solo chi dovrebbe davvero aspettare: con uno slot libero
    // la richiesta parte subito. Così `maxPending: 0` significa "non accodare
    // nulla, rifiuta quando è occupato" e non "rifiuta sempre".
    const wouldWait = this.active >= this.options.concurrency
    if (wouldWait && this.waiting.length >= this.options.maxPending) {
      throw new AiProviderError(
        'PROVIDER_BUSY',
        `AI queue is full (${this.options.maxPending} pending)`
      )
    }

    return await new Promise<T>((resolve, reject) => {
      // Un oggetto e non due `let`: il timer va creato dopo `start`, ma
      // `finish` deve poterlo azzerare, e così si evita il riferimento in avanti.
      const state: { settled: boolean; timer?: ReturnType<typeof setTimeout> } = {
        settled: false,
      }

      const finish = (action: () => void): void => {
        if (state.settled) return
        state.settled = true
        clearTimeout(state.timer)
        action()
      }

      const start = (): void => {
        this.active += 1
        void task()
          .then(
            (value) => finish(() => resolve(value)),
            (error: unknown) => finish(() => reject(error))
          )
          .finally(() => {
            this.active -= 1
            this.drain()
          })
      }

      state.timer = setTimeout(() => {
        // Ancora in attesa: lo si toglie dalla coda, non deve più partire.
        const index = this.waiting.indexOf(start)
        if (index >= 0) this.waiting.splice(index, 1)
        // Già in esecuzione: il chiamante riceve TIMEOUT subito, mentre lo slot
        // resta occupato fino a quando il processo figlio non è davvero morto.
        // Ucciderlo è responsabilità del timeout di `runCommand`.
        finish(() => reject(new AiProviderError('TIMEOUT', 'AI request timed out')))
      }, this.options.timeoutMs)

      this.waiting.push(start)
      this.drain()
    })
  }

  private drain(): void {
    while (this.active < this.options.concurrency && this.waiting.length > 0) {
      const next = this.waiting.shift()
      next?.()
    }
  }
}
