import { REVERTABLE_EVENT_TYPES } from '#shared/constants'
import type {
  AuctionEventType,
  AuctionPlayerStatus,
  ClassicRole,
  DomainErrorCode,
} from '#shared/types'
import { computeAuctionState, type AuctionRules, type PurchaseFact } from './budget'

/** Esito di un controllo di dominio: `code` e sempre un codice stabile di `DOMAIN_ERROR_CODES`. */
export type DomainCheck = { ok: true } | { ok: false; code: DomainErrorCode }

const OK: DomainCheck = { ok: true }

function fail(code: DomainErrorCode): DomainCheck {
  return { ok: false, code }
}

/**
 * Controlli di acquisto nell'ordine della spec 24: disponibilita, prezzo minimo, slot di ruolo,
 * budget, offerta che renderebbe impossibile riempire gli slot restanti.
 * Restituisce il primo controllo che fallisce.
 */
export function checkPurchase(input: {
  rules: AuctionRules
  purchases: PurchaseFact[]
  role: ClassicRole
  price: number
  status: AuctionPlayerStatus
}): DomainCheck {
  const { rules, purchases, role, price, status } = input

  if (status !== 'AVAILABLE') {
    return fail(status === 'MY_PLAYER' ? 'PLAYER_ALREADY_OWNED' : 'PLAYER_NOT_AVAILABLE')
  }
  if (price < rules.minimumPlayerCost) return fail('PRICE_BELOW_MINIMUM')

  // L'id non entra in nessun controllo: si riusa il calcolo di stato per non divergere dalla UI.
  const state = computeAuctionState('', rules, purchases)

  const slot = state.slots.find((candidate) => candidate.role === role)
  if (!slot || slot.free <= 0) return fail('ROLE_SLOTS_FULL')
  if (price > state.remainingBudget) return fail('BUDGET_EXCEEDED')
  if (price > state.maxBid) return fail('REMAINING_SLOTS_UNFILLABLE')

  return OK
}

/** Si puo marcare SOLD solo un giocatore ancora disponibile (spec 16). */
export function checkMarkSold(status: AuctionPlayerStatus): DomainCheck {
  if (status === 'AVAILABLE') return OK
  return fail(status === 'MY_PLAYER' ? 'PLAYER_ALREADY_OWNED' : 'PLAYER_NOT_AVAILABLE')
}

/** Un evento si annulla una volta sola e solo se e di un tipo annullabile (spec 25). */
export function checkRevert(event: {
  type: AuctionEventType
  revertedAt: Date | null
}): DomainCheck {
  if (event.revertedAt !== null) return fail('EVENT_ALREADY_REVERTED')
  // `some` e non `includes`: la tupla condivisa e di letterali, `event.type` e il tipo largo.
  if (!REVERTABLE_EVENT_TYPES.some((type) => type === event.type)) {
    return fail('EVENT_NOT_REVERTABLE')
  }
  return OK
}
