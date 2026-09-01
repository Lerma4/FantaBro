import { asc, eq } from 'drizzle-orm'
import type { AppRole, User } from '#shared/types'
import { users } from '../database/schema'
import type { DbOrTx } from '../utils/db'

export async function listUsers(db: DbOrTx): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.name), asc(users.email))
}

export async function findUser(db: DbOrTx, userId: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return user ?? null
}

export async function lockAdmins(db: DbOrTx): Promise<User[]> {
  return db.select().from(users).where(eq(users.role, 'ADMIN')).for('update')
}

export async function updateUserRole(db: DbOrTx, userId: string, role: AppRole): Promise<User> {
  const [user] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()
  if (!user) throw new Error('updateUserRole: aggiornamento senza riga restituita')
  return user
}
