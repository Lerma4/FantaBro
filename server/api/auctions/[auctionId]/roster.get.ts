import { listRoster } from '../../../repositories/roster'
import { db } from '../../../utils/db'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuctionAccess } from '../../../utils/guards'
import { getUuidParam } from '../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'VIEWER')
  return { players: await listRoster(db, auctionId) }
})
