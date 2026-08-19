import { aiProviderIdSchema } from '#shared/schemas'
import { getAiProvider } from '../../../../providers/ai'
import { requireAdmin } from '../../../../utils/auth'
import { defineApiHandler } from '../../../../utils/errors'
import { getValidatedParam } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  const providerId = getValidatedParam(event, 'providerId', aiProviderIdSchema)
  return getAiProvider(providerId).getStatus()
})
