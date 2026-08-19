import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client, Pool } from 'pg'
import type { ParsedPlayer } from '#shared/types'
import * as schema from '../../server/database/schema'
import { createAuction } from '../../server/repositories/auctions'
import { upsertPlayers } from '../../server/repositories/players'

/** I test di integrazione si auto-saltano senza un database configurato. */
export const hasDatabase = Boolean(process.env.DATABASE_URL)

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../server/database/migrations', import.meta.url)
)

let cached: { pool: Pool; db: ReturnType<typeof drizzle<typeof schema>> } | null = null

export function testDb() {
  if (!cached) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    cached = { pool, db: drizzle(pool, { schema }) }
  }
  return cached.db
}

export async function applyMigrations(): Promise<void> {
  await migrate(testDb(), { migrationsFolder: MIGRATIONS_FOLDER })
}

/** Chiave arbitraria, condivisa da tutti i file di integrazione. */
const SUITE_LOCK = 4207
let suiteLock: Client | undefined

/**
 * Applica le migrazioni e prende un advisory lock per tutta la durata del file.
 * I file di integrazione truncano lo **stesso** database, quindi due file in
 * parallelo si cancellano i dati a vicenda: il lock li mette in fila. Serve una
 * connessione dedicata perché un advisory lock vive nella sessione che lo prende.
 */
export async function acquireSuite(): Promise<void> {
  await applyMigrations()
  suiteLock = new Client({ connectionString: process.env.DATABASE_URL })
  await suiteLock.connect()
  await suiteLock.query('select pg_advisory_lock($1)', [SUITE_LOCK])
}

export async function releaseSuite(): Promise<void> {
  await closeDatabase()
  if (suiteLock) {
    await suiteLock.query('select pg_advisory_unlock($1)', [SUITE_LOCK])
    await suiteLock.end()
    suiteLock = undefined
  }
}

/**
 * Attende che `expected` sessioni siano bloccate su un lock **di riga**.
 * È un poll su una condizione, non uno sleep: un test di concorrenza che si
 * affida al tempismo è intermittente.
 *
 * `transactionid`/`tuple` e non un generico `wait_event_type = 'Lock'`: così non
 * si conta chi è in coda sull'advisory lock della suite, che è un'altra attesa.
 */
export async function waitForLockWaiters(expected: number): Promise<void> {
  for (;;) {
    const { rows } = await testDb().execute(sql`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and wait_event in ('transactionid', 'tuple')
    `)
    if (Number((rows[0] as { waiting: number }).waiting) >= expected) return
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/** Ripulisce tutte le tabelle applicative fra un test e l'altro. */
export async function truncateAll(): Promise<void> {
  await testDb().execute(sql`
    truncate table
      auction_events, roster_players, rosters, player_targets, auction_players,
      player_season_stats, players, auction_members, auctions, app_settings,
      sessions, accounts, verifications, users
    restart identity cascade
  `)
}

export async function closeDatabase(): Promise<void> {
  if (cached) {
    await cached.pool.end()
    cached = null
  }
}

export async function createUser(): Promise<string> {
  const id = randomUUID()
  await testDb()
    .insert(schema.users)
    .values({ id, name: 'Tester', email: `${id}@example.test` })
  return id
}

export const SEASON = '2026/27'

export async function createTestAuction(
  userId: string,
  season = SEASON,
  initialBudget = 500
): Promise<string> {
  const auction = await createAuction(testDb(), {
    name: 'Asta di test',
    season,
    mode: 'CLASSIC',
    initialBudget,
    minimumPlayerCost: 1,
    roleSlots: { P: 3, D: 8, C: 8, A: 6 },
    roleBudgets: null,
    createdBy: userId,
  })
  return auction.id
}

export function player(overrides: Partial<ParsedPlayer> & { name: string }): ParsedPlayer {
  return {
    externalId: null,
    team: 'Inter',
    role: 'C',
    mantraRole: null,
    quotation: 10,
    fvm: 50,
    ...overrides,
  }
}

/** Importa il listone e restituisce la mappa nome -> playerId letta dal database. */
export async function seedPlayers(
  input: ParsedPlayer[],
  season = SEASON
): Promise<Map<string, string>> {
  await upsertPlayers(testDb(), season, input)
  const rows = await testDb()
    .select({ id: schema.players.id, name: schema.players.name })
    .from(schema.players)
    .where(eq(schema.players.season, season))
  return new Map(rows.map((row) => [row.name, row.id]))
}
