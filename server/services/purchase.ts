import type { Auction, AuctionState, PlayerRow } from '#shared/types'
import { checkPurchase } from '../domain/purchase'
import { lockAuction } from '../repositories/auctions'
import { listPurchaseFacts, lockAuctionPlayer, setStatus } from '../repositories/auctionPlayers'
import { appendEvent } from '../repositories/events'
import { findPlayerById } from '../repositories/players'
import { addRosterPlayer, getRosterId } from '../repositories/roster'
import { withTransaction } from '../utils/db'
import { DomainError, isUniqueViolation } from '../utils/errors'
import { publishAuctionChange } from '../utils/events'
import { loadAuctionState, toRules } from './auctionState'
import { loadPlayerRow } from './playerRows'

export interface PurchaseInput {
  auction: Auction
  playerId: string
  price: number
  userId: string
}

export interface PurchaseResult {
  state: AuctionState
  row: PlayerRow
  eventId: string
}

/**
 * Acquisto di un giocatore: controlli, rosa, stato, evento e notifica in **una sola
 * transazione** (spec 24, 48). Se un controllo fallisce non viene scritto niente.
 */
export function purchasePlayer(input: PurchaseInput): Promise<PurchaseResult> {
  const { playerId, price, userId } = input

  return withTransaction(async (tx) => {
    // Lock d'asta per primo: serializza gli acquisti della stessa asta, che e l'unico modo
    // di impedire a due acquisti di giocatori *diversi* di sforare insieme il budget.
    // L'ordine dei lock (asta, poi giocatore) e lo stesso in ogni servizio: invertirlo
    // in un solo punto basta a produrre un deadlock.
    const auction = await lockAuction(tx, input.auction.id)
    if (!auction) throw new DomainError('AUCTION_NOT_FOUND')

    const player = await findPlayerById(tx, playerId)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND')

    // Lock pessimistico sulla riga di stato: due acquisti simultanei si serializzano qui.
    // Il lock crea la riga se manca, quindi `null` vuol dire solo giocatore inesistente.
    const locked = await lockAuctionPlayer(tx, auction.id, playerId)
    if (!locked) throw new DomainError('PLAYER_NOT_FOUND')

    // Gli acquisti si rileggono **dentro** la transazione: il budget deve essere quello vero.
    const purchases = await listPurchaseFacts(tx, auction.id)
    const check = checkPurchase({
      rules: toRules(auction),
      purchases,
      role: player.role,
      price,
      status: locked.status,
    })
    if (!check.ok) throw new DomainError(check.code)

    const rosterId = await getRosterId(tx, auction.id)
    try {
      await addRosterPlayer(tx, rosterId, playerId, price)
    } catch (err) {
      // Vincolo unico (roster, giocatore): un acquisto concorrente ha vinto la corsa.
      if (isUniqueViolation(err)) throw new DomainError('CONFLICT')
      throw err
    }

    await setStatus(tx, auction.id, playerId, { status: 'MY_PLAYER', updatedBy: userId })

    const event = await appendEvent(tx, {
      auctionId: auction.id,
      actorUserId: userId,
      playerId,
      type: 'PLAYER_PURCHASED',
      payload: { price },
    })

    await publishAuctionChange(tx, auction.id, { playerIds: [playerId], eventId: event.id })

    return {
      state: await loadAuctionState(tx, auction),
      row: await loadPlayerRow(tx, auction, playerId),
      eventId: event.id,
    }
  })
}
