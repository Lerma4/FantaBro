import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AuctionPlayer, AuctionPlayerStatus, ClassicRole } from '#shared/types'
import { auctionPlayers, playerTargets, players, rosterPlayers, rosters } from '../database/schema'
import type { DbOrTx } from '../utils/db'

/** Crea le righe di stato mancanti (AVAILABLE). Idempotente. */
export async function ensureAuctionPlayers(
  db: DbOrTx,
  auctionId: string,
  playerIds: string[]
): Promise<void> {
  if (playerIds.length === 0) return
  await db
    .insert(auctionPlayers)
    .values(playerIds.map((playerId) => ({ auctionId, playerId })))
    .onConflictDoNothing()
}

/**
 * Prende il lock di riga sullo stato del giocatore (spec §48).
 * **Va chiamata dentro una transazione**, altrimenti il `FOR UPDATE` viene
 * rilasciato subito e non serializza nulla.
 *
 * Se la riga di stato non esiste ancora viene creata: la sub-select su `players`
 * evita di violare la foreign key con un id inesistente, e in quel caso la
 * funzione restituisce `null` (giocatore non trovato).
 */
export async function lockAuctionPlayer(
  db: DbOrTx,
  auctionId: string,
  playerId: string
): Promise<AuctionPlayer | null> {
  await db.execute(sql`
    insert into ${auctionPlayers} (auction_id, player_id)
    select ${auctionId}::uuid, ${players.id} from ${players} where ${players.id} = ${playerId}::uuid
    on conflict do nothing
  `)

  const [row] = await db
    .select()
    .from(auctionPlayers)
    .where(and(eq(auctionPlayers.auctionId, auctionId), eq(auctionPlayers.playerId, playerId)))
    .limit(1)
    .for('update')
  return row ?? null
}

export async function setStatus(
  db: DbOrTx,
  auctionId: string,
  playerId: string,
  patch: {
    status: AuctionPlayerStatus
    soldPrice?: number | null
    otherTeamName?: string | null
    updatedBy: string | null
  }
): Promise<AuctionPlayer> {
  // `soldPrice`/`otherTeamName` tornano a null quando non vengono passati:
  // annullare una vendita deve ripulire i metadati, non lasciarli appesi.
  const next = {
    status: patch.status,
    soldPrice: patch.soldPrice ?? null,
    otherTeamName: patch.otherTeamName ?? null,
    updatedBy: patch.updatedBy,
    updatedAt: new Date(),
  }

  const [row] = await db
    .insert(auctionPlayers)
    .values({ auctionId, playerId, ...next })
    .onConflictDoUpdate({
      target: [auctionPlayers.auctionId, auctionPlayers.playerId],
      set: next,
    })
    .returning()
  if (!row) throw new Error('setStatus: upsert senza riga restituita')
  return row
}

/** Fatti d'acquisto per il motore di budget/slot: la fonte è la rosa. */
export async function listPurchaseFacts(
  db: DbOrTx,
  auctionId: string
): Promise<{ playerId: string; role: ClassicRole; price: number }[]> {
  return db
    .select({
      playerId: rosterPlayers.playerId,
      role: players.role,
      price: rosterPlayers.purchasePrice,
    })
    .from(rosterPlayers)
    .innerJoin(rosters, eq(rosters.id, rosterPlayers.rosterId))
    .innerJoin(players, eq(players.id, rosterPlayers.playerId))
    .where(eq(rosters.auctionId, auctionId))
}

/**
 * Giocatori usciti dal mercato, miei o di altri, per le analytics (spec §31:
 * "only use actual recorded auction prices"). Anche i miei acquisti sono prezzi
 * reali della stessa asta: escluderli falserebbe le medie proprio a inizio asta.
 *
 * Il prezzo viene da tabelle diverse: `auction_players.sold_price` per i SOLD
 * (può essere `null`, e resta `null` — il dominio le conta in `soldWithoutPrice`
 * e non le media), `roster_players.purchase_price` per i miei.
 */
export async function listSoldFacts(
  db: DbOrTx,
  auctionId: string
): Promise<
  {
    playerId: string
    role: ClassicRole
    fvm: number
    soldPrice: number | null
    tier: string | null
  }[]
> {
  return db
    .select({
      playerId: auctionPlayers.playerId,
      role: players.role,
      fvm: players.fvm,
      // `case` e non `coalesce`: per un mio giocatore la fonte autorevole è la
      // rosa, anche se una riga avesse un `sold_price` rimasto appeso.
      soldPrice: sql<number | null>`case when ${auctionPlayers.status} = 'MY_PLAYER'
        then ${rosterPlayers.purchasePrice} else ${auctionPlayers.soldPrice} end`,
      tier: playerTargets.tier,
    })
    .from(auctionPlayers)
    .innerJoin(players, eq(players.id, auctionPlayers.playerId))
    .leftJoin(
      playerTargets,
      and(
        eq(playerTargets.auctionId, auctionPlayers.auctionId),
        eq(playerTargets.playerId, auctionPlayers.playerId)
      )
    )
    .leftJoin(rosters, eq(rosters.auctionId, auctionId))
    .leftJoin(
      rosterPlayers,
      and(
        eq(rosterPlayers.rosterId, rosters.id),
        eq(rosterPlayers.playerId, auctionPlayers.playerId)
      )
    )
    .where(
      and(
        eq(auctionPlayers.auctionId, auctionId),
        inArray(auctionPlayers.status, ['SOLD', 'MY_PLAYER'])
      )
    )
}
