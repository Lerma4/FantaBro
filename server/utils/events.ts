import { sql } from 'drizzle-orm'
import type { DbOrTx } from './db'

/** Canale `NOTIFY` unico per tutte le aste: il filtro per asta lo fa il listener. */
export const AUCTION_CHANNEL = 'fantabro_auction'

export interface AuctionChangePayload {
  auctionId: string
  /**
   * Giocatori toccati. **Vuoto = "ricarica tutto"**: e la convenzione che il frontend deve
   * rispettare, e la usano import del listone, import statistiche e modifica delle regole
   * d'asta, cioe i casi in cui elencare le righe cambiate sforerebbe gli 8000 byte di NOTIFY.
   */
  playerIds: string[]
  eventId?: string
}

/**
 * Notifica un cambiamento d'asta **dentro la transazione chiamante**: se il COMMIT non
 * arriva la NOTIFY non esce, quindi non esistono notifiche di operazioni fallite (spec 48).
 *
 * Il payload resta minimo perche `NOTIFY` ha un limite di 8000 byte: lo stato completo lo
 * ricalcola il listener, che ha accesso al database.
 */
export async function publishAuctionChange(
  db: DbOrTx,
  auctionId: string,
  change: { playerIds: string[]; eventId?: string }
): Promise<void> {
  const payload: AuctionChangePayload = {
    auctionId,
    playerIds: change.playerIds,
    ...(change.eventId ? { eventId: change.eventId } : {}),
  }
  await db.execute(sql`select pg_notify(${AUCTION_CHANNEL}, ${JSON.stringify(payload)})`)
}
