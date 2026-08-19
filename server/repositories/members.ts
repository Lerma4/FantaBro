import { and, eq, sql } from 'drizzle-orm'
import type { AuctionMember, MemberRole } from '#shared/types'
import { auctionMembers, users } from '../database/schema'
import type { DbOrTx } from '../utils/db'

export async function findMembership(
  db: DbOrTx,
  auctionId: string,
  userId: string
): Promise<AuctionMember | null> {
  const [row] = await db
    .select()
    .from(auctionMembers)
    .where(and(eq(auctionMembers.auctionId, auctionId), eq(auctionMembers.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function listMembers(db: DbOrTx, auctionId: string): Promise<AuctionMember[]> {
  return db
    .select({
      auctionId: auctionMembers.auctionId,
      userId: auctionMembers.userId,
      role: auctionMembers.role,
      createdAt: auctionMembers.createdAt,
      user: { id: users.id, email: users.email, name: users.name },
    })
    .from(auctionMembers)
    .innerJoin(users, eq(users.id, auctionMembers.userId))
    .where(eq(auctionMembers.auctionId, auctionId))
    .orderBy(auctionMembers.createdAt)
}

/** Upsert: riassegnare un ruolo a un membro esistente non è un errore. */
export async function addMember(
  db: DbOrTx,
  auctionId: string,
  userId: string,
  role: MemberRole
): Promise<AuctionMember> {
  const [row] = await db
    .insert(auctionMembers)
    .values({ auctionId, userId, role })
    .onConflictDoUpdate({
      target: [auctionMembers.auctionId, auctionMembers.userId],
      set: { role },
    })
    .returning()
  if (!row) throw new Error('addMember: upsert senza riga restituita')
  return row
}

export async function removeMember(db: DbOrTx, auctionId: string, userId: string): Promise<void> {
  await db
    .delete(auctionMembers)
    .where(and(eq(auctionMembers.auctionId, auctionId), eq(auctionMembers.userId, userId)))
}

/** Confronto case-insensitive: Better Auth salva l'email così com'è arrivata. */
export async function findUserByEmail(
  db: DbOrTx,
  email: string
): Promise<{ id: string; email: string; name: string } | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1)
  return row ?? null
}
