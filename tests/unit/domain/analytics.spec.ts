import { describe, expect, it } from 'vitest'
import {
  computeMarketAnalytics,
  NO_TIER_BUCKET_KEY,
  type SoldFact,
} from '../../../server/domain/analytics'

const sold = (overrides: Partial<SoldFact> & { playerId: string }): SoldFact => ({
  role: 'A',
  fvm: 50,
  soldPrice: 50,
  tier: null,
  ...overrides,
})

describe('computeMarketAnalytics', () => {
  it("riproduce l'esempio della spec 31: FVM medio 65, prezzo medio 78, premio +20%", () => {
    const analytics = computeMarketAnalytics([
      sold({ playerId: 'a1', role: 'A', fvm: 60, soldPrice: 76 }),
      sold({ playerId: 'a2', role: 'A', fvm: 70, soldPrice: 80 }),
    ])

    const attackers = analytics.byRole.find((bucket) => bucket.key === 'A')
    expect(attackers?.averageFvm).toBe(65)
    expect(attackers?.averageSoldPrice).toBe(78)
    expect(attackers?.priceToFvm).toBe(1.2)
    expect(attackers?.premiumVsFvmPct).toBe(20)
  })

  it('esclude dalle medie i venduti senza prezzo e li conta a parte', () => {
    const analytics = computeMarketAnalytics([
      sold({ playerId: 'a1', fvm: 100, soldPrice: 100 }),
      sold({ playerId: 'a2', fvm: 10, soldPrice: null }),
      sold({ playerId: 'a3', fvm: 10, soldPrice: null }),
    ])

    expect(analytics.soldWithoutPrice).toBe(2)
    expect(analytics.overall.soldCount).toBe(1)
    expect(analytics.overall.averageSoldPrice).toBe(100)
    expect(analytics.overall.averageFvm).toBe(100)
  })

  it('senza nessun prezzo registrato non inventa medie', () => {
    const analytics = computeMarketAnalytics([sold({ playerId: 'a1', soldPrice: null })])

    expect(analytics.overall).toEqual({
      key: 'ALL',
      soldCount: 0,
      averageSoldPrice: null,
      averageFvm: null,
      priceToFvm: null,
      premiumVsFvmPct: null,
    })
  })

  it('espone sempre i quattro ruoli, anche a zero vendite', () => {
    const analytics = computeMarketAnalytics([sold({ playerId: 'a1', role: 'A' })])

    expect(analytics.byRole.map((bucket) => bucket.key)).toEqual(['P', 'D', 'C', 'A'])
    expect(analytics.byRole.find((bucket) => bucket.key === 'P')?.soldCount).toBe(0)
    expect(analytics.byRole.find((bucket) => bucket.key === 'P')?.averageSoldPrice).toBeNull()
  })

  it('raggruppa per tier e raccoglie i venduti senza tier in un bucket dedicato', () => {
    const analytics = computeMarketAnalytics([
      sold({ playerId: 'a1', tier: 'B', fvm: 40, soldPrice: 30 }),
      sold({ playerId: 'a2', tier: 'A', fvm: 100, soldPrice: 120 }),
      sold({ playerId: 'a3', tier: null, fvm: 10, soldPrice: 5 }),
    ])

    expect(analytics.byTier.map((bucket) => bucket.key)).toEqual(['A', 'B', NO_TIER_BUCKET_KEY])
    expect(analytics.byTier.find((bucket) => bucket.key === 'A')?.premiumVsFvmPct).toBe(20)
    expect(analytics.byTier.find((bucket) => bucket.key === 'B')?.premiumVsFvmPct).toBe(-25)
    expect(analytics.byTier.find((bucket) => bucket.key === NO_TIER_BUCKET_KEY)?.soldCount).toBe(1)
  })

  it('ordina i tier di default prima di quelli custom', () => {
    const analytics = computeMarketAnalytics([
      sold({ playerId: 'a1', tier: 'zeta' }),
      sold({ playerId: 'a2', tier: 'GAMBLE' }),
      sold({ playerId: 'a3', tier: 'A' }),
    ])

    expect(analytics.byTier.map((bucket) => bucket.key)).toEqual(['A', 'GAMBLE', 'zeta'])
  })

  it('tiene due decimali sul rapporto prezzo/FVM', () => {
    const analytics = computeMarketAnalytics([sold({ playerId: 'a1', fvm: 40, soldPrice: 50 })])

    expect(analytics.overall.priceToFvm).toBe(1.25)
    expect(analytics.overall.premiumVsFvmPct).toBe(25)
  })

  it('non calcola il rapporto prezzo/FVM quando il FVM medio e zero', () => {
    const analytics = computeMarketAnalytics([sold({ playerId: 'a1', fvm: 0, soldPrice: 12 })])

    expect(analytics.overall.averageSoldPrice).toBe(12)
    expect(analytics.overall.averageFvm).toBe(0)
    expect(analytics.overall.priceToFvm).toBeNull()
    expect(analytics.overall.premiumVsFvmPct).toBeNull()
  })

  it('senza venduti restituisce bucket vuoti', () => {
    const analytics = computeMarketAnalytics([])

    expect(analytics.overall.soldCount).toBe(0)
    expect(analytics.byTier).toEqual([])
    expect(analytics.soldWithoutPrice).toBe(0)
  })
})
