import { loadPlayerRow } from '../../../../../../services/playerRows'
import { syncFantacalcioStats } from '../../../../../../providers/statistics'
import { db } from '../../../../../../utils/db'
import { defineApiHandler } from '../../../../../../utils/errors'
import { requireAuctionAccess } from '../../../../../../utils/guards'
import { getUuidParam } from '../../../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const playerId = getUuidParam(event, 'playerId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')
  const row = await loadPlayerRow(db, auction, playerId)

  return {
    currentStats: await syncFantacalcioStats({
      name: row.name,
      team: row.team,
      season: auction.season,
    }),
  }
})
