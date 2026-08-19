import type { Auction, PlayerRow } from '#shared/types'
import { findPlayerRows } from '../repositories/players'
import { findLatestStatsSeason } from '../repositories/stats'
import type { DbOrTx } from '../utils/db'
import { DomainError } from '../utils/errors'

/**
 * Stagione delle statistiche mostrate accanto al listone: l'ultima disponibile prima della
 * stagione d'asta. Sempre esposta alla UI, anche `null`: mai mescolare stagioni (spec 12).
 */
export function loadStatsSeason(db: DbOrTx, auction: Auction): Promise<string | null> {
  return findLatestStatsSeason(db, auction.season)
}

export async function loadPlayerRows(
  db: DbOrTx,
  auction: Auction,
  playerIds: string[]
): Promise<PlayerRow[]> {
  if (playerIds.length === 0) return []
  const statsSeason = await loadStatsSeason(db, auction)
  return findPlayerRows(db, auction.id, playerIds, statsSeason)
}

export async function loadPlayerRow(
  db: DbOrTx,
  auction: Auction,
  playerId: string
): Promise<PlayerRow> {
  const [row] = await loadPlayerRows(db, auction, [playerId])
  if (!row) throw new DomainError('PLAYER_NOT_FOUND')
  return row
}
