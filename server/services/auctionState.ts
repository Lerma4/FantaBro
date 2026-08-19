import type { Auction, AuctionState } from '#shared/types'
import { computeAuctionState, type AuctionRules } from '../domain/budget'
import { listPurchaseFacts } from '../repositories/auctionPlayers'
import type { DbOrTx } from '../utils/db'

/** Configurazione d'asta rilevante per budget e slot. */
export function toRules(auction: Auction): AuctionRules {
  return {
    initialBudget: auction.initialBudget,
    minimumPlayerCost: auction.minimumPlayerCost,
    roleSlots: auction.roleSlots,
    roleBudgets: auction.roleBudgets,
  }
}

/**
 * Stato d'asta sempre derivato dagli acquisti, mai letto da colonne mutabili (spec 21).
 * Dentro una transazione va passato `tx`, cosi lo stato restituito e quello appena scritto.
 */
export async function loadAuctionState(db: DbOrTx, auction: Auction): Promise<AuctionState> {
  const purchases = await listPurchaseFacts(db, auction.id)
  return computeAuctionState(auction.id, toRules(auction), purchases)
}
