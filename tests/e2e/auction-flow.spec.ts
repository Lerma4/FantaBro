import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import type { AuctionEventRow, AuctionState, AuctionSummary, PlayerRow } from '#shared/types'

/**
 * Prova che il sistema si **componga**: server Nitro reale, PostgreSQL reale, sessione
 * Better Auth reale, XLSX reale. Le regole di dominio sono gia coperte dai test unitari:
 * qui interessa che route, guardie, validazione, transazioni e SSE esistano davvero e
 * parlino fra loro.
 *
 * Si auto-salta senza `DATABASE_URL`, come i test di integrazione.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

/** Build stabile invece della cartella casuale di test-utils, che su Windows sparisce. */
const E2E_BUILD_DIR = fileURLToPath(new URL('../../.nuxt/e2e', import.meta.url))
if (hasDatabase) mkdirSync(E2E_BUILD_DIR, { recursive: true })

const SEASON = '2026/27'
const CREDENTIALS = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@fantabro.local',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'fantabro-dev-1234',
}

/** Listone minimo con due difensori: bastano per esaurire uno slot di ruolo. */
const LISTONE = [
  ['Quotazioni Fantacalcio Stagione 2026 27'],
  [],
  ['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'FVM'],
  ['2170', 'P', 'Por', 'Sommer', 'Inter', 5, 12],
  ['4220', 'D', 'Ds;E', 'Dimarco', 'Inter', 18, 120],
  ['4221', 'D', 'Dc', 'Bastoni', 'Inter', 15, 90],
  ['5100', 'C', 'M', 'Barella', 'Inter', 20, 150],
  ['6100', 'A', 'Pc', 'Lautaro', 'Inter', 40, 300],
]

/**
 * Un solo buffer per tutta la suite. ExcelJS scrive un timestamp di creazione nel file,
 * quindi rigenerarlo produrrebbe byte diversi e il `previewToken` della preview non
 * combacerebbe piu in conferma: e esattamente il controllo che deve scattare, ma qui
 * si sta caricando lo stesso file due volte.
 */
let listoneBuffer: Buffer | undefined

async function listoneXlsx(): Promise<Buffer> {
  if (!listoneBuffer) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Tutti')
    for (const row of LISTONE) sheet.addRow(row)
    listoneBuffer = Buffer.from(await workbook.xlsx.writeBuffer())
  }
  return listoneBuffer
}

let cookie = ''
let auction: AuctionSummary
let players: PlayerRow[] = []

function id(name: string): string {
  const row = players.find((player) => player.name === name)
  if (!row) throw new Error(`giocatore ${name} non importato`)
  return row.playerId
}

/** `fetch` autenticato che restituisce status e body gia decodificato. */
async function call(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(path, {
    method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
    redirect: 'manual',
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : {} }
}

/** Il codice stabile sta in `data.code`; l'involucro intorno e di Nitro. */
function errorCode(body: Record<string, unknown>): unknown {
  return (body.data as { code?: unknown } | undefined)?.code
}

async function uploadListone(
  path: string,
  fields: Record<string, string>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(await listoneXlsx())]), 'listone.xlsx')
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return call(path, { form })
}

/** Listone col filtro di default: solo i giocatori ancora disponibili (spec 17). */
async function availableNames(): Promise<string[]> {
  const { body } = await call(`/api/auctions/${auction.id}/players`)
  return (body.rows as PlayerRow[]).map((row) => row.name)
}

describe.skipIf(!hasDatabase)('flusso d asta end to end', async () => {
  // La suite si semina da se: i test di integrazione ripuliscono le tabelle, quindi
  // l'utente ADMIN non si puo dare per esistente. `db:seed` e idempotente.
  if (hasDatabase) execSync('pnpm db:seed', { stdio: 'pipe' })

  // `setup` registra da se i propri hook: va chiamata a livello di describe, non dentro
  // un `beforeAll`, altrimenti `fetch` non conosce l'URL del server di test.
  if (hasDatabase) await setup({ server: true, buildDir: E2E_BUILD_DIR })

  it('1. rifiuta una route d asta senza sessione', async () => {
    const response = await fetch('/api/auctions', { redirect: 'manual' })
    expect(response.status).toBe(401)
    expect(errorCode(await response.json())).toBe('UNAUTHORIZED')
  })

  it('2. accetta il login dell utente seed e restituisce un cookie di sessione', async () => {
    const response = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREDENTIALS),
      redirect: 'manual',
    })
    expect(response.status).toBe(200)

    const session = response.headers.getSetCookie().find((entry) => entry.includes('session_token'))
    expect(session).toBeTruthy()
    cookie = session!.split(';')[0]!

    const me = await call('/api/me')
    expect(me.status).toBe(200)
    expect((me.body.user as { email: string }).email).toBe(CREDENTIALS.email)
  })

  it('3. crea un asta con budget e slot piccoli', async () => {
    const created = await call('/api/auctions', {
      body: {
        // Nome con timestamp: piu esecuzioni non si pestano i piedi.
        name: `E2E ${Date.now()}`,
        season: SEASON,
        mode: 'CLASSIC',
        initialBudget: 100,
        minimumPlayerCost: 1,
        roleSlots: { P: 1, D: 1, C: 1, A: 1 },
      },
    })
    expect(created.status).toBe(200)

    auction = created.body as unknown as AuctionSummary
    expect(auction.memberRole).toBe('OWNER')
    expect(auction.initialBudget).toBe(100)
  })

  it('4. importa il listone da un XLSX vero, con preview e conferma', async () => {
    const preview = await uploadListone(`/api/auctions/${auction.id}/import/preview`, {
      season: SEASON,
      sheet: 'Tutti',
    })
    expect(preview.status, JSON.stringify(preview.body)).toBe(200)
    expect(preview.body.importable).toBe(true)
    expect(preview.body.previewToken).toBeTruthy()

    const confirmed = await uploadListone(`/api/auctions/${auction.id}/import/confirm`, {
      season: SEASON,
      sheet: 'Tutti',
      previewToken: preview.body.previewToken as string,
    })
    expect(confirmed.status).toBe(200)
    // Su una riesecuzione i giocatori esistono gia: conta la somma, non i soli inseriti.
    expect((confirmed.body.imported as number) + (confirmed.body.updated as number)).toBe(5)
  })

  it('5. mostra i giocatori importati, tutti disponibili', async () => {
    const { status, body } = await call(`/api/auctions/${auction.id}/players`)
    expect(status).toBe(200)

    players = body.rows as PlayerRow[]
    expect(players).toHaveLength(5)
    expect(players.every((row) => row.status === 'AVAILABLE')).toBe(true)
    expect(body.statsSeason).toBeDefined()
    expect(body.teams).toContain('Inter')
  })

  it('6. registra un acquisto e restituisce uno stato coerente con la formula', async () => {
    const { status, body } = await call(`/api/auctions/${auction.id}/purchases`, {
      body: { playerId: id('Dimarco'), price: 40 },
    })
    expect(status).toBe(200)

    const auctionState = body.state as AuctionState
    expect(auctionState.spent).toBe(40)
    expect(auctionState.remainingBudget).toBe(60)
    expect(auctionState.occupiedSlots).toBe(1)
    expect(auctionState.slots.find((slot) => slot.role === 'D')).toMatchObject({
      occupied: 1,
      free: 0,
    })
    // maxBid = residuo - (slot residui - 1) * costo minimo = 60 - 2 * 1
    expect(auctionState.maxBid).toBe(58)
    expect((body.row as PlayerRow).status).toBe('MY_PLAYER')
  })

  it('7. rifiuta doppio acquisto, slot pieno e prezzo oltre il budget', async () => {
    const again = await call(`/api/auctions/${auction.id}/purchases`, {
      body: { playerId: id('Dimarco'), price: 10 },
    })
    expect(again.status).toBe(409)
    expect(errorCode(again.body)).toBe('PLAYER_ALREADY_OWNED')

    const slotFull = await call(`/api/auctions/${auction.id}/purchases`, {
      body: { playerId: id('Bastoni'), price: 10 },
    })
    expect(slotFull.status).toBe(422)
    expect(errorCode(slotFull.body)).toBe('ROLE_SLOTS_FULL')

    const tooExpensive = await call(`/api/auctions/${auction.id}/purchases`, {
      body: { playerId: id('Lautaro'), price: 70 },
    })
    expect(tooExpensive.status).toBe(422)
    expect(errorCode(tooExpensive.body)).toBe('BUDGET_EXCEEDED')
  })

  it('8. toglie il giocatore comprato dal listone di default', async () => {
    expect(await availableNames()).not.toContain('Dimarco')
  })

  it('9. marca SOLD senza prezzo ne squadra, lasciando budget e slot invariati', async () => {
    const { status, body } = await call(`/api/auctions/${auction.id}/sold`, {
      body: { playerId: id('Barella') },
    })
    expect(status).toBe(200)

    const auctionState = body.state as AuctionState
    expect(auctionState.spent).toBe(40)
    expect(auctionState.remainingBudget).toBe(60)
    expect(auctionState.occupiedSlots).toBe(1)
    expect(await availableNames()).not.toContain('Barella')
  })

  it('10. registra gli eventi e annulla l acquisto riportando lo stato indietro', async () => {
    const { status, body } = await call(`/api/auctions/${auction.id}/events`)
    expect(status).toBe(200)

    const events = body.rows as AuctionEventRow[]
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['IMPORT_COMPLETED', 'PLAYER_PURCHASED', 'PLAYER_SOLD'])
    )

    const purchase = events.find((event) => event.type === 'PLAYER_PURCHASED')!
    const reverted = await call(`/api/auctions/${auction.id}/events/revert`, {
      body: { eventId: purchase.id },
    })
    expect(reverted.status).toBe(200)

    const auctionState = reverted.body.state as AuctionState
    expect(auctionState.spent).toBe(0)
    expect(auctionState.remainingBudget).toBe(100)
    expect(auctionState.occupiedSlots).toBe(0)
    expect(await availableNames()).toContain('Dimarco')
  })

  it('11. propaga un acquisto ai client SSE', async () => {
    const stream = await fetch(`/api/auctions/${auction.id}/stream`, {
      headers: { cookie, accept: 'text/event-stream' },
      redirect: 'manual',
    })
    expect(stream.status).toBe(200)

    const reader = stream.body!.getReader()
    const decoder = new TextDecoder()

    // Il listener `LISTEN` si collega in modo asincrono: finche non e pronto la NOTIFY
    // andrebbe persa. Un target si puo aggiornare piu volte senza effetti collaterali,
    // quindi si ritenta invece di scommettere su un ritardo fisso.
    let buffer = ''
    const t0 = Date.now()
    const deadline = t0 + 20_000
    let ticker: ReturnType<typeof setInterval> | undefined

    try {
      const playerId = id('Sommer')
      ticker = setInterval(() => {
        void call(`/api/auctions/${auction.id}/targets`, {
          body: { playerId, tier: 'A' },
        }).catch(() => {})
      }, 500)

      while (!buffer.includes('event: auction:changed') && Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
      }
    } finally {
      clearInterval(ticker)
      await reader.cancel()
    }

    expect(buffer, `arrivato dopo ${Date.now() - t0}ms`).toContain('event: auction:changed')
    // Durante un'asta un aggiornamento in ritardo non serve a niente: se questo fallisce
    // vicino ai 25s del keep-alive, lo stream sta accumulando invece di scrivere subito.
    expect(Date.now() - t0).toBeLessThan(5_000)
    // La notifica porta lo stato ricalcolato e i giocatori toccati.
    const payload = buffer
      .split('event: auction:changed')[1]!
      .split('\n')[1]!
      .slice('data: '.length)
    const change = JSON.parse(payload) as { state: AuctionState; playerIds: string[] }
    expect(change.playerIds).toContain(id('Sommer'))
    expect(change.state.initialBudget).toBe(100)
  }, 60_000)
})
