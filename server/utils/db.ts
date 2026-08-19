import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../database/schema'

/**
 * Un solo pool per processo. Durante l'HMR di `nuxt dev` il modulo viene
 * rivalutato: senza questa cache globale si accumulerebbero pool e connessioni.
 */
const globalForDb = globalThis as unknown as { __fantabroPool?: Pool }

/**
 * Precedenza `NUXT_DATABASE_URL` (runtime config) -> `DATABASE_URL`.
 * Esportata perché il listener SSE ha bisogno di un `pg.Client` dedicato (un
 * `LISTEN` non può stare su una connessione del pool): meglio riusare questa
 * che duplicare la precedenza altrove.
 */
export function resolveConnectionString(): string {
  let fromRuntimeConfig: string | undefined
  try {
    fromRuntimeConfig = useRuntimeConfig().databaseUrl
  } catch {
    // Fuori da Nitro (script CLI, test) `useRuntimeConfig` non esiste.
  }
  const connectionString = fromRuntimeConfig || process.env.DATABASE_URL
  if (!connectionString) {
    // Mai includere il valore in un messaggio: contiene le credenziali.
    throw new Error('DATABASE_URL non configurata')
  }
  return connectionString
}

export function getPool(): Pool {
  if (!globalForDb.__fantabroPool) {
    globalForDb.__fantabroPool = new Pool({ connectionString: resolveConnectionString() })
  }
  return globalForDb.__fantabroPool
}

export const db = drizzle(getPool(), { schema })

export type Db = typeof db
/** La transazione passata a `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/**
 * Firma accettata dai repository: la stessa funzione vale dentro e fuori una
 * transazione, così i servizi possono comporre più repository atomicamente.
 */
export type DbOrTx = Db | Tx

export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn)
}
