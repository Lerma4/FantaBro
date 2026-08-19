import { playerListFilterSchema } from '#shared/schemas'
import { listPlayerRows, listTeams } from '../../../../repositories/players'
import { loadStatsSeason } from '../../../../services/playerRows'
import { db } from '../../../../utils/db'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, getValidatedQueryOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'VIEWER')

  const filter = getValidatedQueryOrFail(event, playerListFilterSchema)

  // La stagione delle statistiche va sempre esposta, anche `null`: la UI deve poter dire
  // di quale stagione sono le medie mostrate (spec 12).
  const statsSeason = await loadStatsSeason(db, auction)

  const [page, teams] = await Promise.all([
    listPlayerRows(db, auctionId, filter, statsSeason),
    listTeams(db, auction.season),
  ])

  return { rows: page.rows, total: page.total, statsSeason, teams }
})
