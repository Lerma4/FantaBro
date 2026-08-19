/**
 * Costanti canoniche del dominio FantaBro.
 * Unica fonte di verità per enum condivisi tra client, server e worker.
 */

export const APP_ROLES = ['ADMIN', 'MEMBER'] as const

export const AUCTION_MODES = ['CLASSIC', 'MANTRA'] as const
/** V1 supporta solo CLASSIC; MANTRA è previsto dal modello ma non selezionabile. */
export const SUPPORTED_AUCTION_MODES = ['CLASSIC'] as const

export const MEMBER_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const
/** V1 assegna solo OWNER/EDITOR. */
export const ASSIGNABLE_MEMBER_ROLES = ['OWNER', 'EDITOR'] as const

export const CLASSIC_ROLES = ['P', 'D', 'C', 'A'] as const

export const MANTRA_ROLES = ['Por', 'Dc', 'Dd', 'Ds', 'E', 'M', 'C', 'W', 'T', 'A', 'Pc'] as const

export const AUCTION_PLAYER_STATUSES = ['AVAILABLE', 'MY_PLAYER', 'SOLD'] as const

/** Tier di default. Il modello usa `text` per consentire tier custom futuri. */
export const DEFAULT_TIERS = ['A', 'B', 'C', 'D', 'GAMBLE', 'AVOID'] as const

export const AUCTION_EVENT_TYPES = [
  'PLAYER_PURCHASED',
  'PLAYER_PURCHASE_REVERTED',
  'PLAYER_SOLD',
  'PLAYER_SOLD_REVERTED',
  'PLAYER_TARGET_UPDATED',
  'PLAYER_TIER_UPDATED',
  'IMPORT_COMPLETED',
] as const

export const DEFAULT_ROLE_SLOTS = { P: 3, D: 8, C: 8, A: 6 } as const

export const DEFAULT_INITIAL_BUDGET = 500
export const DEFAULT_MINIMUM_PLAYER_COST = 1

/** Soglie di allerta sul prezzo rispetto al prezzo massimo personale (spec §28). */
export const MAX_PRICE_WARNING_RATIO = 0.9
