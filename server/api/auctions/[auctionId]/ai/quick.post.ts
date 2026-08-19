import { aiQuickActionRequestSchema } from '#shared/schemas'
import { quickAction } from '../../../../services/ai'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')

  const input = await readValidatedBodyOrFail(event, aiQuickActionRequestSchema)
  return quickAction({ auction, ...input })
})
