import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { playerListFilterSchema } from '#shared/schemas'
import {
  ensureAuctionPlayers,
  listPurchaseFacts,
  listSoldFacts,
  lockAuctionPlayer,
  setStatus,
} from '../../server/repositories/auctionPlayers'
import { listAuctionsForUser, lockAuction } from '../../server/repositories/auctions'
import {
  appendEvent,
  findEventById,
  listEvents,
  markEventReverted,
} from '../../server/repositories/events'
import { addMember, findMembership, listMembers } from '../../server/repositories/members'
import {
  countPlayersForSeason,
  listPlayerRows,
  upsertPlayers,
} from '../../server/repositories/players'
import { addRosterPlayer, getRosterId, listRoster } from '../../server/repositories/roster'
import { getSetting, setSetting } from '../../server/repositories/settings'
import {
  findLatestStatsSeason,
  resolvePlayerIdsByName,
  upsertSeasonStats,
} from '../../server/repositories/stats'
import { upsertTarget } from '../../server/repositories/targets'
import {
  SEASON,
  acquireSuite,
  createTestAuction,
  createUser,
  hasDatabase,
  player,
  releaseSuite,
  seedPlayers,
  testDb,
  truncateAll,
} from './helpers'

/**
 * Un solo file: i test condividono lo stesso database e ripuliscono le tabelle
 * fra un caso e l'altro, quindi non possono girare in parallelo con altri file.
 */
const filter = (overrides: Record<string, unknown> = {}) => playerListFilterSchema.parse(overrides)

describe.skipIf(!hasDatabase)('repository giocatori', () => {
  let userId: string
  let auctionId: string

  beforeAll(acquireSuite)
  afterAll(releaseSuite)

  beforeEach(async () => {
    await truncateAll()
    userId = await createUser()
    auctionId = await createTestAuction(userId)
  })

  it('importa il listone in modo idempotente', async () => {
    const listone = [
      player({ name: 'Sommer', team: 'Inter', role: 'P', quotation: 12, fvm: 40 }),
      player({ name: 'Bastoni', team: 'Inter', role: 'D', quotation: 15, fvm: 70 }),
    ]

    const first = await upsertPlayers(testDb(), SEASON, listone)
    expect(first.inserted).toBe(2)
    expect(first.updated).toBe(0)

    const second = await upsertPlayers(testDb(), SEASON, [
      ...listone.slice(0, 1),
      player({ name: 'Bastoni', team: 'Inter', role: 'D', quotation: 18, fvm: 80 }),
    ])
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(2)
    expect(await countPlayersForSeason(testDb(), SEASON)).toBe(2)

    const { rows } = await listPlayerRows(testDb(), auctionId, filter(), null)
    expect(rows.find((row) => row.name === 'Bastoni')?.fvm).toBe(80)
  })

  it('lo stesso nome in due squadre diverse resta un giocatore distinto', async () => {
    await upsertPlayers(testDb(), SEASON, [
      player({ name: 'Rossi', team: 'Inter' }),
      player({ name: 'Rossi', team: 'Milan' }),
    ])
    expect(await countPlayersForSeason(testDb(), SEASON)).toBe(2)
  })

  it('per default esclude i giocatori presi e quelli venduti', async () => {
    const ids = await seedPlayers([
      player({ name: 'Disponibile' }),
      player({ name: 'Mio' }),
      player({ name: 'Venduto' }),
    ])

    const rosterId = await getRosterId(testDb(), auctionId)
    await addRosterPlayer(testDb(), rosterId, ids.get('Mio')!, 30)
    await setStatus(testDb(), auctionId, ids.get('Mio')!, {
      status: 'MY_PLAYER',
      updatedBy: userId,
    })
    await setStatus(testDb(), auctionId, ids.get('Venduto')!, {
      status: 'SOLD',
      soldPrice: 42,
      otherTeamName: 'Altra squadra',
      updatedBy: userId,
    })

    const available = await listPlayerRows(testDb(), auctionId, filter(), null)
    expect(available.rows.map((row) => row.name)).toEqual(['Disponibile'])
    expect(available.total).toBe(1)

    const all = await listPlayerRows(testDb(), auctionId, filter({ status: 'ALL' }), null)
    expect(all.total).toBe(3)

    const sold = await listPlayerRows(testDb(), auctionId, filter({ status: 'SOLD' }), null)
    expect(sold.rows[0]).toMatchObject({
      name: 'Venduto',
      soldPrice: 42,
      otherTeamName: 'Altra squadra',
    })

    const mine = await listPlayerRows(testDb(), auctionId, filter({ status: 'MY_PLAYER' }), null)
    expect(mine.rows[0]?.purchasePrice).toBe(30)
  })

  /**
   * Scrittura (`search_name` allo import) e lettura (filtro `q`) devono usare la
   * **stessa** normalizzazione, quella di `#shared/utils/normalize`. Se divergessero
   * si troverebbero giocatori che lo import statistiche non riesce ad agganciare.
   * I due casi che le distinguono: accento combinante e apostrofo tipografico.
   */
  it('cerca per nome ignorando maiuscole, accenti e apostrofi tipografici', async () => {
    await seedPlayers([
      player({ name: 'Vlahović' }),
      player({ name: 'D’Ambrosio' }),
      player({ name: 'Lautaro' }),
    ])

    const accented = await listPlayerRows(testDb(), auctionId, filter({ q: 'vlahovic' }), null)
    expect(accented.rows.map((row) => row.name)).toEqual(['Vlahović'])

    const apostrophe = await listPlayerRows(testDb(), auctionId, filter({ q: "d'ambrosio" }), null)
    expect(apostrophe.rows.map((row) => row.name)).toEqual(['D’Ambrosio'])

    // Lo stesso nome trovato anche scrivendo l'apostrofo tipografico.
    const typographic = await listPlayerRows(testDb(), auctionId, filter({ q: 'D’AMBROSIO' }), null)
    expect(typographic.rows.map((row) => row.name)).toEqual(['D’Ambrosio'])

    const wildcard = await listPlayerRows(testDb(), auctionId, filter({ q: '%' }), null)
    expect(wildcard.total).toBe(0)
  })

  /** Il match nome -> playerId dello import statistiche usa la stessa normalizzazione. */
  it('resolvePlayerIdsByName aggancia nomi scritti in ASCII semplice', async () => {
    const ids = await seedPlayers([player({ name: 'Vlahović' }), player({ name: 'D’Ambrosio' })])

    const resolved = await resolvePlayerIdsByName(testDb(), SEASON, [
      'vlahovic',
      "D'AMBROSIO",
      'Inesistente',
    ])
    expect(resolved.get('vlahovic')).toBe(ids.get('Vlahović'))
    expect(resolved.get("d'ambrosio")).toBe(ids.get('D’Ambrosio'))
    expect(resolved.has('inesistente')).toBe(false)
  })

  it('filtra per intervallo di FVM e ordina', async () => {
    await seedPlayers([
      player({ name: 'Basso', fvm: 10 }),
      player({ name: 'Medio', fvm: 50 }),
      player({ name: 'Alto', fvm: 90 }),
    ])

    const range = await listPlayerRows(
      testDb(),
      auctionId,
      filter({ fvmMin: 20, fvmMax: 95 }),
      null
    )
    expect(range.rows.map((row) => row.name)).toEqual(['Alto', 'Medio'])

    const ascending = await listPlayerRows(
      testDb(),
      auctionId,
      filter({ sort: 'fvm', dir: 'asc' }),
      null
    )
    expect(ascending.rows.map((row) => row.name)).toEqual(['Basso', 'Medio', 'Alto'])
  })

  it('unisce le statistiche solo della stagione richiesta', async () => {
    const ids = await seedPlayers([player({ name: 'Statistico' })])
    const playerId = ids.get('Statistico')!

    await upsertSeasonStats(testDb(), [
      {
        playerId,
        season: '2025/26',
        appearances: 30,
        starts: 28,
        minutes: 2500,
        averageRating: 6.4,
        fantasyAverage: 7.1,
        goals: 9,
        assists: 4,
        yellowCards: 3,
        redCards: 0,
        penaltiesScored: 2,
        penaltiesMissed: 0,
        goalsConceded: null,
        penaltiesSaved: null,
        provider: 'excel',
        updatedAt: new Date(),
      },
    ])

    const withStats = await listPlayerRows(testDb(), auctionId, filter(), '2025/26')
    expect(withStats.rows[0]).toMatchObject({
      statsSeason: '2025/26',
      appearances: 30,
      fantasyAverage: 7.1,
    })

    const otherSeason = await listPlayerRows(testDb(), auctionId, filter(), '2024/25')
    expect(otherSeason.rows[0]?.statsSeason).toBeNull()

    const filtered = await listPlayerRows(
      testDb(),
      auctionId,
      filter({ appearancesMin: 31 }),
      '2025/26'
    )
    expect(filtered.total).toBe(0)
  })

  it('filtra per tier e per soli target', async () => {
    const ids = await seedPlayers([player({ name: 'Target' }), player({ name: 'Altro' })])
    await upsertTarget(testDb(), auctionId, ids.get('Target')!, {
      tier: 'A',
      isTarget: true,
      maxPrice: 60,
    })

    const onlyTargets = await listPlayerRows(
      testDb(),
      auctionId,
      filter({ onlyTargets: true }),
      null
    )
    expect(onlyTargets.rows.map((row) => row.name)).toEqual(['Target'])
    expect(onlyTargets.rows[0]?.maxPrice).toBe(60)

    const byTier = await listPlayerRows(testDb(), auctionId, filter({ tier: 'B' }), null)
    expect(byTier.total).toBe(0)
  })

  it('restituisce il totale anche con offset oltre la fine', async () => {
    await seedPlayers([player({ name: 'Uno' }), player({ name: 'Due' })])
    const page = await listPlayerRows(testDb(), auctionId, filter({ limit: 1, offset: 5 }), null)
    expect(page.rows).toHaveLength(0)
    expect(page.total).toBe(2)
  })

  it('non mostra giocatori di una stagione diversa da quella dell asta', async () => {
    await seedPlayers([player({ name: 'Vecchio' })], '2020/21')
    const rows = await listPlayerRows(testDb(), auctionId, filter(), null)
    expect(rows.total).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('repository asta', () => {
  let userId: string
  let auctionId: string

  beforeAll(acquireSuite)
  afterAll(releaseSuite)

  beforeEach(async () => {
    await truncateAll()
    userId = await createUser()
    auctionId = await createTestAuction(userId)
  })

  it('crea la rosa e la membership OWNER insieme all asta', async () => {
    expect(await findMembership(testDb(), auctionId, userId)).toMatchObject({ role: 'OWNER' })
    expect(await getRosterId(testDb(), auctionId)).toEqual(expect.any(String))

    const summaries = await listAuctionsForUser(testDb(), userId)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ memberRole: 'OWNER', playersCount: 0, season: SEASON })
  })

  /**
   * `playersCount` conta il listone della stagione, non la rosa: deve restare
   * identico a `countPlayersForSeason`, che usa il livello servizi per lo stesso
   * campo. Comprarne uno non cambia il numero.
   */
  it('playersCount coincide con countPlayersForSeason', async () => {
    const ids = await seedPlayers([
      player({ name: 'Comprato' }),
      player({ name: 'Libero' }),
      player({ name: 'Altro' }),
    ])
    const rosterId = await getRosterId(testDb(), auctionId)
    await addRosterPlayer(testDb(), rosterId, ids.get('Comprato')!, 25)

    const summaries = await listAuctionsForUser(testDb(), userId)
    expect(summaries[0]?.playersCount).toBe(3)
    expect(summaries[0]?.playersCount).toBe(await countPlayersForSeason(testDb(), SEASON))
  })

  it('lockAuction blocca la riga d asta e restituisce null se non esiste', async () => {
    const locked = await testDb().transaction((tx) => lockAuction(tx, auctionId))
    expect(locked).toMatchObject({ id: auctionId, season: SEASON })

    const missing = await testDb().transaction((tx) =>
      lockAuction(tx, '00000000-0000-4000-8000-000000000000')
    )
    expect(missing).toBeNull()
  })

  /**
   * Spec §48: due acquisti di giocatori **diversi** nella stessa asta possono
   * sforare il budget, perché prendono lock su righe `auction_players` diverse.
   * `lockAuction` li serializza sulla riga d'asta.
   */
  it('lockAuction serializza operazioni su giocatori diversi della stessa asta', async () => {
    const ids = await seedPlayers([player({ name: 'Primo' }), player({ name: 'Secondo' })])
    const rosterId = await getRosterId(testDb(), auctionId)
    const order: string[] = []

    const spend = (name: string) =>
      testDb().transaction(async (tx) => {
        await lockAuction(tx, auctionId)
        // Legge lo speso, attende, poi scrive: senza il lock le due letture
        // vedrebbero lo stesso totale e il budget sforerebbe.
        const before = (await listPurchaseFacts(tx, auctionId)).length
        await new Promise((resolve) => setTimeout(resolve, 50))
        await addRosterPlayer(tx, rosterId, ids.get(name)!, 30)
        order.push(`${name}:${before}`)
      })

    await Promise.all([spend('Primo'), spend('Secondo')])
    // La seconda transazione ha visto l'acquisto della prima: 0 poi 1.
    expect(order.map((entry) => entry.split(':')[1]).sort()).toEqual(['0', '1'])
    expect(await listPurchaseFacts(testDb(), auctionId)).toHaveLength(2)
  })

  it('rifiuta il secondo acquisto dello stesso giocatore', async () => {
    const ids = await seedPlayers([player({ name: 'Unico' })])
    const rosterId = await getRosterId(testDb(), auctionId)
    await addRosterPlayer(testDb(), rosterId, ids.get('Unico')!, 30)

    await expect(addRosterPlayer(testDb(), rosterId, ids.get('Unico')!, 31)).rejects.toThrow()
    expect(await listRoster(testDb(), auctionId)).toHaveLength(1)
  })

  it('blocca la riga di stato del giocatore e la crea se manca', async () => {
    const ids = await seedPlayers([player({ name: 'Bloccato', role: 'A' })])
    const playerId = ids.get('Bloccato')!

    const locked = await testDb().transaction((tx) => lockAuctionPlayer(tx, auctionId, playerId))
    expect(locked).toMatchObject({ auctionId, playerId, status: 'AVAILABLE' })
  })

  it('restituisce null bloccando un giocatore inesistente', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    const locked = await testDb().transaction((tx) => lockAuctionPlayer(tx, auctionId, missing))
    expect(locked).toBeNull()
  })

  it('ensureAuctionPlayers è idempotente', async () => {
    const ids = await seedPlayers([player({ name: 'Uno' }), player({ name: 'Due' })])
    const playerIds = [...ids.values()]

    await ensureAuctionPlayers(testDb(), auctionId, playerIds)
    await expect(ensureAuctionPlayers(testDb(), auctionId, playerIds)).resolves.toBeUndefined()
  })

  /**
   * Spec §48: due utenti non possono comprare lo stesso giocatore.
   * Il caso peggiore è il giocatore MAI toccato prima, per cui la riga di stato
   * non esiste ancora: un `SELECT ... FOR UPDATE` da solo non bloccherebbe nulla.
   * A serializzare è la PK `(auction_id, player_id)` dell'insert che
   * `lockAuctionPlayer` fa prima del lock.
   */
  it('due acquisti simultanei dello stesso giocatore: ne passa esattamente uno', async () => {
    const ids = await seedPlayers([player({ name: 'Contesa' })])
    const playerId = ids.get('Contesa')!
    const rosterId = await getRosterId(testDb(), auctionId)

    const purchase = () =>
      testDb().transaction(async (tx) => {
        const locked = await lockAuctionPlayer(tx, auctionId, playerId)
        if (!locked) throw new Error('PLAYER_NOT_FOUND')
        if (locked.status !== 'AVAILABLE') throw new Error('PLAYER_NOT_AVAILABLE')
        await addRosterPlayer(tx, rosterId, playerId, 30)
        return setStatus(tx, auctionId, playerId, {
          status: 'MY_PLAYER',
          updatedBy: userId,
        })
      })

    const results = await Promise.allSettled([purchase(), purchase()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await listRoster(testDb(), auctionId)).toHaveLength(1)
    expect(await listPurchaseFacts(testDb(), auctionId)).toHaveLength(1)
  })

  it('espone i fatti di acquisto e di vendita per i calcoli derivati', async () => {
    const ids = await seedPlayers([
      player({ name: 'Mio', role: 'D' }),
      player({ name: 'Venduto', role: 'A', fvm: 80 }),
    ])
    const rosterId = await getRosterId(testDb(), auctionId)
    await addRosterPlayer(testDb(), rosterId, ids.get('Mio')!, 40)
    await upsertTarget(testDb(), auctionId, ids.get('Venduto')!, { tier: 'A' })
    await setStatus(testDb(), auctionId, ids.get('Venduto')!, {
      status: 'SOLD',
      soldPrice: 95,
      updatedBy: userId,
    })

    expect(await listPurchaseFacts(testDb(), auctionId)).toEqual([
      { playerId: ids.get('Mio'), role: 'D', price: 40 },
    ])
    expect(await listSoldFacts(testDb(), auctionId)).toEqual([
      { playerId: ids.get('Venduto'), role: 'A', fvm: 80, soldPrice: 95, tier: 'A' },
    ])
  })

  /**
   * Spec §31: le analytics usano solo prezzi realmente registrati, e i miei
   * acquisti lo sono. Il prezzo arriva da due tabelle diverse, quindi il test
   * verifica che quello dei miei venga preso da `roster_players`.
   */
  it('listSoldFacts include i miei acquisti e non inventa i prezzi mancanti', async () => {
    const ids = await seedPlayers([
      player({ name: 'VendutoConPrezzo', role: 'A', fvm: 80 }),
      player({ name: 'VendutoSenzaPrezzo', role: 'C', fvm: 60 }),
      player({ name: 'Mio', role: 'D', fvm: 70 }),
    ])
    const rosterId = await getRosterId(testDb(), auctionId)

    await setStatus(testDb(), auctionId, ids.get('VendutoConPrezzo')!, {
      status: 'SOLD',
      soldPrice: 95,
      updatedBy: userId,
    })
    await setStatus(testDb(), auctionId, ids.get('VendutoSenzaPrezzo')!, {
      status: 'SOLD',
      updatedBy: userId,
    })
    await addRosterPlayer(testDb(), rosterId, ids.get('Mio')!, 41)
    await setStatus(testDb(), auctionId, ids.get('Mio')!, {
      status: 'MY_PLAYER',
      updatedBy: userId,
    })

    const facts = await listSoldFacts(testDb(), auctionId)
    expect(facts).toHaveLength(3)
    expect(facts.find((fact) => fact.playerId === ids.get('Mio'))).toMatchObject({
      role: 'D',
      fvm: 70,
      soldPrice: 41,
    })
    expect(facts.find((fact) => fact.playerId === ids.get('VendutoConPrezzo'))?.soldPrice).toBe(95)
    expect(
      facts.find((fact) => fact.playerId === ids.get('VendutoSenzaPrezzo'))?.soldPrice
    ).toBeNull()
    expect(facts.filter((fact) => fact.soldPrice !== null)).toHaveLength(2)
  })

  it('annullare una vendita ripulisce i metadati', async () => {
    const ids = await seedPlayers([player({ name: 'Ripulito' })])
    const playerId = ids.get('Ripulito')!

    await setStatus(testDb(), auctionId, playerId, {
      status: 'SOLD',
      soldPrice: 20,
      otherTeamName: 'Altri',
      updatedBy: userId,
    })
    const reverted = await setStatus(testDb(), auctionId, playerId, {
      status: 'AVAILABLE',
      updatedBy: userId,
    })
    expect(reverted).toMatchObject({ status: 'AVAILABLE', soldPrice: null, otherTeamName: null })
  })

  it('registra e pagina gli eventi', async () => {
    const ids = await seedPlayers([player({ name: 'Eventato' })])
    const playerId = ids.get('Eventato')!

    for (let index = 0; index < 3; index += 1) {
      await appendEvent(testDb(), {
        auctionId,
        actorUserId: userId,
        playerId,
        type: 'PLAYER_PURCHASED',
        payload: { price: index },
      })
    }

    const firstPage = await listEvents(testDb(), auctionId, 2, 0)
    expect(firstPage.total).toBe(3)
    expect(firstPage.rows).toHaveLength(2)
    expect(firstPage.rows[0]).toMatchObject({
      playerName: 'Eventato',
      actorName: 'Tester',
      revertedAt: null,
    })
    expect(typeof firstPage.rows[0]?.createdAt).toBe('string')

    const secondPage = await listEvents(testDb(), auctionId, 2, 2)
    expect(secondPage.rows).toHaveLength(1)
    expect(secondPage.total).toBe(3)
  })

  it('marca un evento come annullato senza cancellarlo', async () => {
    const event = await appendEvent(testDb(), {
      auctionId,
      actorUserId: userId,
      playerId: null,
      type: 'IMPORT_COMPLETED',
      payload: {},
    })

    expect(await findEventById(testDb(), auctionId, event.id)).toMatchObject({
      revertedAt: null,
    })
    await markEventReverted(testDb(), event.id)

    const reloaded = await findEventById(testDb(), auctionId, event.id)
    expect(reloaded?.revertedAt).toBeInstanceOf(Date)
    expect((await listEvents(testDb(), auctionId, 10, 0)).total).toBe(1)
  })

  it('non legge un evento di un altra asta', async () => {
    const otherAuctionId = await createTestAuction(userId)
    const event = await appendEvent(testDb(), {
      auctionId: otherAuctionId,
      actorUserId: userId,
      playerId: null,
      type: 'IMPORT_COMPLETED',
      payload: {},
    })
    expect(await findEventById(testDb(), auctionId, event.id)).toBeNull()
  })

  it('trova la stagione di statistiche precedente disponibile', async () => {
    const ids = await seedPlayers([player({ name: 'Storico' })])
    const playerId = ids.get('Storico')!
    const base = {
      playerId,
      appearances: 10,
      starts: 8,
      minutes: 700,
      averageRating: 6,
      fantasyAverage: 6.5,
      goals: 1,
      assists: 1,
      yellowCards: 1,
      redCards: 0,
      penaltiesScored: 0,
      penaltiesMissed: 0,
      goalsConceded: null,
      penaltiesSaved: null,
      provider: 'excel',
      updatedAt: new Date(),
    }

    expect(await findLatestStatsSeason(testDb(), SEASON)).toBeNull()

    await upsertSeasonStats(testDb(), [
      { ...base, season: '2024/25' },
      { ...base, season: '2025/26' },
    ])
    expect(await findLatestStatsSeason(testDb(), SEASON)).toBe('2025/26')
    expect(await findLatestStatsSeason(testDb(), '2025/26')).toBe('2024/25')
    expect(await findLatestStatsSeason(testDb(), '2024/25')).toBeNull()
  })

  it('aggiunge un membro in upsert e lo elenca con lo utente', async () => {
    const otherUserId = await createUser()
    await addMember(testDb(), auctionId, otherUserId, 'EDITOR')
    await addMember(testDb(), auctionId, otherUserId, 'VIEWER')

    const members = await listMembers(testDb(), auctionId)
    expect(members).toHaveLength(2)
    expect(members.find((member) => member.userId === otherUserId)).toMatchObject({
      role: 'VIEWER',
      user: { id: otherUserId },
    })
  })

  it('salva e rilegge una impostazione applicativa', async () => {
    expect(await getSetting<string>(testDb(), 'ai.defaultProviderId')).toBeNull()
    await setSetting(testDb(), 'ai.defaultProviderId', 'claude-code')
    await setSetting(testDb(), 'ai.defaultProviderId', 'codex')
    expect(await getSetting<string>(testDb(), 'ai.defaultProviderId')).toBe('codex')
  })
})
