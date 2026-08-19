import { eq } from 'drizzle-orm'
import { appSettings } from '../database/schema'
import type { DbOrTx } from '../utils/db'

/**
 * Store key/value JSON. Il cast a `T` è inevitabile in un contenitore generico:
 * chi legge deve validare il valore (zod) se arriva da fuori.
 */
export async function getSetting<T>(db: DbOrTx, key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)
  if (!row || row.value === null) return null
  return row.value as T
}

export async function setSetting(db: DbOrTx, key: string, value: unknown): Promise<void> {
  const updatedAt = new Date()
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } })
}
