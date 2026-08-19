import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth/minimal'
import type { H3Event } from 'h3'
import { APP_ROLES } from '#shared/constants'
import type { AppRole } from '#shared/types'
import * as schema from '../database/schema'
import { db } from './db'

const { betterAuthSecret, betterAuthUrl } = useRuntimeConfig()

// Il runtime config si popola da `NUXT_BETTER_AUTH_*`; accettiamo anche i nomi
// senza prefisso, che sono quelli documentati da Better Auth.
const secret = betterAuthSecret || process.env.BETTER_AUTH_SECRET
const baseURL = process.env.NUXT_BETTER_AUTH_URL || process.env.BETTER_AUTH_URL || betterAuthUrl

/**
 * Better Auth con adapter Drizzle.
 *
 * - `better-auth/minimal` è la variante documentata quando si passa un adapter:
 *   evita di trascinare Kysely nel bundle Nitro. Le migrazioni sono di Drizzle Kit.
 * - `usePlural: true` perché le tabelle si chiamano `users`/`sessions`/...
 * - `disableSignUp: true`: nessuna registrazione pubblica (spec §3 "Authentication").
 *   Il primo utente si crea con `pnpm db:seed`.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
    usePlural: true,
    transaction: true,
  }),
  secret,
  baseURL,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      /** `input: false`: il ruolo non è mai impostabile dal client. */
      role: { type: 'string', required: false, defaultValue: 'MEMBER', input: false },
    },
  },
})

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  role: AppRole
}

function toAppRole(value: unknown): AppRole {
  return (APP_ROLES as readonly unknown[]).includes(value) ? (value as AppRole) : 'MEMBER'
}

export async function getOptionalUser(event: H3Event): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) return null
  const { id, email, name, role } = session.user
  return { id, email, name, role: toAppRole(role) }
}

/** Lancia 401 `UNAUTHORIZED`. Il server restituisce solo codici stabili (spec §6). */
export async function requireUser(event: H3Event): Promise<AuthenticatedUser> {
  const user = await getOptionalUser(event)
  if (!user) throw createError({ statusCode: 401, data: { code: 'UNAUTHORIZED' } })
  return user
}

/** Lancia 403 `FORBIDDEN` se l'utente non è ADMIN (spec §8). */
export async function requireAdmin(event: H3Event): Promise<AuthenticatedUser> {
  const user = await requireUser(event)
  if (user.role !== 'ADMIN') throw createError({ statusCode: 403, data: { code: 'FORBIDDEN' } })
  return user
}
