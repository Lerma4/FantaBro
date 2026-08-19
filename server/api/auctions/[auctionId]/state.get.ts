import { loadAuctionState } from '../../../services/auctionState'
import { db } from '../../../utils/db'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuctionAccess } from '../../../utils/guards'
import { getUuidParam } from '../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')
  return loadAuctionState(db, auction)
})
