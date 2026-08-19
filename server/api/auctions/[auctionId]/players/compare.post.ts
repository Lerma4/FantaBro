import { comparePlayersSchema } from '#shared/schemas'
import { loadPlayerRows } from '../../../../services/playerRows'
import { db } from '../../../../utils/db'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')

  const input = await readValidatedBodyOrFail(event, comparePlayersSchema)
  return { players: await loadPlayerRows(db, auction, input.playerIds) }
})
