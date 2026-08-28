import { desc, eq, sql } from 'drizzle-orm'
import type { CreateAuctionInput, UpdateAuctionInput } from '#shared/schemas'
import type { Auction, AuctionSummary } from '#shared/types'
import { auctionMembers, auctions, players, rosters } from '../database/schema'
import type { DbOrTx } from '../utils/db'

export async function findAuctionById(db: DbOrTx, auctionId: string): Promise<Auction | null> {
  const [row] = await db.select().from(auctions).where(eq(auctions.id, auctionId)).limit(1)
  return row ?? null
}

/**
 * `SELECT ... FOR UPDATE` sulla riga d'asta: serializza le operazioni che toccano
 * l'invariante budget/slot (acquisto, annullo, modifica delle regole).
 *
 * Il lock su `auction_players` non basta: due acquisti di giocatori **diversi**
 * prendono righe diverse e possono superare entrambi il controllo di budget.
 * La riga d'asta esiste sempre, quindi qui il lock morde davvero senza bisogno
 * dell'insert preventivo che serve in `lockAuctionPlayer`.
 *
 * `no key update` e non `update`: misurato, un `FOR UPDATE` sulla riga d'asta
 * blocca **ogni** insert che la referenzia (la verifica di FK prende
 * `FOR KEY SHARE`, che con `FOR UPDATE` è in conflitto), quindi bloccherebbe un
 * evento o un target su un altro giocatore per tutta la durata dell'acquisto.
 * `FOR NO KEY UPDATE` non tocca le chiavi, resta in conflitto con se stesso e
 * con gli UPDATE della riga, e quindi serializza acquisti/annulli/PATCH senza
 * quel danno collaterale.
 *
 * Va chiamata dentro una transazione, altrimenti il lock è rilasciato subito.
 */
export async function lockAuction(db: DbOrTx, auctionId: string): Promise<Auction | null> {
  const [row] = await db
    .select()
    .from(auctions)
    .where(eq(auctions.id, auctionId))
    .limit(1)
    .for('no key update')
  return row ?? null
}

/**
 * `playersCount` è la dimensione del **listone** della stagione dell'asta, lo
 * stesso numero di `countPlayersForSeason`: lista aste e dettaglio devono
 * mostrare la stessa cifra sulla stessa asta.
 */
export async function listAuctionsForUser(db: DbOrTx, userId: string): Promise<AuctionSummary[]> {
  return db
    .select({
      id: auctions.id,
      name: auctions.name,
      season: auctions.season,
      mode: auctions.mode,
      initialBudget: auctions.initialBudget,
      minimumPlayerCost: auctions.minimumPlayerCost,
      roleSlots: auctions.roleSlots,
      roleBudgets: auctions.roleBudgets,
      memberRole: auctionMembers.role,
      playersCount: sql<number>`(
        select count(*) from ${players} where ${players.season} = ${auctions.season}
      )`.mapWith(Number),
    })
    .from(auctions)
    .innerJoin(auctionMembers, eq(auctionMembers.auctionId, auctions.id))
    .where(eq(auctionMembers.userId, userId))
    .orderBy(desc(auctions.createdAt))
}

/**
 * Aste che condividono un listone. Il listone è per stagione, non per asta:
 * chi lo modifica deve notificare tutte le aste che lo stanno guardando.
 */
export async function listAuctionIdsForSeason(db: DbOrTx, season: string): Promise<string[]> {
  const rows = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(eq(auctions.season, season))
  return rows.map((row) => row.id)
}

/**
 * Crea l'asta insieme alla sua rosa (spec §19: una rosa per asta) e alla
 * membership OWNER del creatore, così l'invariante non dipende dal chiamante.
 */
export async function createAuction(
  db: DbOrTx,
  input: CreateAuctionInput & { createdBy: string }
): Promise<Auction> {
  const [auction] = await db
    .insert(auctions)
    .values({
      name: input.name,
      season: input.season,
      mode: input.mode,
      initialBudget: input.initialBudget,
      minimumPlayerCost: input.minimumPlayerCost,
      roleSlots: input.roleSlots,
      roleBudgets: input.roleBudgets ?? null,
      createdBy: input.createdBy,
    })
    .returning()
  if (!auction) throw new Error('createAuction: insert senza riga restituita')

  await db.insert(rosters).values({ auctionId: auction.id }).onConflictDoNothing()
  await db
    .insert(auctionMembers)
    .values({ auctionId: auction.id, userId: input.createdBy, role: 'OWNER' })
    .onConflictDoNothing()

  return auction
}

export async function updateAuction(
  db: DbOrTx,
  auctionId: string,
  input: UpdateAuctionInput
): Promise<Auction> {
  const [row] = await db
    .update(auctions)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(auctions.id, auctionId))
    .returning()
  if (!row) throw new Error(`updateAuction: asta ${auctionId} inesistente`)
  return row
}
