import { importStateQuerySchema } from '#shared/schemas'
import { getImportState } from '../../services/import'
import { requireUser } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { getValidatedQueryOrFail } from '../../utils/validate'

/**
 * Cosa risulta importato per una stagione. Sta fuori da `/api/auctions/:id` come le
 * cancellazioni che accompagna: listone e statistiche sono della stagione, non
 * dell'asta. In sola lettura basta essere autenticati.
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { season } = getValidatedQueryOrFail(event, importStateQuerySchema)

  return getImportState(season)
})
