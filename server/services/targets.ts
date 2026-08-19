import type { UpdateTargetInput } from '#shared/schemas'
import type { Auction, AuctionEventType, PlayerRow } from '#shared/types'
import { appendEvent } from '../repositories/events'
import { findPlayerById } from '../repositories/players'
import { upsertTarget } from '../repositories/targets'
import { withTransaction } from '../utils/db'
import { DomainError } from '../utils/errors'
import { publishAuctionChange } from '../utils/events'
import { loadPlayerRow } from './playerRows'

export interface UpdateTargetServiceInput {
  auction: Auction
  patch: UpdateTargetInput
  userId: string
}

/**
 * Un cambio di solo tier merita il suo evento: nel log d'asta "tier aggiornato" e
 * un'informazione diversa da "prezzi/target aggiornati" (spec 26).
 */
function eventTypeFor(patch: UpdateTargetInput): AuctionEventType {
  const { playerId: _playerId, tier, ...rest } = patch
  const onlyTier = tier !== undefined && Object.values(rest).every((value) => value === undefined)
  return onlyTier ? 'PLAYER_TIER_UPDATED' : 'PLAYER_TARGET_UPDATED'
}

/** Aggiorna tier, prezzi personali e watchlist di un giocatore (spec 27, 28). */
export function updateTarget(input: UpdateTargetServiceInput): Promise<{ row: PlayerRow }> {
  const { auction, patch, userId } = input
  const { playerId, ...values } = patch

  return withTransaction(async (tx) => {
    const player = await findPlayerById(tx, playerId)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND')

    await upsertTarget(tx, auction.id, playerId, values)

    const event = await appendEvent(tx, {
      auctionId: auction.id,
      actorUserId: userId,
      playerId,
      type: eventTypeFor(patch),
      payload: values,
    })

    await publishAuctionChange(tx, auction.id, { playerIds: [playerId], eventId: event.id })

    return { row: await loadPlayerRow(tx, auction, playerId) }
  })
}
