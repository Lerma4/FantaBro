import { listManagedUsers } from '../../services/users'
import { requireAdmin } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'

export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  return listManagedUsers()
})
