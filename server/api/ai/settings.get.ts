import { resolveProviderId } from '../../services/ai'
import { requireAdmin } from '../../utils/auth'
import { db } from '../../utils/db'
import { defineApiHandler } from '../../utils/errors'

export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  // Se non e mai stato salvato niente vale il default di configurazione.
  return { defaultProviderId: await resolveProviderId(db) }
})
