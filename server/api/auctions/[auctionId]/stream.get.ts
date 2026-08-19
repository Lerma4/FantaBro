import { findAuctionById } from '../../../repositories/auctions'
import { loadAuctionState } from '../../../services/auctionState'
import { db } from '../../../utils/db'
import { defineApiHandler } from '../../../utils/errors'
import type { AuctionChangePayload } from '../../../utils/events'
import { requireAuctionAccess } from '../../../utils/guards'
import { subscribeToAuction } from '../../../utils/sse'
import { getUuidParam } from '../../../utils/validate'

/** Sotto i timeout di inattivita tipici di proxy e ingress. */
const KEEP_ALIVE_MS = 25_000

/**
 * Stream degli aggiornamenti d'asta (spec 47). Ogni notifica porta lo stato ricalcolato e
 * i giocatori toccati, cosi il client aggiorna le righe senza ricaricare la pagina.
 *
 * Scrive sulla risposta Node invece di usare `createEventStream` di h3: quella classe
 * (dichiarata `@experimental`) accumula le scritture e le consegna solo al keep-alive
 * successivo, cioe fino a 25 secondi di ritardo su ogni aggiornamento. Misurato in
 * `tests/e2e`, che ora inchioda la latenza.
 */
export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'VIEWER')

  const { req, res } = event.node

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // nginx (e l'Ingress) bufferizzano le risposte proxate: senza questo header lo stream
    // arriverebbe a blocchi anche scrivendo subito.
    'x-accel-buffering': 'no',
  })
  res.flushHeaders()

  function write(chunk: string): void {
    if (!res.writableEnded) res.write(chunk)
  }

  /**
   * L'asta si rilegge a ogni notifica: budget, costo minimo e slot possono essere cambiati
   * dopo l'apertura dello stream, e lo stato derivato dipende da quelle regole.
   *
   * ponytail: due query per notifica e per connessione. Con le decine di connessioni di
   * un'asta e piu semplice che tenere una cache da invalidare a mano.
   */
  async function pushChange(payload: Omit<AuctionChangePayload, 'auctionId'>): Promise<void> {
    const auction = await findAuctionById(db, auctionId)
    if (!auction) return

    const state = await loadAuctionState(db, auction)
    write(
      `event: auction:changed\ndata: ${JSON.stringify({
        state,
        playerIds: payload.playerIds,
        eventId: payload.eventId ?? null,
      })}\n\n`
    )
  }

  // Stato iniziale appena connessi: chi apre lo stream non deve chiedere `/state` a parte,
  // e la scrittura fa uscire subito le intestazioni.
  await pushChange({ playerIds: [] })

  const unsubscribe = subscribeToAuction(auctionId, (payload) => {
    // Una connessione chiusa a meta invio non deve diventare un errore non gestito.
    void pushChange(payload).catch(() => {})
  })

  // Commento SSE: tiene viva la connessione senza inventare un tipo di evento che il
  // client debba conoscere.
  const keepAlive = setInterval(() => write(`: keep-alive\n\n`), KEEP_ALIVE_MS)

  // La risposta resta aperta finche il client non chiude: nessun handler sopravvive.
  await new Promise<void>((resolve) => {
    req.on('close', () => {
      clearInterval(keepAlive)
      unsubscribe()
      resolve()
    })
  })
})
