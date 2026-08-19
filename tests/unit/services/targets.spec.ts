import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAuction, makePlayer, makePlayerRow } from './fixtures'

const m = vi.hoisted(() => ({
  tx: { transaction: true },
  findPlayerById: vi.fn(),
  findPlayerRows: vi.fn(),
  findLatestStatsSeason: vi.fn(),
  upsertTarget: vi.fn(),
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
vi.mock('../../../server/repositories/targets', () => ({ upsertTarget: m.upsertTarget }))
vi.mock('../../../server/repositories/events', () => ({ appendEvent: m.appendEvent }))

const { updateTarget } = await import('../../../server/services/targets')

const auction = makeAuction()
const player = makePlayer()

beforeEach(() => {
  vi.clearAllMocks()
  m.findPlayerById.mockResolvedValue(player)
  m.upsertTarget.mockResolvedValue({})
  m.appendEvent.mockResolvedValue({ id: 'event-target' })
  m.findLatestStatsSeason.mockResolvedValue('2025/26')
  m.findPlayerRows.mockResolvedValue([makePlayerRow()])
})

describe('updateTarget', () => {
  it('salva i prezzi personali e scrive un evento di target', async () => {
    const result = await updateTarget({
      auction,
      patch: { playerId: player.id, targetPrice: 40, maxPrice: 50 },
      userId: 'user-1',
    })

    expect(m.upsertTarget).toHaveBeenCalledWith(m.tx, auction.id, player.id, {
      targetPrice: 40,
      maxPrice: 50,
    })
    expect(m.appendEvent).toHaveBeenCalledWith(
      m.tx,
      expect.objectContaining({ type: 'PLAYER_TARGET_UPDATED' })
    )
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, auction.id, {
      playerIds: [player.id],
      eventId: 'event-target',
    })
    expect(result.row.playerId).toBe(makePlayerRow().playerId)
  })

  it('distingue il cambio di solo tier nel log d asta', async () => {
    await updateTarget({ auction, patch: { playerId: player.id, tier: 'B' }, userId: 'user-1' })

    expect(m.appendEvent).toHaveBeenCalledWith(
      m.tx,
      expect.objectContaining({ type: 'PLAYER_TIER_UPDATED', payload: { tier: 'B' } })
    )
  })

  it('rifiuta un giocatore inesistente', async () => {
    m.findPlayerById.mockResolvedValue(null)

    await expect(
      updateTarget({ auction, patch: { playerId: player.id, tier: 'B' }, userId: 'user-1' })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'PLAYER_NOT_FOUND' })

    expect(m.upsertTarget).not.toHaveBeenCalled()
    expect(m.publishAuctionChange).not.toHaveBeenCalled()
  })
})
