import { Client } from 'pg'
import { resolveConnectionString } from './db'
import { AUCTION_CHANNEL, type AuctionChangePayload } from './events'

export type AuctionChangeListener = (payload: AuctionChangePayload) => void

/**
 * Un solo listener `LISTEN/NOTIFY` per istanza Nitro, condiviso da tutte le connessioni SSE.
 * Serve una connessione dedicata: `LISTEN` non puo vivere su una connessione restituita al
 * pool. Con piu replica ognuna ha il suo listener e riceve le stesse notifiche (spec 47).
 */
const subscribers = new Map<string, Set<AuctionChangeListener>>()

const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 500

let client: Client | null = null
let connecting = false
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

function dispatch(raw: string | undefined): void {
  if (!raw) return

  let payload: AuctionChangePayload
  try {
    payload = JSON.parse(raw) as AuctionChangePayload
  } catch {
    return
  }

  const listeners = subscribers.get(payload.auctionId)
  if (!listeners) return
  for (const listener of listeners) listener(payload)
}

function scheduleReconnect(): void {
  if (retryTimer || subscribers.size === 0) return
  const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** retries)
  retries += 1
  retryTimer = setTimeout(() => {
    retryTimer = null
    void connect()
  }, delay)
  // Il timer di riconnessione non deve tenere in vita il processo.
  retryTimer.unref?.()
}

async function connect(): Promise<void> {
  if (client || connecting) return
  connecting = true

  // Stessa connection string del pool, risolta in un solo punto (`utils/db.ts`).
  const next = new Client({ connectionString: resolveConnectionString() })

  const drop = () => {
    if (client !== next) return
    client = null
    void next.end().catch(() => {})
    scheduleReconnect()
  }
  next.on('error', drop)
  next.on('end', drop)
  next.on('notification', (message) => dispatch(message.payload))

  try {
    await next.connect()
    await next.query(`LISTEN ${AUCTION_CHANNEL}`)
    client = next
    retries = 0
  } catch {
    void next.end().catch(() => {})
    scheduleReconnect()
  } finally {
    connecting = false
  }
}

/**
 * Sottoscrive i cambiamenti di un'asta. Restituisce la funzione di disiscrizione: va
 * chiamata sempre alla chiusura della richiesta, altrimenti il set cresce senza limiti.
 *
 * ponytail: le notifiche perse durante una riconnessione non vengono recuperate; il client
 * SSE rilegge lo stato completo alla riapertura, che e il modo piu semplice di ripartire.
 */
export function subscribeToAuction(auctionId: string, listener: AuctionChangeListener): () => void {
  const listeners = subscribers.get(auctionId) ?? new Set<AuctionChangeListener>()
  listeners.add(listener)
  subscribers.set(auctionId, listeners)

  void connect()

  return () => {
    const current = subscribers.get(auctionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) subscribers.delete(auctionId)
  }
}
