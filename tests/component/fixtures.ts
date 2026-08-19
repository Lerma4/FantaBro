import type { AuctionState, AuctionSummary, PlayerRow } from '#shared/types'

export function playerRow(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    playerId: '11111111-1111-4111-8111-111111111111',
    name: 'Dimarco',
    team: 'Inter',
    role: 'D',
    mantraRole: null,
    quotation: 20,
    fvm: 120,
    status: 'AVAILABLE',
    soldPrice: null,
    otherTeamName: null,
    purchasePrice: null,
    statsSeason: '2025/26',
    appearances: 34,
    averageRating: 6.32,
    fantasyAverage: 7.18,
    goals: 4,
    assists: 9,
    tier: 'A',
    targetPrice: 30,
    maxPrice: 40,
    priority: 1,
    isTarget: true,
    notes: null,
    ...overrides,
  }
}

export function auctionState(overrides: Partial<AuctionState> = {}): AuctionState {
  return {
    auctionId: 'a1',
    initialBudget: 500,
    minimumPlayerCost: 1,
    spent: 213,
    remainingBudget: 287,
    totalSlots: 25,
    occupiedSlots: 14,
    remainingSlots: 11,
    averageBudgetPerRemainingSlot: 26,
    maxBid: 277,
    slots: [
      { role: 'P', total: 3, occupied: 3, free: 0 },
      { role: 'D', total: 8, occupied: 5, free: 3 },
      { role: 'C', total: 8, occupied: 4, free: 4 },
      { role: 'A', total: 6, occupied: 2, free: 4 },
    ],
    roleBudgets: [
      { role: 'P', planned: 30, spent: 28, plannedRemaining: 2, percentageUsed: 93 },
      { role: 'D', planned: null, spent: 60, plannedRemaining: null, percentageUsed: null },
      { role: 'C', planned: null, spent: 45, plannedRemaining: null, percentageUsed: null },
      { role: 'A', planned: null, spent: 80, plannedRemaining: null, percentageUsed: null },
    ],
    ...overrides,
  }
}

export function auctionSummary(overrides: Partial<AuctionSummary> = {}): AuctionSummary {
  return {
    id: 'a1',
    name: 'Lega dei Bro',
    season: '2026/27',
    mode: 'CLASSIC',
    initialBudget: 500,
    minimumPlayerCost: 1,
    roleSlots: { P: 3, D: 8, C: 8, A: 6 },
    roleBudgets: null,
    memberRole: 'OWNER',
    playersCount: 600,
    ...overrides,
  }
}
