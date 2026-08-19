import { updateAuctionSchema } from '#shared/schemas'
import { updateAuctionSettings } from '../../../services/auctions'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuctionAccess } from '../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { membership } = await requireAuctionAccess(event, auctionId, 'OWNER')

  const input = await readValidatedBodyOrFail(event, updateAuctionSchema)
  return updateAuctionSettings(auctionId, input, membership.role)
})
