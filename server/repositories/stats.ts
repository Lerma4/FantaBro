import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { PlayerSeasonStats } from '#shared/types'
import { normalizeName } from '#shared/utils/normalize'
import { playerSeasonStats, players } from '../database/schema'
import type { DbOrTx } from '../utils/db'

/** Ritorna il numero di righe scritte (inserite o aggiornate). */
export async function upsertSeasonStats(db: DbOrTx, rows: PlayerSeasonStats[]): Promise<number> {
  if (rows.length === 0) return 0

  const byKey = new Map<string, PlayerSeasonStats>()
  for (const row of rows) byKey.set(`${row.playerId} ${row.season}`, row)

  const now = new Date()
  const written = await db
    .insert(playerSeasonStats)
    .values([...byKey.values()].map((row) => ({ ...row, updatedAt: now })))
    .onConflictDoUpdate({
      target: [playerSeasonStats.playerId, playerSeasonStats.season],
      set: {
        appearances: sql`excluded.appearances`,
        starts: sql`excluded.starts`,
        minutes: sql`excluded.minutes`,
        averageRating: sql`excluded.average_rating`,
        fantasyAverage: sql`excluded.fantasy_average`,
        goals: sql`excluded.goals`,
        assists: sql`excluded.assists`,
        yellowCards: sql`excluded.yellow_cards`,
        redCards: sql`excluded.red_cards`,
        penaltiesScored: sql`excluded.penalties_scored`,
        penaltiesMissed: sql`excluded.penalties_missed`,
        goalsConceded: sql`excluded.goals_conceded`,
        penaltiesSaved: sql`excluded.penalties_saved`,
        provider: sql`excluded.provider`,
        updatedAt: now,
      },
    })
    .returning({ playerId: playerSeasonStats.playerId })

  return written.length
}

export async function listStatsForPlayer(
  db: DbOrTx,
  playerId: string
): Promise<PlayerSeasonStats[]> {
  return db
    .select()
    .from(playerSeasonStats)
    .where(eq(playerSeasonStats.playerId, playerId))
    .orderBy(desc(playerSeasonStats.season))
}

/**
 * Stagione di statistiche più recente **precedente** a quella indicata.
 * Il formato `2026/27` ordina correttamente come stringa, quindi non serve
 * normalizzare nulla. Mai mescolare stagioni diverse (spec §12).
 */
export async function findLatestStatsSeason(
  db: DbOrTx,
  beforeSeason: string
): Promise<string | null> {
  const [row] = await db
    .select({ season: playerSeasonStats.season })
    .from(playerSeasonStats)
    .where(lt(playerSeasonStats.season, beforeSeason))
    .orderBy(desc(playerSeasonStats.season))
    .limit(1)
  return row?.season ?? null
}

/**
 * Nome normalizzato -> playerId, per agganciare le statistiche di un provider
 * che espone solo i nomi. Con due omonimi nella stessa stagione vince l'ultima
 * riga letta: l'aggancio per nome è intrinsecamente ambiguo.
 */
export async function resolvePlayerIdsByName(
  db: DbOrTx,
  season: string,
  names: string[]
): Promise<Map<string, string>> {
  const normalized = [...new Set(names.map(normalizeName).filter((name) => name.length > 0))]
  if (normalized.length === 0) return new Map()

  const rows = await db
    .select({ id: players.id, searchName: players.searchName })
    .from(players)
    .where(and(eq(players.season, season), inArray(players.searchName, normalized)))

  return new Map(rows.map((row) => [row.searchName, row.id]))
}
