import type { Auction, AuctionState, PlayerRow } from '#shared/types'
import { checkMarkSold } from '../domain/purchase'
import { lockAuctionPlayer, setStatus } from '../repositories/auctionPlayers'
import { appendEvent } from '../repositories/events'
import { findPlayerById } from '../repositories/players'
import { withTransaction } from '../utils/db'
import { DomainError } from '../utils/errors'
import { publishAuctionChange } from '../utils/events'
import { loadAuctionState } from './auctionState'
import { loadPlayerRow } from './playerRows'

export interface MarkSoldInput {
  auction: Auction
  playerId: string
  /** Facoltativo: serve alle analytics, ma non si obbliga l'utente a inserirlo (spec 16). */
  soldPrice?: number | null
  otherTeamName?: string | null
  userId: string
}

export interface MarkSoldResult {
  state: AuctionState
  row: PlayerRow
  eventId: string
}

/**
 * Marca un giocatore come venduto ad altri. Non tocca budget ne slot: cambia solo la
 * disponibilita e alimenta le analytics di mercato (spec 16).
 */
export function markPlayerSold(input: MarkSoldInput): Promise<MarkSoldResult> {
  const { auction, playerId, userId } = input
  const soldPrice = input.soldPrice ?? null
  const otherTeamName = input.otherTeamName ?? null

  return withTransaction(async (tx) => {
    const player = await findPlayerById(tx, playerId)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND')

    // Il lock crea la riga di stato se manca: `null` vuol dire giocatore inesistente.
    const locked = await lockAuctionPlayer(tx, auction.id, playerId)
    if (!locked) throw new DomainError('PLAYER_NOT_FOUND')

    // Un acquisto concorrente committato prima di noi vince: SOLD non lo sovrascrive (spec 48).
    const check = checkMarkSold(locked.status)
    if (!check.ok) throw new DomainError(check.code)

    await setStatus(tx, auction.id, playerId, {
      status: 'SOLD',
      soldPrice,
      otherTeamName,
      updatedBy: userId,
    })

    const event = await appendEvent(tx, {
      auctionId: auction.id,
      actorUserId: userId,
      playerId,
      type: 'PLAYER_SOLD',
      payload: { soldPrice, otherTeamName },
    })

    await publishAuctionChange(tx, auction.id, { playerIds: [playerId], eventId: event.id })

    return {
      state: await loadAuctionState(tx, auction),
      row: await loadPlayerRow(tx, auction, playerId),
      eventId: event.id,
    }
  })
}
