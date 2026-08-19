import { CLASSIC_ROLES } from '#shared/constants'
import type {
  AuctionState,
  ClassicRole,
  RoleBudgets,
  RoleBudgetState,
  RoleSlots,
  RoleSlotState,
} from '#shared/types'
import { round1 } from './round'

/** Un acquisto della propria rosa, ridotto a quello che serve al calcolo (spec 21). */
export interface PurchaseFact {
  playerId: string
  role: ClassicRole
  price: number
}

/** Configurazione d'asta rilevante per budget e slot. */
export interface AuctionRules {
  initialBudget: number
  minimumPlayerCost: number
  roleSlots: RoleSlots
  roleBudgets: RoleBudgets | null
}

/**
 * Massima offerta possibile mantenendo la possibilita di riempire gli slot restanti (spec 22).
 *
 * ```text
 * maxBid = remainingBudget - ((remainingSlots - 1) * minimumPlayerCost)
 * ```
 *
 * Con rosa completa (`remainingSlots <= 0`) non si puo offrire nulla: `0`.
 * Il risultato non e mai negativo, anche con un budget gia sforato in input.
 */
export function computeMaxBid(
  remainingBudget: number,
  remainingSlots: number,
  minimumPlayerCost: number
): number {
  if (remainingSlots <= 0) return 0
  return Math.max(0, remainingBudget - (remainingSlots - 1) * minimumPlayerCost)
}

function slotState(
  role: ClassicRole,
  rules: AuctionRules,
  purchases: PurchaseFact[]
): RoleSlotState {
  const total = rules.roleSlots[role] ?? 0
  const occupied = purchases.filter((purchase) => purchase.role === role).length
  return { role, total, occupied, free: Math.max(0, total - occupied) }
}

function roleBudgetState(
  role: ClassicRole,
  rules: AuctionRules,
  purchases: PurchaseFact[]
): RoleBudgetState {
  const planned = rules.roleBudgets?.[role] ?? null
  const spent = purchases
    .filter((purchase) => purchase.role === role)
    .reduce((total, purchase) => total + purchase.price, 0)

  if (planned === null) {
    return { role, planned: null, spent, plannedRemaining: null, percentageUsed: null }
  }

  // Con `planned === 0` qualunque spesa e il 100% del pianificato: evita Infinity/NaN.
  const percentageUsed = planned > 0 ? round1((spent / planned) * 100) : spent > 0 ? 100 : 0
  return { role, planned, spent, plannedRemaining: planned - spent, percentageUsed }
}

/**
 * Stato d'asta derivato interamente dagli acquisti: non va mai persistito (spec 21).
 *
 * `slots` e `roleBudgets` contengono sempre tutti e quattro i ruoli classici, nell'ordine
 * di reparto P D C A, cosi la UI non deve gestire buchi.
 */
export function computeAuctionState(
  auctionId: string,
  rules: AuctionRules,
  purchases: PurchaseFact[]
): AuctionState {
  const spent = purchases.reduce((total, purchase) => total + purchase.price, 0)
  const remainingBudget = rules.initialBudget - spent

  const slots = CLASSIC_ROLES.map((role) => slotState(role, rules, purchases))
  const totalSlots = slots.reduce((total, slot) => total + slot.total, 0)
  const occupiedSlots = purchases.length
  const remainingSlots = Math.max(0, totalSlots - occupiedSlots)

  return {
    auctionId,
    initialBudget: rules.initialBudget,
    minimumPlayerCost: rules.minimumPlayerCost,
    spent,
    remainingBudget,
    totalSlots,
    occupiedSlots,
    remainingSlots,
    averageBudgetPerRemainingSlot:
      remainingSlots > 0 ? round1(remainingBudget / remainingSlots) : null,
    maxBid: computeMaxBid(remainingBudget, remainingSlots, rules.minimumPlayerCost),
    slots,
    roleBudgets: CLASSIC_ROLES.map((role) => roleBudgetState(role, rules, purchases)),
  }
}
