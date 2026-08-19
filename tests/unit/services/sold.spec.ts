import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAuction, makeAuctionPlayer, makePlayer, makePlayerRow } from './fixtures'

const m = vi.hoisted(() => ({
  tx: { transaction: true },
  findPlayerById: vi.fn(),
  findPlayerRows: vi.fn(),
  findLatestStatsSeason: vi.fn(),
  lockAuctionPlayer: vi.fn(),
  listPurchaseFacts: vi.fn(),
  setStatus: vi.fn(),
  appendEvent: vi.fn(),
  publishAuctionChange: vi.fn(),
}))

vi.mock('../../../server/utils/db', () => ({
  db: {},
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(m.tx),
}))
vi.mock('../../../server/utils/events', () => ({ publishAuctionChange: m.publishAuctionChange }))
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
vi.mock('../../../server/repositories/events', () => ({ appendEvent: m.appendEvent }))

const { markPlayerSold } = await import('../../../server/services/sold')

const player = makePlayer()

beforeEach(() => {
  vi.clearAllMocks()
  m.findPlayerById.mockResolvedValue(player)
  m.lockAuctionPlayer.mockResolvedValue(makeAuctionPlayer('AVAILABLE'))
  m.listPurchaseFacts.mockResolvedValue([])
  m.setStatus.mockResolvedValue(makeAuctionPlayer('SOLD'))
  m.appendEvent.mockResolvedValue({ id: 'event-2' })
  m.findLatestStatsSeason.mockResolvedValue('2025/26')
  m.findPlayerRows.mockResolvedValue([makePlayerRow({ status: 'SOLD' })])
})

describe('markPlayerSold', () => {
  it('riesce senza prezzo e senza squadra e non tocca il budget', async () => {
    const auction = makeAuction()

    const result = await markPlayerSold({ auction, playerId: player.id, userId: 'user-1' })

    expect(m.setStatus).toHaveBeenCalledWith(m.tx, auction.id, player.id, {
      status: 'SOLD',
      soldPrice: null,
      otherTeamName: null,
      updatedBy: 'user-1',
    })
    expect(m.appendEvent).toHaveBeenCalledWith(m.tx, {
      auctionId: auction.id,
      actorUserId: 'user-1',
      playerId: player.id,
      type: 'PLAYER_SOLD',
      payload: { soldPrice: null, otherTeamName: null },
    })
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, auction.id, {
      playerIds: [player.id],
      eventId: 'event-2',
    })

    // Un SOLD non consuma budget ne slot (spec 16).
    expect(result.state.spent).toBe(0)
    expect(result.state.remainingBudget).toBe(auction.initialBudget)
    expect(result.state.occupiedSlots).toBe(0)
  })

  it('registra prezzo e squadra quando ci sono', async () => {
    await markPlayerSold({
      auction: makeAuction(),
      playerId: player.id,
      soldPrice: 35,
      otherTeamName: 'Team Rossi',
      userId: 'user-1',
    })

    expect(m.setStatus).toHaveBeenCalledWith(m.tx, expect.any(String), player.id, {
      status: 'SOLD',
      soldPrice: 35,
      otherTeamName: 'Team Rossi',
      updatedBy: 'user-1',
    })
  })

  it('non sovrascrive un acquisto concorrente', async () => {
    m.lockAuctionPlayer.mockResolvedValue(makeAuctionPlayer('MY_PLAYER'))

    await expect(
      markPlayerSold({ auction: makeAuction(), playerId: player.id, userId: 'user-1' })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'PLAYER_ALREADY_OWNED' })

    expect(m.setStatus).not.toHaveBeenCalled()
    expect(m.appendEvent).not.toHaveBeenCalled()
    expect(m.publishAuctionChange).not.toHaveBeenCalled()
  })
})
