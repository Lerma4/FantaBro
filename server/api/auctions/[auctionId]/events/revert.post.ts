import { revertEventSchema } from '#shared/schemas'
import { revertEvent } from '../../../../services/revert'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, user } = await requireAuctionAccess(event, auctionId, 'EDITOR')

  const input = await readValidatedBodyOrFail(event, revertEventSchema)
  return revertEvent({ auction, eventId: input.eventId, userId: user.id })
})
