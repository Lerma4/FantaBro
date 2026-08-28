import { statsWipeQuerySchema } from '#shared/schemas'
import { wipeStats } from '../../services/import'
import { requireAdmin } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { getValidatedQueryOrFail } from '../../utils/validate'

/**
 * Cancella le statistiche di una stagione di dati, per il listone indicato. Le altre
 * stagioni restano dove sono.
 */
export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  const { season, statsSeason } = getValidatedQueryOrFail(event, statsWipeQuerySchema)

  return wipeStats(season, statsSeason)
})
