import { asc, eq, sql } from 'drizzle-orm'
import type { ClassicRole, PlayerTarget } from '#shared/types'
import { playerTargets, players } from '../database/schema'
import type { DbOrTx } from '../utils/db'

/**
 * Patch parziale: solo i campi presenti vengono scritti, così aggiornare il
 * `tier` non azzera le note o il prezzo massimo.
 */
export async function upsertTarget(
  db: DbOrTx,
  auctionId: string,
  playerId: string,
  patch: Partial<PlayerTarget>
): Promise<PlayerTarget> {
  const assigned = {
    ...(patch.tier !== undefined ? { tier: patch.tier } : {}),
    ...(patch.targetPrice !== undefined ? { targetPrice: patch.targetPrice } : {}),
    ...(patch.maxPrice !== undefined ? { maxPrice: patch.maxPrice } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.isTarget !== undefined ? { isTarget: patch.isTarget } : {}),
  }
  const updatedAt = new Date()

  const [row] = await db
    .insert(playerTargets)
    .values({ auctionId, playerId, ...assigned, updatedAt })
    .onConflictDoUpdate({
      target: [playerTargets.auctionId, playerTargets.playerId],
      set: { ...assigned, updatedAt },
    })
    .returning()
  if (!row) throw new Error('upsertTarget: upsert senza riga restituita')
  return row
}

export async function listTargets(
  db: DbOrTx,
  auctionId: string
): Promise<(PlayerTarget & { name: string; role: ClassicRole })[]> {
  return db
    .select({
      auctionId: playerTargets.auctionId,
      playerId: playerTargets.playerId,
      tier: playerTargets.tier,
      targetPrice: playerTargets.targetPrice,
      maxPrice: playerTargets.maxPrice,
      priority: playerTargets.priority,
      notes: playerTargets.notes,
      isTarget: playerTargets.isTarget,
      updatedAt: playerTargets.updatedAt,
      name: players.name,
      role: players.role,
    })
    .from(playerTargets)
    .innerJoin(players, eq(players.id, playerTargets.playerId))
    .where(eq(playerTargets.auctionId, auctionId))
    .orderBy(sql`${playerTargets.priority} asc nulls last`, asc(players.name))
}
