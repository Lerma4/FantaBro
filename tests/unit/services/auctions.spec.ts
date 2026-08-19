import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAuction } from './fixtures'

const m = vi.hoisted(() => ({
  tx: { transaction: true },
  createAuction: vi.fn(),
  lockAuction: vi.fn(),
  updateAuction: vi.fn(),
  countPlayersForSeason: vi.fn(),
  publishAuctionChange: vi.fn(),
}))

vi.mock('../../../server/utils/db', () => ({
  db: {},
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(m.tx),
}))
vi.mock('../../../server/utils/events', () => ({ publishAuctionChange: m.publishAuctionChange }))
vi.mock('../../../server/repositories/auctions', () => ({
  createAuction: m.createAuction,
  lockAuction: m.lockAuction,
  updateAuction: m.updateAuction,
}))
vi.mock('../../../server/repositories/players', () => ({
  countPlayersForSeason: m.countPlayersForSeason,
}))

const { createAuctionWithOwner, updateAuctionSettings } =
  await import('../../../server/services/auctions')

const auction = makeAuction()

beforeEach(() => {
  vi.clearAllMocks()
  m.createAuction.mockResolvedValue(auction)
  m.lockAuction.mockResolvedValue(auction)
  m.updateAuction.mockResolvedValue(makeAuction({ initialBudget: 400 }))
  m.countPlayersForSeason.mockResolvedValue(560)
})

describe('createAuctionWithOwner', () => {
  it('crea l asta nella transazione e restituisce il riepilogo da OWNER', async () => {
    const summary = await createAuctionWithOwner(
      {
        name: auction.name,
        season: auction.season,
        mode: 'CLASSIC',
        initialBudget: 500,
        minimumPlayerCost: 1,
        roleSlots: auction.roleSlots,
      },
      'user-1'
    )

    expect(m.createAuction).toHaveBeenCalledWith(
      m.tx,
      expect.objectContaining({ createdBy: 'user-1' })
    )
    expect(summary).toMatchObject({ memberRole: 'OWNER', playersCount: 560 })
  })
})

describe('updateAuctionSettings', () => {
  it('blocca l asta prima di cambiarne le regole e notifica i client', async () => {
    const summary = await updateAuctionSettings(auction.id, { initialBudget: 400 }, 'OWNER')

    // Budget e slot sono l'invariante dei controlli d'acquisto: il lock evita che cambino
    // mentre un acquisto e in volo.
    expect(m.lockAuction).toHaveBeenCalledWith(m.tx, auction.id)
    expect(m.lockAuction.mock.invocationCallOrder[0]).toBeLessThan(
      m.updateAuction.mock.invocationCallOrder[0]!
    )
    // `playerIds: []` = "ricarica tutto": cambia lo stato derivato di ogni riga.
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, auction.id, { playerIds: [] })
    expect(summary.initialBudget).toBe(400)
  })

  it('rifiuta un asta inesistente senza scrivere niente', async () => {
    m.lockAuction.mockResolvedValue(null)

    await expect(
      updateAuctionSettings(auction.id, { initialBudget: 400 }, 'OWNER')
    ).rejects.toMatchObject({ name: 'DomainError', code: 'AUCTION_NOT_FOUND' })

    expect(m.updateAuction).not.toHaveBeenCalled()
    expect(m.publishAuctionChange).not.toHaveBeenCalled()
  })
})
