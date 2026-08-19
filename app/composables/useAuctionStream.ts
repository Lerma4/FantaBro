import type { AuctionState } from '#shared/types'

interface AuctionChanged {
  state: AuctionState
  /**
   * Giocatori toccati. **Array vuoto = ricarica tutto**: il server lo usa dopo un
   * import o un cambio impostazioni, quando la lista non starebbe nel payload di
   * `NOTIFY`. Non significa mai "niente da fare".
   */
  playerIds: string[]
  eventId: string | null
}

/**
 * Realtime (spec 47): SSE con riconnessione automatica e caduta su polling
 * quando lo stream non parte. Nessun refresh manuale della pagina.
 *
 * Si ascolta `auction:changed` con `addEventListener` perche l'evento e
 * tipizzato: un `onmessage` non lo riceverebbe. Il keep-alive del server e un
 * commento SSE, che `EventSource` scarta da solo senza generare eventi.
 *
 * All'apertura il server manda subito lo stato corrente come `auction:changed`
 * con `playerIds: []`, quindi non serve una `GET /state` per allinearsi.
 *
 * ponytail: quel primo evento fa rifare la fetch delle righe che la pagina ha
 * gia fatto al mount. Una richiesta in piu al caricamento, tenuta di proposito:
 * chiude la finestra fra mount e apertura dello stream, in cui una modifica di
 * un altro utente non sarebbe visibile fino al cambio successivo.
 */
export function useAuctionStream(auctionId: string, onChanged: (payload: AuctionChanged) => void) {
  const store = useAuctionStore()

  let source: EventSource | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let attempts = 0
  let stopped = false

  function startPolling() {
    if (poll) return
    poll = setInterval(() => {
      void store.refreshState().then(
        () => {
          if (store.state) onChanged({ state: store.state, playerIds: [], eventId: null })
        },
        () => undefined
      )
    }, 15_000)
  }

  function stopPolling() {
    if (poll) clearInterval(poll)
    poll = undefined
  }

  function connect() {
    if (stopped) return
    source = new EventSource(`/api/auctions/${auctionId}/stream`)

    source.addEventListener('open', () => {
      attempts = 0
      stopPolling()
    })

    source.addEventListener('auction:changed', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as AuctionChanged
        if (payload.state) store.applyServerState(payload.state)
        onChanged(payload)
      } catch {
        // Messaggio illeggibile: lo stato vero arriva col prossimo evento o dal polling.
      }
    })

    source.addEventListener('error', () => {
      source?.close()
      source = undefined
      if (stopped) return
      attempts += 1
      // Dopo due tentativi falliti si passa al polling: l'asta non aspetta.
      if (attempts >= 2) startPolling()
      retry = setTimeout(connect, Math.min(1000 * attempts, 10_000))
    })
  }

  onMounted(connect)

  onScopeDispose(() => {
    stopped = true
    if (retry) clearTimeout(retry)
    stopPolling()
    source?.close()
  })
}
