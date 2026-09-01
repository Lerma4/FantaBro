import type {
  APP_ROLES,
  AUCTION_EVENT_TYPES,
  AUCTION_MODES,
  AUCTION_PLAYER_STATUSES,
  CLASSIC_ROLES,
  MEMBER_ROLES,
} from '../constants/domain'
import type { AI_ERROR_CODES, DOMAIN_ERROR_CODES } from '../constants/errors'

export type AppRole = (typeof APP_ROLES)[number]
export type AuctionMode = (typeof AUCTION_MODES)[number]
export type MemberRole = (typeof MEMBER_ROLES)[number]
export type ClassicRole = (typeof CLASSIC_ROLES)[number]
export type AuctionPlayerStatus = (typeof AUCTION_PLAYER_STATUSES)[number]
export type AuctionEventType = (typeof AUCTION_EVENT_TYPES)[number]
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]
export type AiErrorCode = (typeof AI_ERROR_CODES)[number]
export type ErrorCode = DomainErrorCode | AiErrorCode

/** Slot per ruolo classico. */
export type RoleSlots = Record<ClassicRole, number>
/** Budget pianificato per ruolo (facoltativo, solo consultivo - spec 23). */
export type RoleBudgets = Partial<Record<ClassicRole, number>>

export interface User {
  id: string
  email: string
  name: string
  role: AppRole
  isBootstrapAdmin: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Auction {
  id: string
  name: string
  season: string
  mode: AuctionMode
  initialBudget: number
  minimumPlayerCost: number
  roleSlots: RoleSlots
  roleBudgets: RoleBudgets | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface AuctionMember {
  auctionId: string
  userId: string
  role: MemberRole
  createdAt: Date
  /** Presente quando la membership viene letta con join sullo utente. */
  user?: Pick<User, 'id' | 'email' | 'name'>
}

export interface Player {
  id: string
  externalId: string | null
  name: string
  team: string
  role: ClassicRole
  mantraRole: string | null
  quotation: number
  fvm: number
  season: string
  createdAt: Date
  updatedAt: Date
}

export interface PlayerSeasonStats {
  playerId: string
  season: string
  appearances: number | null
  starts: number | null
  minutes: number | null
  averageRating: number | null
  fantasyAverage: number | null
  goals: number | null
  assists: number | null
  yellowCards: number | null
  redCards: number | null
  penaltiesScored: number | null
  penaltiesMissed: number | null
  goalsConceded: number | null
  penaltiesSaved: number | null
  provider: string
  updatedAt: Date
}

export interface AuctionPlayer {
  auctionId: string
  playerId: string
  status: AuctionPlayerStatus
  soldPrice: number | null
  otherTeamName: string | null
  updatedBy: string | null
  updatedAt: Date
}

export interface PlayerTarget {
  auctionId: string
  playerId: string
  tier: string | null
  targetPrice: number | null
  maxPrice: number | null
  priority: number | null
  notes: string | null
  isTarget: boolean
  updatedAt: Date
}

export interface RosterPlayer {
  id: string
  rosterId: string
  playerId: string
  purchasePrice: number
  purchasedAt: Date
}

export interface AuctionEvent {
  id: string
  auctionId: string
  actorUserId: string | null
  playerId: string | null
  type: AuctionEventType
  payload: Record<string, unknown>
  createdAt: Date
  revertedAt: Date | null
}
