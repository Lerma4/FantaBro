import { revertPlayerSchema } from '#shared/schemas'
import { revertPlayer } from '../../../../services/revert'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, user } = await requireAuctionAccess(event, auctionId, 'EDITOR')
  const input = await readValidatedBodyOrFail(event, revertPlayerSchema)
  return revertPlayer({ auction, playerId: input.playerId, userId: user.id })
})
