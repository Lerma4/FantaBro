import type { H3Event } from 'h3'
import type { Auction, AuctionMember, MemberRole, User } from '#shared/types'
import { findAuctionById } from '../repositories/auctions'
import { findMembership } from '../repositories/members'
import { requireUser } from './auth'
import { db } from './db'
import { DomainError } from './errors'

/** Gerarchia delle membership: OWNER puo tutto quello che puo un EDITOR, e cosi via (spec 10). */
const RANK: Record<MemberRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 }

export interface AuctionAccess {
  user: Pick<User, 'id' | 'email' | 'name' | 'role'>
  auction: Auction
  membership: AuctionMember
}

/**
 * Autorizzazione su un'asta: utente autenticato + membership con ruolo sufficiente.
 *
 * Il ruolo applicativo `ADMIN` (spec 8) e un asse diverso dalla membership (spec 10): un ADMIN
 * amministra provider AI e utenti, **non** ottiene accesso implicito alle aste di altri.
 */
export async function requireAuctionAccess(
  event: H3Event,
  auctionId: string,
  minimumRole: MemberRole
): Promise<AuctionAccess> {
  const user = await requireUser(event)

  const auction = await findAuctionById(db, auctionId)
  if (!auction) throw new DomainError('AUCTION_NOT_FOUND')

  const membership = await findMembership(db, auctionId, user.id)
  if (!membership || RANK[membership.role] < RANK[minimumRole]) throw new DomainError('FORBIDDEN')

  return { user, auction, membership }
}
