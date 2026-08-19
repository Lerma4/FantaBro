import { paginationSchema } from '#shared/schemas'
import { listEvents } from '../../../../repositories/events'
import { db } from '../../../../utils/db'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, getValidatedQueryOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'VIEWER')

  const { limit, offset } = getValidatedQueryOrFail(event, paginationSchema)
  return listEvents(db, auctionId, limit, offset)
})
