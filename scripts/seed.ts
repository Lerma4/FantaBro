/**
 * Crea il primo utente ADMIN (`pnpm db:seed`).
 *
 * È l'unico punto in cui la registrazione è permessa: l'app gira con
 * `disableSignUp: true` (spec §3 "no mandatory public registration"). Lo script
 * usa l'API di Better Auth così la password viene hashata dalla libreria e non
 * da noi. La password non viene mai stampata.
 *
 * Idempotente: se l'email esiste già non duplica e, se serve, promuove ad ADMIN.
 */
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth/minimal'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../server/database/schema'

// `tsx` non legge `.env` da solo (drizzle-kit sì, bundla dotenv). Node >= 20.6
// lo fa nativamente: nessuna dipendenza `dotenv` da aggiungere. In produzione
// il file non esiste e le variabili arrivano dall'ambiente.
try {
  process.loadEnvFile()
} catch {
  // nessun .env: si usano le variabili già presenti nell'ambiente
}

const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.SEED_ADMIN_PASSWORD
const name = process.env.SEED_ADMIN_NAME?.trim() || 'Admin'
const connectionString = process.env.DATABASE_URL

const missing = [
  !connectionString && 'DATABASE_URL',
  !email && 'SEED_ADMIN_EMAIL',
  !password && 'SEED_ADMIN_PASSWORD',
].filter(Boolean)

if (missing.length > 0 || !connectionString || !email || !password) {
  console.error(`db:seed - variabili d'ambiente mancanti: ${missing.join(', ')}`)
  console.error('Esempio: SEED_ADMIN_EMAIL=me@example.com SEED_ADMIN_PASSWORD=... pnpm db:seed')
  process.exit(1)
}

const pool = new Pool({ connectionString })
const db = drizzle(pool, { schema })

const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
    usePlural: true,
    transaction: true,
  }),
  secret: process.env.NUXT_BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NUXT_BETTER_AUTH_URL || 'http://localhost:3000',
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'MEMBER', input: false },
    },
  },
})

try {
  const [existing] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1)

  if (existing) {
    if (existing.role === 'ADMIN') {
      console.log(`Utente ADMIN ${email} già presente: nulla da fare.`)
    } else {
      await db
        .update(schema.users)
        .set({ role: 'ADMIN', updatedAt: new Date() })
        .where(eq(schema.users.id, existing.id))
      console.log(`Utente ${email} già presente: promosso ad ADMIN.`)
    }
  } else {
    await auth.api.signUpEmail({ body: { email, password, name } })
    await db
      .update(schema.users)
      .set({ role: 'ADMIN', emailVerified: true, updatedAt: new Date() })
      .where(eq(schema.users.email, email))
    console.log(`Creato utente ADMIN ${email} (${name}).`)
  }
} catch (error) {
  console.error('db:seed fallito:', error instanceof Error ? error.message : error)
  await pool.end()
  process.exit(1)
}

await pool.end()
