import { markSoldSchema } from '#shared/schemas'
import { markPlayerSold } from '../../../services/sold'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuctionAccess } from '../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, user } = await requireAuctionAccess(event, auctionId, 'EDITOR')

  const input = await readValidatedBodyOrFail(event, markSoldSchema)

  return markPlayerSold({
    auction,
    playerId: input.playerId,
    soldPrice: input.soldPrice,
    otherTeamName: input.otherTeamName,
    userId: user.id,
  })
})
