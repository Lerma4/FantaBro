import { z } from 'zod'
import { updateUserRoleSchema } from '#shared/schemas'
import { setManagedUserRole } from '../../services/users'
import { requireAdmin } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { getValidatedParam, readValidatedBodyOrFail } from '../../utils/validate'

export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  const userId = getValidatedParam(event, 'userId', z.string().trim().min(1).max(128))
  return setManagedUserRole(
    userId,
    (await readValidatedBodyOrFail(event, updateUserRoleSchema)).role
  )
})
