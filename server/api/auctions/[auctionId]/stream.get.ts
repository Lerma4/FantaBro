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
 */
export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'VIEWER')

  const stream = createEventStream(event)

  /**
   * L'asta si rilegge a ogni notifica: budget, costo minimo e slot possono essere cambiati
   * dopo l'apertura dello stream, e lo stato derivato dipende da quelle regole.
   *
   * ponytail: due query per notifica e per connessione. Con le decine di connessioni di
   * un'asta e piu semplice che tenere una cache da invalidare a mano.
   */
  async function pushChange(payload: AuctionChangePayload): Promise<void> {
    const auction = await findAuctionById(db, auctionId)
    if (!auction) return

    const state = await loadAuctionState(db, auction)
    await stream.push({
      event: 'auction:changed',
      data: JSON.stringify({
        state,
        playerIds: payload.playerIds,
        eventId: payload.eventId ?? null,
      }),
    })
  }

  const unsubscribe = subscribeToAuction(auctionId, (payload) => {
    // Una connessione chiusa a meta invio non deve diventare un errore non gestito.
    void pushChange(payload).catch(() => {})
  })

  // h3 non sa scrivere un commento SSE: un evento `ping` tiene viva la connessione
  // ed e ignorato dai client che ascoltano solo `auction:changed`.
  const keepAlive = setInterval(() => {
    void stream.push({ event: 'ping', data: String(Date.now()) }).catch(() => {})
  }, KEEP_ALIVE_MS)

  stream.onClosed(() => {
    clearInterval(keepAlive)
    unsubscribe()
  })

  return stream.send()
})
