import { getAllProviderStatuses } from '../../../providers/ai'
import { requireAdmin } from '../../../utils/auth'
import { defineApiHandler } from '../../../utils/errors'

/** Solo un ADMIN vede lo stato dei provider: e amministrazione del server (spec 40). */
export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  return getAllProviderStatuses()
})
