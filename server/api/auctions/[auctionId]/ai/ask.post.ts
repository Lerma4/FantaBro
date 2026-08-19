import { aiAskSchema } from '#shared/schemas'
import { askAi } from '../../../../services/ai'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../../utils/validate'

/** Chiedere consigli non e un'operazione amministrativa: basta essere membro dell'asta. */
export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')

  const input = await readValidatedBodyOrFail(event, aiAskSchema)
  return askAi({ auction, ...input })
})
