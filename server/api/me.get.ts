import { requireUser } from '../utils/auth'
import { defineApiHandler } from '../utils/errors'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  return { user: { id: user.id, email: user.email, name: user.name, role: user.role } }
})
