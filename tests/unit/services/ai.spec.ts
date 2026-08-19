import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiProviderError, type AuctionContext } from '#shared/types'
import { toErrorResponse } from '../../../server/utils/errors'
import { makeAuction, makePlayerRow } from './fixtures'

const m = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  askWithProvider: vi.fn(),
  findPlayerRows: vi.fn(),
  listPlayerRows: vi.fn(),
  listRoster: vi.fn(),
  listTargets: vi.fn(),
  getSetting: vi.fn(),
  listPurchaseFacts: vi.fn(),
  listSoldFacts: vi.fn(),
  findLatestStatsSeason: vi.fn(),
}))

vi.mock('../../../server/utils/db', () => ({ db: {}, withTransaction: m.withTransaction }))
vi.mock('../../../server/providers/ai', () => ({ askWithProvider: m.askWithProvider }))
vi.mock('../../../server/repositories/players', () => ({
  findPlayerRows: m.findPlayerRows,
  listPlayerRows: m.listPlayerRows,
}))
vi.mock('../../../server/repositories/roster', () => ({ listRoster: m.listRoster }))
vi.mock('../../../server/repositories/targets', () => ({ listTargets: m.listTargets }))
vi.mock('../../../server/repositories/settings', () => ({ getSetting: m.getSetting }))
vi.mock('../../../server/repositories/auctionPlayers', () => ({
  listPurchaseFacts: m.listPurchaseFacts,
  listSoldFacts: m.listSoldFacts,
}))
vi.mock('../../../server/repositories/stats', () => ({
  findLatestStatsSeason: m.findLatestStatsSeason,
}))

vi.stubGlobal('useRuntimeConfig', () => ({ ai: { defaultProvider: 'opencode' } }))

const { askAi, quickAction } = await import('../../../server/services/ai')

const auction = makeAuction({ initialBudget: 500 })
const current = makePlayerRow({ playerId: 'p-current', name: 'Dimarco', role: 'D' })
const alternative = makePlayerRow({ playerId: 'p-alt', name: 'Bastoni', role: 'D', fvm: 55 })

function lastContext(): AuctionContext {
  const call = m.askWithProvider.mock.calls.at(-1)
  return (call as [string, AuctionContext, string])[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  m.askWithProvider.mockResolvedValue({
    providerId: 'claude-code',
    text: 'risposta',
    durationMs: 12,
  })
  m.findPlayerRows.mockResolvedValue([current])
  m.listPlayerRows.mockResolvedValue({ rows: [alternative], total: 1 })
  m.listRoster.mockResolvedValue([
    {
      playerId: 'p-1',
      name: 'Sommer',
      role: 'P',
      team: 'Inter',
      purchasePrice: 25,
      purchasedAt: new Date(),
    },
  ])
  m.listTargets.mockResolvedValue([
    {
      auctionId: auction.id,
      playerId: 'p-current',
      name: 'Dimarco',
      role: 'D',
      tier: 'A',
      targetPrice: 40,
      maxPrice: 50,
      priority: 1,
      notes: null,
      isTarget: true,
      updatedAt: new Date(),
    },
  ])
  m.listPurchaseFacts.mockResolvedValue([{ playerId: 'p-1', role: 'P', price: 25 }])
  m.listSoldFacts.mockResolvedValue([])
  m.getSetting.mockResolvedValue(null)
  m.findLatestStatsSeason.mockResolvedValue('2025/26')
})

describe('askAi', () => {
  it('costruisce il contesto d asta e non scrive niente sul database', async () => {
    await askAi({
      auction,
      providerId: 'claude-code',
      prompt: 'Quanto posso spendere?',
      playerId: 'p-current',
      currentBid: 44,
    })

    expect(m.askWithProvider).toHaveBeenCalledWith(
      'claude-code',
      expect.anything(),
      'Quanto posso spendere?'
    )

    const context = lastContext()
    expect(context.auction).toMatchObject({ season: auction.season, mode: 'CLASSIC' })
    expect(context.auction.remainingBudget).toBe(475)
    expect(context.currentPlayer).toMatchObject({ name: 'Dimarco', currentBid: 44 })
    expect(context.roster.players).toEqual([{ name: 'Sommer', role: 'P', purchasePrice: 25 }])
    expect(context.targets[0]).toMatchObject({ name: 'Dimarco', maxPrice: 50 })
    expect(context.availableAlternatives.map((player) => player.name)).toEqual(['Bastoni'])

    // Il contesto contiene solo le chiavi previste: nessun dato di infrastruttura (spec 43).
    expect(Object.keys(context).sort()).toEqual([
      'auction',
      'availableAlternatives',
      'currentPlayer',
      'marketAnalytics',
      'roster',
      'targets',
    ])

    // Una risposta AI non modifica mai lo stato d'asta (spec 43).
    expect(m.withTransaction).not.toHaveBeenCalled()
  })

  it('esclude il giocatore in esame dalle alternative', async () => {
    m.listPlayerRows.mockResolvedValue({ rows: [current, alternative], total: 2 })

    await askAi({ auction, prompt: 'Alternative?', playerId: 'p-current' })

    expect(lastContext().availableAlternatives.map((player) => player.name)).toEqual(['Bastoni'])
  })

  it('non spaccia per comprabile un giocatore confrontato ma venduto', async () => {
    const sold = makePlayerRow({ playerId: 'p-sold', name: 'Lautaro', role: 'A', status: 'SOLD' })
    m.findPlayerRows.mockResolvedValue([current, sold])

    await askAi({
      auction,
      prompt: 'Chi conviene?',
      playerId: 'p-current',
      comparePlayerIds: ['p-sold'],
    })

    const context = lastContext()
    expect(context.comparePlayers?.map((player) => player.name)).toEqual(['Lautaro'])
    expect(context.availableAlternatives.map((player) => player.name)).not.toContain('Lautaro')
  })

  it('usa il provider salvato nelle impostazioni quando non ne arriva uno', async () => {
    m.getSetting.mockResolvedValue('codex')

    await askAi({ auction, prompt: 'Consigli?' })

    expect(m.askWithProvider).toHaveBeenCalledWith('codex', expect.anything(), 'Consigli?')
  })

  it('ricade sul default di configurazione se l impostazione manca o non e valida', async () => {
    m.getSetting.mockResolvedValue('provider-inesistente')

    await askAi({ auction, prompt: 'Consigli?' })

    expect(m.askWithProvider).toHaveBeenCalledWith('opencode', expect.anything(), 'Consigli?')
  })

  it('un provider occupato risale come 429', async () => {
    m.askWithProvider.mockRejectedValue(new AiProviderError('PROVIDER_BUSY'))

    const err = await askAi({ auction, prompt: 'Consigli?' }).catch((error: unknown) => error)

    expect(err).toBeInstanceOf(AiProviderError)
    expect(toErrorResponse(err)).toEqual({ statusCode: 429, code: 'PROVIDER_BUSY' })
  })
})

describe('quickAction', () => {
  it('manda un prompt predefinito con lo stesso contesto', async () => {
    await quickAction({ auction, action: 'RECOMMEND_NEXT_PURCHASE' })

    const [, , prompt] = m.askWithProvider.mock.calls[0] as [string, AuctionContext, string]
    expect(prompt.length).toBeGreaterThan(20)
    expect(lastContext().roster.players).toHaveLength(1)
  })
})
