import { listStatsForPlayer } from '../../../../repositories/stats'
import { loadPlayerRow } from '../../../../services/playerRows'
import { getCachedFantacalcioStats } from '../../../../providers/statistics'
import { db } from '../../../../utils/db'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const playerId = getUuidParam(event, 'playerId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')
  const row = await loadPlayerRow(db, auction, playerId)
  const [stats, currentStats] = await Promise.all([
    listStatsForPlayer(db, playerId),
    getCachedFantacalcioStats({ name: row.name, team: row.team, season: auction.season }),
  ])

  return { row, stats, currentStats }
})
