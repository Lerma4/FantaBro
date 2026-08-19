import { aiSettingsSchema } from '#shared/schemas'
import { setSetting } from '../../repositories/settings'
import { AI_DEFAULT_PROVIDER_SETTING } from '../../services/ai'
import { requireAdmin } from '../../utils/auth'
import { db } from '../../utils/db'
import { defineApiHandler } from '../../utils/errors'
import { readValidatedBodyOrFail } from '../../utils/validate'

export default defineApiHandler(async (event) => {
  await requireAdmin(event)

  const input = await readValidatedBodyOrFail(event, aiSettingsSchema)
  await setSetting(db, AI_DEFAULT_PROVIDER_SETTING, input.defaultProviderId)

  return { defaultProviderId: input.defaultProviderId }
})
