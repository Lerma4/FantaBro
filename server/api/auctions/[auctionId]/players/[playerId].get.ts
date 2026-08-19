import { listStatsForPlayer } from '../../../../repositories/stats'
import { loadPlayerRow } from '../../../../services/playerRows'
import { db } from '../../../../utils/db'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const playerId = getUuidParam(event, 'playerId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')

  const [row, stats] = await Promise.all([
    loadPlayerRow(db, auction, playerId),
    listStatsForPlayer(db, playerId),
  ])

  return { row, stats }
})
