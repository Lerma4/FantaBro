import type { MarketAnalytics } from '#shared/types'
import { computeMarketAnalytics } from '../domain/analytics'
import { listSoldFacts } from '../repositories/auctionPlayers'
import type { DbOrTx } from '../utils/db'

/** Analytics di mercato dai soli prezzi realmente registrati (spec 31). */
export async function loadMarketAnalytics(db: DbOrTx, auctionId: string): Promise<MarketAnalytics> {
  return computeMarketAnalytics(await listSoldFacts(db, auctionId))
}
