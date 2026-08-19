import {
  CLASSIC_ROLES,
  DEFAULT_INITIAL_BUDGET,
  DEFAULT_MINIMUM_PLAYER_COST,
  DEFAULT_ROLE_SLOTS,
} from '#shared/constants'
import type { AuctionSummary, ClassicRole, RoleBudgets, RoleSlots } from '#shared/types'

export interface AuctionFormState {
  name: string
  season: string
  initialBudget: number
  minimumPlayerCost: number
  roleSlots: RoleSlots
  /** `undefined` = ruolo non pianificato: il campo resta vuoto. */
  roleBudgets: Partial<Record<ClassicRole, number | undefined>>
}

export function emptyAuctionForm(): AuctionFormState {
  return {
    name: '',
    season: '2026/27',
    initialBudget: DEFAULT_INITIAL_BUDGET,
    minimumPlayerCost: DEFAULT_MINIMUM_PLAYER_COST,
    roleSlots: { ...DEFAULT_ROLE_SLOTS },
    roleBudgets: {},
  }
}

export function auctionFormFrom(summary: AuctionSummary): AuctionFormState {
  return {
    name: summary.name,
    season: summary.season,
    initialBudget: summary.initialBudget,
    minimumPlayerCost: summary.minimumPlayerCost,
    roleSlots: { ...summary.roleSlots },
    roleBudgets: { ...(summary.roleBudgets ?? {}) },
  }
}

/** I campi ruolo vuoti non vanno inviati; nessun budget pianificato vale `null`. */
export function auctionFormPayload(state: AuctionFormState) {
  const roleBudgets: RoleBudgets = {}
  for (const role of CLASSIC_ROLES) {
    const value = state.roleBudgets[role]
    if (typeof value === 'number' && Number.isFinite(value)) roleBudgets[role] = value
  }

  return {
    name: state.name.trim(),
    season: state.season.trim(),
    initialBudget: state.initialBudget,
    minimumPlayerCost: state.minimumPlayerCost,
    roleSlots: state.roleSlots,
    roleBudgets: Object.keys(roleBudgets).length > 0 ? roleBudgets : null,
  }
}
