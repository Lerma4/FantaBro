import { and, count, desc, eq } from 'drizzle-orm'
import type { AuctionEvent, AuctionEventRow, AuctionEventType } from '#shared/types'
import { auctionEvents, players, users } from '../database/schema'
import type { DbOrTx } from '../utils/db'

export async function appendEvent(
  db: DbOrTx,
  input: {
    auctionId: string
    actorUserId: string | null
    playerId: string | null
    type: AuctionEventType
    payload: Record<string, unknown>
  }
): Promise<AuctionEvent> {
  const [row] = await db.insert(auctionEvents).values(input).returning()
  if (!row) throw new Error('appendEvent: insert senza riga restituita')
  return row
}

/** L'`auctionId` fa parte della chiave di lettura: nessun accesso cross-asta. */
export async function findEventById(
  db: DbOrTx,
  auctionId: string,
  eventId: string
): Promise<AuctionEvent | null> {
  const [row] = await db
    .select()
    .from(auctionEvents)
    .where(and(eq(auctionEvents.auctionId, auctionId), eq(auctionEvents.id, eventId)))
    .limit(1)
  return row ?? null
}

/** Gli eventi non si cancellano mai: l'annullo si marca (spec §26). */
export async function markEventReverted(db: DbOrTx, eventId: string): Promise<void> {
  await db
    .update(auctionEvents)
    .set({ revertedAt: new Date() })
    .where(eq(auctionEvents.id, eventId))
}

export async function listEvents(
  db: DbOrTx,
  auctionId: string,
  limit: number,
  offset: number
): Promise<{ rows: AuctionEventRow[]; total: number }> {
  const [totals] = await db
    .select({ total: count() })
    .from(auctionEvents)
    .where(eq(auctionEvents.auctionId, auctionId))

  const rows = await db
    .select({
      id: auctionEvents.id,
      type: auctionEvents.type,
      playerId: auctionEvents.playerId,
      playerName: players.name,
      actorName: users.name,
      payload: auctionEvents.payload,
      createdAt: auctionEvents.createdAt,
      revertedAt: auctionEvents.revertedAt,
    })
    .from(auctionEvents)
    .leftJoin(players, eq(players.id, auctionEvents.playerId))
    .leftJoin(users, eq(users.id, auctionEvents.actorUserId))
    .where(eq(auctionEvents.auctionId, auctionId))
    .orderBy(desc(auctionEvents.createdAt))
    .limit(limit)
    .offset(offset)

  return {
    rows: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      revertedAt: row.revertedAt?.toISOString() ?? null,
    })),
    total: totals?.total ?? 0,
  }
}
