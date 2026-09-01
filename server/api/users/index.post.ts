import { createUserSchema } from '#shared/schemas'
import { createManagedUser } from '../../services/users'
import { requireAdmin } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { readValidatedBodyOrFail } from '../../utils/validate'

export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  return createManagedUser(await readValidatedBodyOrFail(event, createUserSchema))
})
