import { purchasePlayerSchema } from '#shared/schemas'
import { purchasePlayer } from '../../../services/purchase'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuctionAccess } from '../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, user } = await requireAuctionAccess(event, auctionId, 'EDITOR')

  const input = await readValidatedBodyOrFail(event, purchasePlayerSchema)

  return purchasePlayer({
    auction,
    playerId: input.playerId,
    price: input.price,
    userId: user.id,
  })
})
