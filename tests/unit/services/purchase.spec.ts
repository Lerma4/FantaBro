import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auction } from '#shared/types'
import {
  makeAuction,
  makeAuctionPlayer,
  makePlayer,
  makePlayerRow,
  uniqueViolation,
} from './fixtures'

const m = vi.hoisted(() => ({
  /** Sentinella di transazione: i servizi devono passare *questa* ai repository. */
  tx: { transaction: true },
  lockAuction: vi.fn(),
  findPlayerById: vi.fn(),
  findPlayerRows: vi.fn(),
  findLatestStatsSeason: vi.fn(),
  lockAuctionPlayer: vi.fn(),
  listPurchaseFacts: vi.fn(),
  setStatus: vi.fn(),
  getRosterId: vi.fn(),
  addRosterPlayer: vi.fn(),
  appendEvent: vi.fn(),
  publishAuctionChange: vi.fn(),
}))

vi.mock('../../../server/utils/db', () => ({
  db: {},
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(m.tx),
}))
vi.mock('../../../server/utils/events', () => ({
  publishAuctionChange: m.publishAuctionChange,
}))
vi.mock('../../../server/repositories/auctions', () => ({ lockAuction: m.lockAuction }))
vi.mock('../../../server/repositories/players', () => ({
  findPlayerById: m.findPlayerById,
  findPlayerRows: m.findPlayerRows,
}))
vi.mock('../../../server/repositories/stats', () => ({
  findLatestStatsSeason: m.findLatestStatsSeason,
}))
vi.mock('../../../server/repositories/auctionPlayers', () => ({
  lockAuctionPlayer: m.lockAuctionPlayer,
  listPurchaseFacts: m.listPurchaseFacts,
  setStatus: m.setStatus,
}))
vi.mock('../../../server/repositories/roster', () => ({
  getRosterId: m.getRosterId,
  addRosterPlayer: m.addRosterPlayer,
}))
vi.mock('../../../server/repositories/events', () => ({ appendEvent: m.appendEvent }))

const { purchasePlayer } = await import('../../../server/services/purchase')

const player = makePlayer()

/** Nessuna delle scritture di un acquisto deve essere avvenuta. */
function expectNoWrites() {
  expect(m.addRosterPlayer).not.toHaveBeenCalled()
  expect(m.setStatus).not.toHaveBeenCalled()
  expect(m.appendEvent).not.toHaveBeenCalled()
  expect(m.publishAuctionChange).not.toHaveBeenCalled()
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'DomainError', code })
}

/** Il servizio usa le regole dell'asta *bloccata*: il lock deve restituire la stessa. */
function buy(auction: Auction, price: number) {
  m.lockAuction.mockResolvedValue(auction)
  return purchasePlayer({ auction, playerId: player.id, price, userId: 'user-1' })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.lockAuction.mockResolvedValue(makeAuction())
  m.findPlayerById.mockResolvedValue(player)
  m.lockAuctionPlayer.mockResolvedValue(makeAuctionPlayer('AVAILABLE'))
  m.listPurchaseFacts.mockResolvedValue([])
  m.getRosterId.mockResolvedValue('roster-1')
  m.addRosterPlayer.mockResolvedValue({})
  m.setStatus.mockResolvedValue(makeAuctionPlayer('MY_PLAYER'))
  m.appendEvent.mockResolvedValue({ id: 'event-1' })
  m.findLatestStatsSeason.mockResolvedValue('2025/26')
  m.findPlayerRows.mockResolvedValue([makePlayerRow({ status: 'MY_PLAYER', purchasePrice: 43 })])
})

describe('purchasePlayer', () => {
  it('blocca la riga, aggiorna rosa e stato, scrive l evento e notifica', async () => {
    const auction = makeAuction()
    // Il secondo giro di `listPurchaseFacts` e il ricalcolo dopo la scrittura.
    m.listPurchaseFacts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ playerId: player.id, role: 'D', price: 43 }])

    const result = await purchasePlayer({
      auction,
      playerId: player.id,
      price: 43,
      userId: 'user-1',
    })

    expect(m.lockAuctionPlayer).toHaveBeenCalledWith(m.tx, auction.id, player.id)
    expect(m.addRosterPlayer).toHaveBeenCalledWith(m.tx, 'roster-1', player.id, 43)
    expect(m.setStatus).toHaveBeenCalledWith(m.tx, auction.id, player.id, {
      status: 'MY_PLAYER',
      updatedBy: 'user-1',
    })
    expect(m.appendEvent).toHaveBeenCalledWith(m.tx, {
      auctionId: auction.id,
      actorUserId: 'user-1',
      playerId: player.id,
      type: 'PLAYER_PURCHASED',
      payload: { price: 43 },
    })
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, auction.id, {
      playerIds: [player.id],
      eventId: 'event-1',
    })

    expect(result.eventId).toBe('event-1')
    // Stato ricalcolato dagli acquisti riletti, non dal prezzo passato in input.
    expect(result.state.spent).toBe(43)
    expect(result.state.remainingBudget).toBe(457)
  })

  it('rifiuta un acquisto oltre il budget senza scrivere niente', async () => {
    await expectCode(buy(makeAuction({ initialBudget: 50 }), 60), 'BUDGET_EXCEEDED')
    expectNoWrites()
  })

  it('rifiuta un acquisto senza slot liberi nel ruolo', async () => {
    m.listPurchaseFacts.mockResolvedValue([{ playerId: 'altro', role: 'D', price: 10 }])

    await expectCode(buy(makeAuction(), 20), 'ROLE_SLOTS_FULL')
    expectNoWrites()
  })

  it('rifiuta un acquisto di un giocatore non piu disponibile', async () => {
    m.lockAuctionPlayer.mockResolvedValue(makeAuctionPlayer('SOLD'))

    await expectCode(buy(makeAuction(), 10), 'PLAYER_NOT_AVAILABLE')
    expectNoWrites()
  })

  it('rifiuta un acquisto di un giocatore gia in rosa', async () => {
    m.lockAuctionPlayer.mockResolvedValue(makeAuctionPlayer('MY_PLAYER'))

    await expectCode(buy(makeAuction(), 10), 'PLAYER_ALREADY_OWNED')
    expectNoWrites()
  })

  it('rifiuta un prezzo che renderebbe impossibile riempire gli slot restanti', async () => {
    // 4 slot, costo minimo 1: offrendo 98 su 100 non si possono piu coprire i 3 slot residui.
    await expectCode(buy(makeAuction({ initialBudget: 100 }), 98), 'REMAINING_SLOTS_UNFILLABLE')
    expectNoWrites()
  })

  it('rifiuta un prezzo sotto il costo minimo', async () => {
    await expectCode(buy(makeAuction({ minimumPlayerCost: 2 }), 1), 'PRICE_BELOW_MINIMUM')
    expectNoWrites()
  })

  it('traduce la violazione del vincolo unico in CONFLICT', async () => {
    m.addRosterPlayer.mockRejectedValue(uniqueViolation())

    await expectCode(buy(makeAuction(), 10), 'CONFLICT')
    expect(m.setStatus).not.toHaveBeenCalled()
    expect(m.appendEvent).not.toHaveBeenCalled()
    expect(m.publishAuctionChange).not.toHaveBeenCalled()
  })

  it('blocca l asta prima del giocatore: ordine invariante contro i deadlock', async () => {
    const auction = makeAuction()
    m.lockAuction.mockResolvedValue(auction)

    await purchasePlayer({ auction, playerId: player.id, price: 43, userId: 'user-1' })

    expect(m.lockAuction).toHaveBeenCalledWith(m.tx, auction.id)
    expect(m.lockAuction.mock.invocationCallOrder[0]).toBeLessThan(
      m.lockAuctionPlayer.mock.invocationCallOrder[0]!
    )
  })

  it('usa le regole dell asta bloccata, non quelle passate dalla route', async () => {
    // La route puo aver letto l'asta prima di un PATCH: vince quella bloccata.
    m.lockAuction.mockResolvedValue(makeAuction({ initialBudget: 50 }))

    await expectCode(
      purchasePlayer({
        auction: makeAuction({ initialBudget: 500 }),
        playerId: player.id,
        price: 60,
        userId: 'user-1',
      }),
      'BUDGET_EXCEEDED'
    )
    expectNoWrites()
  })

  it('rifiuta un asta inesistente', async () => {
    m.lockAuction.mockResolvedValue(null)

    await expectCode(
      purchasePlayer({ auction: makeAuction(), playerId: player.id, price: 10, userId: 'user-1' }),
      'AUCTION_NOT_FOUND'
    )
    expect(m.lockAuctionPlayer).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('rifiuta un giocatore inesistente prima di prendere il lock', async () => {
    m.findPlayerById.mockResolvedValue(null)

    await expectCode(buy(makeAuction(), 10), 'PLAYER_NOT_FOUND')
    expect(m.lockAuctionPlayer).not.toHaveBeenCalled()
    expectNoWrites()
  })
})
