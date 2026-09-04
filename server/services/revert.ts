import type { Auction, AuctionEventType, AuctionState, PlayerRow } from '#shared/types'
import { checkRevert } from '../domain/purchase'
import { lockAuction } from '../repositories/auctions'
import { lockAuctionPlayer, setStatus } from '../repositories/auctionPlayers'
import {
  appendEvent,
  findEventById,
  findLatestRevertableEvent,
  markEventReverted,
} from '../repositories/events'
import { getRosterId, removeRosterPlayer } from '../repositories/roster'
import type { DbOrTx } from '../utils/db'
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

export interface RevertPlayerInput {
  auction: Auction
  playerId: string
  userId: string
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

    const playerId = original.playerId
    if (!playerId) throw new DomainError('EVENT_NOT_REVERTABLE')

    // Stesso lock dell'acquisto: un undo e un acquisto concorrenti si serializzano.
    await lockAuctionPlayer(tx, auction.id, playerId)
    // L'evento potrebbe essere stato annullato mentre attendevamo il lock del giocatore.
    const lockedOriginal = await findEventById(tx, auction.id, eventId)
    if (!lockedOriginal) throw new DomainError('NOT_FOUND')

    return applyRevert(tx, auction, lockedOriginal, userId)
  })
}

/** Annulla lo stato corrente di un giocatore, senza costringere la UI a conoscere l'evento. */
export function revertPlayer(input: RevertPlayerInput): Promise<RevertResult> {
  const { playerId, userId } = input

  return withTransaction(async (tx) => {
    const auction = await lockAuction(tx, input.auction.id)
    if (!auction) throw new DomainError('AUCTION_NOT_FOUND')

    const locked = await lockAuctionPlayer(tx, auction.id, playerId)
    if (!locked) throw new DomainError('PLAYER_NOT_FOUND')
    if (locked.status !== 'MY_PLAYER' && locked.status !== 'SOLD') {
      throw new DomainError('PLAYER_NOT_AVAILABLE')
    }

    const type = locked.status === 'MY_PLAYER' ? 'PLAYER_PURCHASED' : 'PLAYER_SOLD'
    const original = await findLatestRevertableEvent(tx, auction.id, playerId, type)
    if (!original) throw new DomainError('CONFLICT')

    return applyRevert(tx, auction, original, userId)
  })
}

async function applyRevert(
  tx: DbOrTx,
  auction: Auction,
  original: {
    id: string
    playerId: string | null
    type: AuctionEventType
    payload: Record<string, unknown>
    revertedAt: Date | null
  },
  userId: string
): Promise<RevertResult> {
  const check = checkRevert(original)
  if (!check.ok) throw new DomainError(check.code)

  const reversalType = REVERSAL_TYPE[original.type]
  const playerId = original.playerId
  if (!reversalType || !playerId) throw new DomainError('EVENT_NOT_REVERTABLE')

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
    payload: { revertedEventId: original.id, revertedPayload: original.payload },
  })

  await markEventReverted(tx, original.id)
  await publishAuctionChange(tx, auction.id, { playerIds: [playerId], eventId: reversal.id })

  return {
    state: await loadAuctionState(tx, auction),
    row: await loadPlayerRow(tx, auction, playerId),
  }
}
