import { listMembers } from '../../../repositories/members'
import { loadAuctionState } from '../../../services/auctionState'
import { toAuctionSummary } from '../../../services/auctions'
import { db } from '../../../utils/db'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuctionAccess } from '../../../utils/guards'
import { getUuidParam } from '../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, membership } = await requireAuctionAccess(event, auctionId, 'VIEWER')

  const [summary, state, members] = await Promise.all([
    toAuctionSummary(db, auction, membership.role),
    loadAuctionState(db, auction),
    listMembers(db, auctionId),
  ])

  return { auction: summary, state, members }
})
