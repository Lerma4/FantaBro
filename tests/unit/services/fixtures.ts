import type {
  Auction,
  AuctionEvent,
  AuctionEventType,
  AuctionPlayer,
  AuctionPlayerStatus,
  ClassicRole,
  Player,
  PlayerRow,
  RoleSlots,
} from '#shared/types'

const now = new Date('2026-08-19T10:00:00.000Z')

export function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Asta di prova',
    season: '2026/27',
    mode: 'CLASSIC',
    initialBudget: 500,
    minimumPlayerCost: 1,
    roleSlots: { P: 1, D: 1, C: 1, A: 1 } satisfies RoleSlots,
    roleBudgets: null,
    createdBy: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'pppppppp-0000-4000-8000-000000000001',
    externalId: null,
    name: 'Dimarco',
    team: 'Inter',
    role: 'D' as ClassicRole,
    mantraRole: null,
    quotation: 20,
    fvm: 60,
    season: '2026/27',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeAuctionPlayer(status: AuctionPlayerStatus = 'AVAILABLE'): AuctionPlayer {
  return {
    auctionId: makeAuction().id,
    playerId: makePlayer().id,
    status,
    soldPrice: null,
    otherTeamName: null,
    updatedBy: null,
    updatedAt: now,
  }
}

export function makePlayerRow(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    playerId: makePlayer().id,
    name: 'Dimarco',
    team: 'Inter',
    role: 'D',
    mantraRole: null,
    quotation: 20,
    fvm: 60,
    status: 'AVAILABLE',
    soldPrice: null,
    otherTeamName: null,
    purchasePrice: null,
    statsSeason: '2025/26',
    appearances: 34,
    averageRating: 6.3,
    fantasyAverage: 7.1,
    goals: 4,
    assists: 8,
    tier: 'A',
    targetPrice: 40,
    maxPrice: 50,
    priority: 1,
    isTarget: true,
    notes: null,
    ...overrides,
  }
}

export function makeEvent(
  type: AuctionEventType,
  overrides: Partial<AuctionEvent> = {}
): AuctionEvent {
  return {
    id: 'eeeeeeee-0000-4000-8000-000000000001',
    auctionId: makeAuction().id,
    actorUserId: 'user-1',
    playerId: makePlayer().id,
    type,
    payload: { price: 43 },
    createdAt: now,
    revertedAt: null,
    ...overrides,
  }
}

/** Errore Postgres di violazione del vincolo unico, come arriva incapsulato da Drizzle. */
export function uniqueViolation(): Error {
  return new Error('drizzle query failed', {
    cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    }),
  })
}
