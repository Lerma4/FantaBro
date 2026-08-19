import { execSync } from 'node:child_process'
import { get, type IncomingMessage } from 'node:http'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { beforeAll, describe, expect, it } from 'vitest'
import { fetch, setup, url } from '@nuxt/test-utils/e2e'
import { withTransaction } from '../../server/utils/db'
import { publishAuctionChange, type AuctionChangePayload } from '../../server/utils/events'
import { subscribeToAuction } from '../../server/utils/sse'
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

const NEWLINE = String.fromCharCode(10)

let cookie = ''
let auction: AuctionSummary
let players: PlayerRow[] = []

/** Nome + squadra: il database e condiviso e un omonimo di un'altra suite e possibile. */
function id(name: string): string {
  const row = players.find((player) => player.name === name && player.team === 'Inter')
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

/** Apre uno stream SSE e accumula i chunk cosi come arrivano dal socket. */
async function openStream(path: string): Promise<{ response: IncomingMessage; chunks: string[] }> {
  const chunks: string[] = []
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(
      url(path),
      { headers: { cookie, accept: 'text/event-stream' } },
      (incoming) => {
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk: string) => chunks.push(chunk))
        incoming.on('error', () => {})
        resolve(incoming)
      }
    )
    request.on('error', reject)
  })
  return { response, chunks }
}

/** Attende una condizione invece di scommettere su un ritardo fisso. */
async function until(ready: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!ready() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** Listone col filtro di default: solo i giocatori ancora disponibili (spec 17). */
async function availableNames(): Promise<string[]> {
  const { body } = await call(`/api/auctions/${auction.id}/players`)
  return (body.rows as PlayerRow[]).map((row) => row.name)
}

describe.skipIf(!hasDatabase)('flusso d asta end to end', async () => {
  // `setup` registra da se i propri hook: va chiamata a livello di describe, non dentro
  // un `beforeAll`, altrimenti `fetch` non conosce l'URL del server di test.
  if (hasDatabase) await setup({ server: true, buildDir: E2E_BUILD_DIR })

  // La suite si semina da se: i test di integrazione ripuliscono le tabelle, quindi
  // l'utente ADMIN non si puo dare per esistente. `db:seed` e idempotente.
  //
  // Va **dopo** `setup`: registrato qui l'hook gira a build finita, mentre seminare in
  // fase di collect lascia i ~100 secondi della build a disposizione di un'altra suite
  // per ripulire le tabelle.
  beforeAll(() => {
    execSync('pnpm db:seed', { stdio: 'pipe' })
  }, 60_000)

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

    // Nessun conteggio assoluto: il listone della stagione e condiviso con le altre suite
    // che girano sullo stesso database. Conta che i giocatori importati ci siano.
    const imported = LISTONE.slice(3).map((row) => row[3])
    const mine = players.filter((row) => imported.includes(row.name) && row.team === 'Inter')
    expect(mine.map((row) => row.name).sort()).toEqual([...imported].sort())
    expect(mine.every((row) => row.status === 'AVAILABLE')).toBe(true)
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

  it('11. apre subito lo stream e ci propaga i cambiamenti', async () => {
    // Lettura con `node:http`: il `fetch` di test-utils non consegna i chunk successivi
    // finche la risposta resta aperta, quindi misurerebbe il client invece del server.
    const playerId = id('Sommer')
    const openedAt = Date.now()
    const { response, chunks } = await openStream(`/api/auctions/${auction.id}/stream`)
    const body = () => chunks.join('')

    let ticker: ReturnType<typeof setInterval> | undefined
    try {
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/event-stream')
      // Nessun buffering sui proxy: senza questo header nginx accumulerebbe lo stream.
      expect(response.headers['x-accel-buffering']).toBe('no')

      // Regressione: il primo evento parte all'apertura. Con `createEventStream` di h3 le
      // intestazioni restavano in coda fino al keep-alive e un `EventSource` non si
      // connetteva per 25 secondi.
      await until(() => body().includes('event: auction:changed'), 5_000)
      expect(Date.now() - openedAt, 'stato iniziale').toBeLessThan(5_000)

      // Il `LISTEN` si collega in modo asincrono: un target si puo aggiornare piu volte
      // senza effetti collaterali, quindi si ritenta invece di fissare un ritardo.
      const changedAt = Date.now()
      ticker = setInterval(() => {
        void call(`/api/auctions/${auction.id}/targets`, {
          body: { playerId, tier: 'A' },
        }).catch(() => {})
      }, 500)

      await until(() => body().includes(playerId), 15_000)
      expect(Date.now() - changedAt, 'latenza della notifica').toBeLessThan(15_000)
    } finally {
      clearInterval(ticker)
      response.destroy()
    }

    const frames = body()
      .split('event: auction:changed')
      .slice(1)
      .map((frame) => frame.split(NEWLINE)[1]!.slice('data: '.length))
    expect(frames.length).toBeGreaterThan(1)

    // Primo frame: lo stato corrente, `playerIds` vuoto = "ricarica tutto". Chi si collega
    // non deve chiedere `/state` a parte.
    const initial = JSON.parse(frames[0]!) as { state: AuctionState; playerIds: string[] }
    expect(initial.playerIds).toEqual([])
    expect(initial.state.remainingBudget).toBe(100)

    // Frame del cambiamento: nomina il giocatore toccato e porta lo stato ricalcolato.
    const change = JSON.parse(frames.find((frame) => frame.includes(playerId))!) as {
      state: AuctionState
      playerIds: string[]
    }
    expect(change.playerIds).toEqual([playerId])
    expect(change.state.initialBudget).toBe(100)
  }, 60_000)

  /**
   * Due richieste HTTP concorrenti sullo stesso giocatore: la contesa e reale, non
   * simulata, e passa da `purchasePlayer` invece di riprodurne la sequenza a mano.
   * Un giocatore non si compra due volte (spec 48).
   */
  it('12. su due acquisti dello stesso giocatore ne accetta uno solo', async () => {
    const playerId = id('Bastoni')
    const [first, second] = await Promise.all([
      call(`/api/auctions/${auction.id}/purchases`, { body: { playerId, price: 10 } }),
      call(`/api/auctions/${auction.id}/purchases`, { body: { playerId, price: 10 } }),
    ])

    const codes = [first.status, second.status].sort()
    expect(codes).toEqual([200, 409])
    expect([first, second].find((r) => r.status === 409)).toMatchObject({
      body: { data: { code: 'PLAYER_ALREADY_OWNED' } },
    })

    const roster = await call(`/api/auctions/${auction.id}/roster`)
    expect(roster.body.players as { playerId: string }[]).toHaveLength(1)
  })

  /**
   * Due acquisti concorrenti di giocatori **diversi** che stanno nel budget solo uno per
   * volta: e il caso che il vincolo unico non protegge e che `lockAuction` esiste per
   * chiudere. L'asserzione che conta e l'ultima: la rosa non sfora il budget iniziale.
   */
  it('13. su due acquisti diversi che sforerebbero il budget ne accetta uno solo', async () => {
    // Dopo il passo 12: 10 spesi, 90 residui, slot P e A liberi. Due da 60 non ci stanno.
    const [first, second] = await Promise.all([
      call(`/api/auctions/${auction.id}/purchases`, {
        body: { playerId: id('Sommer'), price: 60 },
      }),
      call(`/api/auctions/${auction.id}/purchases`, {
        body: { playerId: id('Lautaro'), price: 60 },
      }),
    ])

    const accepted = [first, second].filter((response) => response.status === 200)
    const rejected = [first, second].filter((response) => response.status !== 200)
    expect(accepted).toHaveLength(1)

    // Quale dei due controlli scatti dipende dai numeri, non e il punto del test.
    expect(rejected[0]!.status).toBe(422)
    expect(errorCode(rejected[0]!.body)).toBeOneOf([
      'BUDGET_EXCEEDED',
      'REMAINING_SLOTS_UNFILLABLE',
    ])

    // La garanzia: nessuna combinazione di richieste concorrenti sfora il budget.
    const roster = await call(`/api/auctions/${auction.id}/roster`)
    const spent = (roster.body.players as { purchasePrice: number }[]).reduce(
      (total, player) => total + player.purchasePrice,
      0
    )
    expect(spent).toBe(70)
    expect(spent).toBeLessThanOrEqual(auction.initialBudget)
  })
})

/**
 * Il giro `pg_notify` -> `LISTEN` -> sottoscrittori, senza HTTP di mezzo: se lo stream SSE
 * si guasta, questi due test dicono se la colpa e del bus o della risposta.
 *
 * Sta in questo file e non in uno suo perche il progetto `e2e` esegue i file in worker
 * paralleli: due worker che costruiscono Nitro e aprono pool insieme si disturbano.
 */
describe.skipIf(!hasDatabase)('bus di notifica delle aste', () => {
  const busAuctionId = '00000000-0000-4000-8000-0000000000ff'

  it('consegna al sottoscrittore una notifica emessa in transazione', async () => {
    const received: AuctionChangePayload[] = []
    const unsubscribe = subscribeToAuction(busAuctionId, (payload) => received.push(payload))

    try {
      // Il `LISTEN` si collega in modo asincrono: si ripubblica finche non arriva.
      const deadline = Date.now() + 10_000
      while (received.length === 0 && Date.now() < deadline) {
        await withTransaction((tx) =>
          publishAuctionChange(tx, busAuctionId, { playerIds: ['p-1'], eventId: 'e-1' })
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      expect(received[0]).toEqual({
        auctionId: busAuctionId,
        playerIds: ['p-1'],
        eventId: 'e-1',
      })
    } finally {
      unsubscribe()
    }
  }, 20_000)

  it('non consegna a chi e sottoscritto a un altra asta', async () => {
    const other: AuctionChangePayload[] = []
    const unsubscribe = subscribeToAuction('00000000-0000-4000-8000-0000000000fe', (payload) =>
      other.push(payload)
    )

    try {
      await withTransaction((tx) => publishAuctionChange(tx, busAuctionId, { playerIds: ['p-2'] }))
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(other).toEqual([])
    } finally {
      unsubscribe()
    }
  }, 20_000)
})
