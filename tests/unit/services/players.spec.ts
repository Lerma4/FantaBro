import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainError } from '../../../server/utils/errors'
import { makePlayer } from './fixtures'

const m = vi.hoisted(() => ({
  tx: { transaction: true },
  lockPlayer: vi.fn(),
  isPlayerCommitted: vi.fn(),
  deletePlayer: vi.fn(),
  listAuctionIdsForSeason: vi.fn(),
  publishAuctionChange: vi.fn(),
}))

vi.mock('../../../server/utils/db', () => ({
  db: {},
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(m.tx),
}))
vi.mock('../../../server/utils/events', () => ({ publishAuctionChange: m.publishAuctionChange }))
vi.mock('../../../server/repositories/players', () => ({
  lockPlayer: m.lockPlayer,
  isPlayerCommitted: m.isPlayerCommitted,
  deletePlayer: m.deletePlayer,
}))
vi.mock('../../../server/repositories/auctions', () => ({
  listAuctionIdsForSeason: m.listAuctionIdsForSeason,
}))

const { removePlayerFromListone } = await import('../../../server/services/players')

const player = makePlayer()

beforeEach(() => {
  vi.clearAllMocks()
  m.lockPlayer.mockResolvedValue(player)
  m.isPlayerCommitted.mockResolvedValue(false)
  m.deletePlayer.mockResolvedValue(true)
  m.listAuctionIdsForSeason.mockResolvedValue(['asta-1', 'asta-2'])
})

describe('removePlayerFromListone', () => {
  it('cancella il giocatore e avvisa tutte le aste della stagione', async () => {
    const result = await removePlayerFromListone(player.id)

    expect(m.deletePlayer).toHaveBeenCalledWith(m.tx, player.id)
    expect(m.listAuctionIdsForSeason).toHaveBeenCalledWith(m.tx, player.season)

    // `playerIds: []` = "ricarica tutto": la riga non esiste piu, non si aggiorna in posto.
    expect(m.publishAuctionChange.mock.calls).toEqual([
      [m.tx, 'asta-1', { playerIds: [] }],
      [m.tx, 'asta-2', { playerIds: [] }],
    ])
    expect(result).toEqual({ playerId: player.id, season: player.season })
  })

  it('rifiuta un giocatore inesistente senza cancellare nulla', async () => {
    m.lockPlayer.mockResolvedValue(null)

    await expect(removePlayerFromListone(player.id)).rejects.toMatchObject(
      new DomainError('PLAYER_NOT_FOUND')
    )
    expect(m.deletePlayer).not.toHaveBeenCalled()
  })

  it('rifiuta un giocatore in rosa o segnato venduto: la cascata lo cancellerebbe in silenzio', async () => {
    m.isPlayerCommitted.mockResolvedValue(true)

    await expect(removePlayerFromListone(player.id)).rejects.toMatchObject(
      new DomainError('PLAYER_IN_USE')
    )
    expect(m.deletePlayer).not.toHaveBeenCalled()
    expect(m.publishAuctionChange).not.toHaveBeenCalled()
  })

  /**
   * Il lock deve precedere il controllo: fra i due, un acquisto concorrente committato
   * passerebbe inosservato e finirebbe cancellato dalla cascata (spec 48).
   */
  it('prende il lock prima di controllare gli impegni', async () => {
    await removePlayerFromListone(player.id)

    const lock = m.lockPlayer.mock.invocationCallOrder[0] ?? 0
    const check = m.isPlayerCommitted.mock.invocationCallOrder[0] ?? 0
    expect(lock).toBeLessThan(check)
  })
})
