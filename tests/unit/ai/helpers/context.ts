/** Contesto d'asta minimo ma valido, per i test del layer AI. */
import type { AuctionContext, MarketBucket } from '#shared/types'

function bucket(key: string): MarketBucket {
  return {
    key,
    soldCount: 0,
    averageSoldPrice: null,
    averageFvm: null,
    priceToFvm: null,
    premiumVsFvmPct: null,
  }
}

export function auctionContext(overrides: Partial<AuctionContext> = {}): AuctionContext {
  return {
    auction: {
      season: '2025-26',
      mode: 'CLASSIC',
      initialBudget: 500,
      remainingBudget: 320,
      minimumPlayerCost: 1,
      maxBid: 300,
    },
    roster: {
      players: [{ name: 'Maignan', role: 'P', purchasePrice: 18 }],
      slots: [{ role: 'P', total: 3, occupied: 1, free: 2 }],
    },
    targets: [],
    availableAlternatives: [],
    marketAnalytics: {
      overall: bucket('overall'),
      byRole: [],
      byTier: [],
      soldWithoutPrice: 0,
    },
    ...overrides,
  }
}
