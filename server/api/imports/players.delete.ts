import { importStateQuerySchema } from '#shared/schemas'
import { wipeListone } from '../../services/import'
import { requireAdmin } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { getValidatedQueryOrFail } from '../../utils/validate'

/**
 * Cancella l'intero listone di una stagione. Stesso permesso della rimozione del
 * singolo giocatore (ADMIN, spec §8): tocca tutte le aste che condividono la stagione.
 */
export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  const { season } = getValidatedQueryOrFail(event, importStateQuerySchema)

  return wipeListone(season)
})
