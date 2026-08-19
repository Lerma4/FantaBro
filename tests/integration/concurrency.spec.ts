import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  listPurchaseFacts,
  listSoldFacts,
  lockAuctionPlayer,
  setStatus,
} from '../../server/repositories/auctionPlayers'
import { lockAuction } from '../../server/repositories/auctions'
import { addRosterPlayer, getRosterId, listRoster } from '../../server/repositories/roster'
import {
  acquireSuite,
  createTestAuction,
  createUser,
  hasDatabase,
  player,
  releaseSuite,
  seedPlayers,
  testDb,
  truncateAll,
  waitForLockWaiters,
} from './helpers'

/** Promise risolta a mano: rende l'intreccio deterministico senza sleep. */
function gate() {
  let open!: () => void
  const passed = new Promise<void>((resolve) => {
    open = resolve
  })
  return { passed, open }
}

/**
 * Spec §48 con transazioni **reali e concorrenti**: due connessioni distinte dal
 * pool, avviate in parallelo. La sovrapposizione è forzata, non sperata: la prima
 * transazione prende i lock e attende un segnale, la seconda parte e viene
 * attesa su `pg_stat_activity` finché non è davvero bloccata su un lock.
 */
describe.skipIf(!hasDatabase)('concorrenza', () => {
  let userId: string

  beforeAll(acquireSuite)
  afterAll(releaseSuite)

  beforeEach(async () => {
    await truncateAll()
    userId = await createUser()
  })

  it('stesso giocatore, due acquirenti: ne passa esattamente uno', async () => {
    const auctionId = await createTestAuction(userId)
    const ids = await seedPlayers([player({ name: 'Contesa' })])
    const playerId = ids.get('Contesa')!
    const rosterId = await getRosterId(testDb(), auctionId)

    const holding = gate()
    const release = gate()
    const statuses: string[] = []

    const buy = (hold: boolean) =>
      testDb().transaction(async (tx) => {
        const auction = await lockAuction(tx, auctionId)
        if (!auction) throw new Error('AUCTION_NOT_FOUND')
        const locked = await lockAuctionPlayer(tx, auctionId, playerId)
        if (!locked) throw new Error('PLAYER_NOT_FOUND')
        statuses.push(locked.status)
        if (locked.status !== 'AVAILABLE') throw new Error('PLAYER_NOT_AVAILABLE')
        await addRosterPlayer(tx, rosterId, playerId, 30)
        await setStatus(tx, auctionId, playerId, { status: 'MY_PLAYER', updatedBy: userId })
        if (hold) {
          holding.open()
          await release.passed
        }
      })

    const first = buy(true)
    await holding.passed // la prima ha i lock e non ha ancora committato
    const second = buy(false)
    await waitForLockWaiters(1) // la seconda è davvero in attesa di un lock
    release.open()

    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    // La perdente ha visto lo stato già MY_PLAYER *dopo* il lock: serializzazione
    // riuscita, non il vincolo unico a salvarci.
    expect(statuses).toEqual(['AVAILABLE', 'MY_PLAYER'])
    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection?.status === 'rejected' && (rejection.reason as Error).message).toBe(
      'PLAYER_NOT_AVAILABLE'
    )

    const roster = await listRoster(testDb(), auctionId)
    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({ playerId, purchasePrice: 30 })
    expect(await listSoldFacts(testDb(), auctionId)).toEqual([
      expect.objectContaining({ playerId, soldPrice: 30 }),
    ])
  })

  it('giocatori diversi, budget per uno solo: la somma non sfora', async () => {
    const auctionId = await createTestAuction(userId, undefined, 100)
    const ids = await seedPlayers([player({ name: 'Primo' }), player({ name: 'Secondo' })])
    const rosterId = await getRosterId(testDb(), auctionId)

    const holding = gate()
    const release = gate()

    const buy = (name: string, price: number, hold: boolean) =>
      testDb().transaction(async (tx) => {
        const auction = await lockAuction(tx, auctionId)
        if (!auction) throw new Error('AUCTION_NOT_FOUND')
        // Controllo di budget rifatto **dentro** la transazione, come i servizi.
        const spent = (await listPurchaseFacts(tx, auctionId)).reduce(
          (total, fact) => total + fact.price,
          0
        )
        if (spent + price > auction.initialBudget) throw new Error('BUDGET_EXCEEDED')
        const playerId = ids.get(name)!
        await lockAuctionPlayer(tx, auctionId, playerId)
        await addRosterPlayer(tx, rosterId, playerId, price)
        await setStatus(tx, auctionId, playerId, { status: 'MY_PLAYER', updatedBy: userId })
        if (hold) {
          holding.open()
          await release.passed
        }
      })

    const first = buy('Primo', 60, true)
    await holding.passed
    const second = buy('Secondo', 60, false)
    await waitForLockWaiters(1)
    release.open()

    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection?.status === 'rejected' && (rejection.reason as Error).message).toBe(
      'BUDGET_EXCEEDED'
    )

    const roster = await listRoster(testDb(), auctionId)
    expect(roster).toHaveLength(1)
    const total = roster.reduce((sum, entry) => sum + entry.purchasePrice, 0)
    expect(total).toBeLessThanOrEqual(100)
    expect(total).toBe(60)
  })
})
