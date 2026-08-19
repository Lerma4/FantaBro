import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAuction, makeEvent, makePlayerRow } from './fixtures'

const m = vi.hoisted(() => ({
  tx: { transaction: true },
  lockAuction: vi.fn(),
  findPlayerRows: vi.fn(),
  findLatestStatsSeason: vi.fn(),
  lockAuctionPlayer: vi.fn(),
  listPurchaseFacts: vi.fn(),
  setStatus: vi.fn(),
  getRosterId: vi.fn(),
  removeRosterPlayer: vi.fn(),
  appendEvent: vi.fn(),
  findEventById: vi.fn(),
  markEventReverted: vi.fn(),
  publishAuctionChange: vi.fn(),
}))

vi.mock('../../../server/utils/db', () => ({
  db: {},
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(m.tx),
}))
vi.mock('../../../server/utils/events', () => ({ publishAuctionChange: m.publishAuctionChange }))
vi.mock('../../../server/repositories/auctions', () => ({ lockAuction: m.lockAuction }))
vi.mock('../../../server/repositories/players', () => ({ findPlayerRows: m.findPlayerRows }))
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
  removeRosterPlayer: m.removeRosterPlayer,
}))
vi.mock('../../../server/repositories/events', () => ({
  appendEvent: m.appendEvent,
  findEventById: m.findEventById,
  markEventReverted: m.markEventReverted,
}))

const { revertEvent } = await import('../../../server/services/revert')

const auction = makeAuction()
const purchased = makeEvent('PLAYER_PURCHASED')

beforeEach(() => {
  vi.clearAllMocks()
  m.lockAuction.mockResolvedValue(auction)
  m.findEventById.mockResolvedValue(purchased)
  m.lockAuctionPlayer.mockResolvedValue({})
  m.listPurchaseFacts.mockResolvedValue([])
  m.getRosterId.mockResolvedValue('roster-1')
  m.setStatus.mockResolvedValue({})
  m.appendEvent.mockResolvedValue({ id: 'reversal-1' })
  m.findLatestStatsSeason.mockResolvedValue('2025/26')
  m.findPlayerRows.mockResolvedValue([makePlayerRow({ status: 'AVAILABLE' })])
})

describe('revertEvent', () => {
  it('annulla un acquisto: rosa, stato, evento di annullo e marcatura dell originale', async () => {
    const result = await revertEvent({ auction, eventId: purchased.id, userId: 'user-2' })

    expect(m.removeRosterPlayer).toHaveBeenCalledWith(m.tx, 'roster-1', purchased.playerId)
    expect(m.setStatus).toHaveBeenCalledWith(m.tx, auction.id, purchased.playerId, {
      status: 'AVAILABLE',
      soldPrice: null,
      otherTeamName: null,
      updatedBy: 'user-2',
    })
    expect(m.appendEvent).toHaveBeenCalledWith(m.tx, {
      auctionId: auction.id,
      actorUserId: 'user-2',
      playerId: purchased.playerId,
      type: 'PLAYER_PURCHASE_REVERTED',
      payload: { revertedEventId: purchased.id, revertedPayload: purchased.payload },
    })
    // La storia non si distrugge: l'originale resta e viene marcato (spec 25).
    expect(m.markEventReverted).toHaveBeenCalledWith(m.tx, purchased.id)
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, auction.id, {
      playerIds: [purchased.playerId],
      eventId: 'reversal-1',
    })
    expect(result.row?.status).toBe('AVAILABLE')
    expect(result.state.remainingBudget).toBe(auction.initialBudget)
  })

  it('annulla un SOLD senza toccare la rosa', async () => {
    m.findEventById.mockResolvedValue(
      makeEvent('PLAYER_SOLD', { payload: { soldPrice: 35, otherTeamName: 'Team Rossi' } })
    )

    await revertEvent({ auction, eventId: purchased.id, userId: 'user-2' })

    expect(m.removeRosterPlayer).not.toHaveBeenCalled()
    expect(m.appendEvent).toHaveBeenCalledWith(
      m.tx,
      expect.objectContaining({ type: 'PLAYER_SOLD_REVERTED' })
    )
  })

  it('rifiuta un evento gia annullato', async () => {
    m.findEventById.mockResolvedValue(
      makeEvent('PLAYER_PURCHASED', { revertedAt: new Date('2026-08-19T11:00:00.000Z') })
    )

    await expect(
      revertEvent({ auction, eventId: purchased.id, userId: 'user-2' })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'EVENT_ALREADY_REVERTED' })

    expect(m.setStatus).not.toHaveBeenCalled()
    expect(m.markEventReverted).not.toHaveBeenCalled()
    expect(m.publishAuctionChange).not.toHaveBeenCalled()
  })

  it('rifiuta un evento non annullabile', async () => {
    m.findEventById.mockResolvedValue(makeEvent('IMPORT_COMPLETED', { playerId: null }))

    await expect(
      revertEvent({ auction, eventId: purchased.id, userId: 'user-2' })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'EVENT_NOT_REVERTABLE' })

    expect(m.setStatus).not.toHaveBeenCalled()
    expect(m.markEventReverted).not.toHaveBeenCalled()
  })

  it('blocca l asta prima del giocatore, come l acquisto', async () => {
    await revertEvent({ auction, eventId: purchased.id, userId: 'user-2' })

    expect(m.lockAuction).toHaveBeenCalledWith(m.tx, auction.id)
    expect(m.lockAuction.mock.invocationCallOrder[0]).toBeLessThan(
      m.lockAuctionPlayer.mock.invocationCallOrder[0]!
    )
  })

  it('rifiuta un evento inesistente', async () => {
    m.findEventById.mockResolvedValue(null)

    await expect(
      revertEvent({ auction, eventId: purchased.id, userId: 'user-2' })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'NOT_FOUND' })
  })
})
