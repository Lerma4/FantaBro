import { and, asc, eq } from 'drizzle-orm'
import type { ClassicRole, RosterPlayer } from '#shared/types'
import { players, rosterPlayers, rosters } from '../database/schema'
import type { DbOrTx } from '../utils/db'

/** Una rosa per asta (spec §19): se manca la crea. */
export async function getRosterId(db: DbOrTx, auctionId: string): Promise<string> {
  const [existing] = await db
    .select({ id: rosters.id })
    .from(rosters)
    .where(eq(rosters.auctionId, auctionId))
    .limit(1)
  if (existing) return existing.id

  const [created] = await db
    .insert(rosters)
    .values({ auctionId })
    .onConflictDoNothing()
    .returning({ id: rosters.id })
  if (created) return created.id

  // Un'altra transazione l'ha creata nel frattempo: `auction_id` è unique.
  const [row] = await db
    .select({ id: rosters.id })
    .from(rosters)
    .where(eq(rosters.auctionId, auctionId))
    .limit(1)
  if (!row) throw new Error(`getRosterId: rosa non creabile per l'asta ${auctionId}`)
  return row.id
}

/**
 * L'unique `(roster_id, player_id)` fa fallire il secondo acquisto dello stesso
 * giocatore: è la garanzia lato database contro la doppia scrittura (spec §48).
 */
export async function addRosterPlayer(
  db: DbOrTx,
  rosterId: string,
  playerId: string,
  price: number
): Promise<RosterPlayer> {
  const [row] = await db
    .insert(rosterPlayers)
    .values({ rosterId, playerId, purchasePrice: price })
    .returning()
  if (!row) throw new Error('addRosterPlayer: insert senza riga restituita')
  return row
}

export async function removeRosterPlayer(
  db: DbOrTx,
  rosterId: string,
  playerId: string
): Promise<void> {
  await db
    .delete(rosterPlayers)
    .where(and(eq(rosterPlayers.rosterId, rosterId), eq(rosterPlayers.playerId, playerId)))
}

export async function listRoster(
  db: DbOrTx,
  auctionId: string
): Promise<
  {
    playerId: string
    name: string
    role: ClassicRole
    team: string
    purchasePrice: number
    purchasedAt: Date
  }[]
> {
  return db
    .select({
      playerId: rosterPlayers.playerId,
      name: players.name,
      role: players.role,
      team: players.team,
      purchasePrice: rosterPlayers.purchasePrice,
      purchasedAt: rosterPlayers.purchasedAt,
    })
    .from(rosterPlayers)
    .innerJoin(rosters, eq(rosters.id, rosterPlayers.rosterId))
    .innerJoin(players, eq(players.id, rosterPlayers.playerId))
    .where(eq(rosters.auctionId, auctionId))
    .orderBy(asc(players.role), asc(players.name))
}
