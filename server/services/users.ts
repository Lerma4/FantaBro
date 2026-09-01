import type { AppRole, User } from '#shared/types'
import { provisioningAuth } from '../utils/auth'
import { db, withTransaction } from '../utils/db'
import { DomainError } from '../utils/errors'
import { findUser, listUsers, lockAdmins, updateUserRole } from '../repositories/users'

export function listManagedUsers(): Promise<User[]> {
  return listUsers(db)
}

export async function createManagedUser(input: {
  name: string
  email: string
  password: string
  role: AppRole
}): Promise<User> {
  // ponytail: Better Auth already owns password hashing and credential-account writes.
  const result = await provisioningAuth.api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
  })
  const user = await withTransaction(async (tx) => {
    const created = await findUser(tx, result.user.id)
    if (!created) throw new DomainError('NOT_FOUND')
    return updateUserRole(tx, created.id, input.role)
  })
  return user
}

export async function setManagedUserRole(userId: string, role: AppRole): Promise<User> {
  return withTransaction(async (tx) => {
    const user = await findUser(tx, userId)
    if (!user) throw new DomainError('NOT_FOUND')
    if (user.isBootstrapAdmin && role !== 'ADMIN') {
      throw new DomainError('BOOTSTRAP_ADMIN_IMMUTABLE')
    }
    if (user.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await lockAdmins(tx)
      if (admins.length === 1) throw new DomainError('LAST_ADMIN_REQUIRED')
    }
    return updateUserRole(tx, userId, role)
  })
}
