import type { CreateAuctionInput, UpdateAuctionInput } from '#shared/schemas'
import type { Auction, AuctionSummary, MemberRole } from '#shared/types'
import { createAuction, lockAuction, updateAuction } from '../repositories/auctions'
import { countPlayersForSeason } from '../repositories/players'
import { withTransaction, type DbOrTx } from '../utils/db'
import { DomainError } from '../utils/errors'
import { publishAuctionChange } from '../utils/events'

/** Vista d'asta per liste e intestazioni: aggiunge il ruolo di chi sta guardando. */
export async function toAuctionSummary(
  db: DbOrTx,
  auction: Auction,
  memberRole: MemberRole
): Promise<AuctionSummary> {
  return {
    id: auction.id,
    name: auction.name,
    season: auction.season,
    mode: auction.mode,
    initialBudget: auction.initialBudget,
    minimumPlayerCost: auction.minimumPlayerCost,
    roleSlots: auction.roleSlots,
    roleBudgets: auction.roleBudgets,
    memberRole,
    playersCount: await countPlayersForSeason(db, auction.season),
  }
}

/** Crea un'asta e garantisce che chi la crea ne sia OWNER (spec 10). */
export function createAuctionWithOwner(
  input: CreateAuctionInput,
  userId: string
): Promise<AuctionSummary> {
  // `createAuction` inserisce asta, rosa e membership OWNER, ma con tre insert separate:
  // la transazione le tiene atomiche.
  return withTransaction(async (tx) => {
    const auction = await createAuction(tx, { ...input, createdBy: userId })
    return toAuctionSummary(tx, auction, 'OWNER')
  })
}

/**
 * Modifica budget, costo minimo e slot. Cambia lo stato derivato di tutti: la notifica va
 * nella stessa transazione, cosi i client connessi lo ricalcolano subito (spec 47).
 */
export function updateAuctionSettings(
  auctionId: string,
  input: UpdateAuctionInput,
  memberRole: MemberRole
): Promise<AuctionSummary> {
  return withTransaction(async (tx) => {
    // `initialBudget` e `roleSlots` sono l'invariante che i controlli d'acquisto usano:
    // cambiarli mentre un acquisto e in volo la violerebbe. Stesso lock, stesso ordine.
    if (!(await lockAuction(tx, auctionId))) throw new DomainError('AUCTION_NOT_FOUND')

    const auction = await updateAuction(tx, auctionId, input)
    await publishAuctionChange(tx, auctionId, { playerIds: [] })
    return toAuctionSummary(tx, auction, memberRole)
  })
}
