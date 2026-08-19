import type { Auction, AuctionEventType, AuctionState, PlayerRow } from '#shared/types'
import { checkRevert } from '../domain/purchase'
import { lockAuction } from '../repositories/auctions'
import { lockAuctionPlayer, setStatus } from '../repositories/auctionPlayers'
import { appendEvent, findEventById, markEventReverted } from '../repositories/events'
import { getRosterId, removeRosterPlayer } from '../repositories/roster'
import { withTransaction } from '../utils/db'
import { DomainError } from '../utils/errors'
import { publishAuctionChange } from '../utils/events'
import { loadAuctionState } from './auctionState'
import { loadPlayerRow } from './playerRows'

export interface RevertInput {
  auction: Auction
  eventId: string
  userId: string
}

export interface RevertResult {
  state: AuctionState
  row: PlayerRow | null
}

/** Evento di annullamento corrispondente a ogni evento annullabile (spec 25). */
const REVERSAL_TYPE: Partial<Record<AuctionEventType, AuctionEventType>> = {
  PLAYER_PURCHASED: 'PLAYER_PURCHASE_REVERTED',
  PLAYER_SOLD: 'PLAYER_SOLD_REVERTED',
}

/**
 * Annulla un acquisto o una marcatura SOLD. La storia non viene distrutta: si aggiunge un
 * evento di annullamento e si marca l'originale come annullato (spec 25).
 */
export function revertEvent(input: RevertInput): Promise<RevertResult> {
  const { eventId, userId } = input

  return withTransaction(async (tx) => {
    // Stesso ordine di `purchasePlayer`: prima l'asta, poi il giocatore. Un annullo cambia
    // il budget speso, quindi deve serializzarsi con gli acquisti concorrenti.
    const auction = await lockAuction(tx, input.auction.id)
    if (!auction) throw new DomainError('AUCTION_NOT_FOUND')

    const original = await findEventById(tx, auction.id, eventId)
    if (!original) throw new DomainError('NOT_FOUND')

    const check = checkRevert(original)
    if (!check.ok) throw new DomainError(check.code)

    const reversalType = REVERSAL_TYPE[original.type]
    const playerId = original.playerId
    if (!reversalType || !playerId) throw new DomainError('EVENT_NOT_REVERTABLE')

    // Stesso lock dell'acquisto: un undo e un acquisto concorrenti si serializzano.
    await lockAuctionPlayer(tx, auction.id, playerId)

    if (original.type === 'PLAYER_PURCHASED') {
      const rosterId = await getRosterId(tx, auction.id)
      await removeRosterPlayer(tx, rosterId, playerId)
    }

    await setStatus(tx, auction.id, playerId, {
      status: 'AVAILABLE',
      soldPrice: null,
      otherTeamName: null,
      updatedBy: userId,
    })

    const reversal = await appendEvent(tx, {
      auctionId: auction.id,
      actorUserId: userId,
      playerId,
      type: reversalType,
      payload: { revertedEventId: eventId, revertedPayload: original.payload },
    })

    await markEventReverted(tx, eventId)
    await publishAuctionChange(tx, auction.id, { playerIds: [playerId], eventId: reversal.id })

    return {
      state: await loadAuctionState(tx, auction),
      row: await loadPlayerRow(tx, auction, playerId),
    }
  })
}
