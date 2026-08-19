import { updateTargetSchema } from '#shared/schemas'
import { updateTarget } from '../../../services/targets'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuctionAccess } from '../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, user } = await requireAuctionAccess(event, auctionId, 'EDITOR')

  const patch = await readValidatedBodyOrFail(event, updateTargetSchema)

  return updateTarget({ auction, patch, userId: user.id })
})
