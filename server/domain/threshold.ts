import { MAX_PRICE_WARNING_RATIO } from '#shared/constants'

/**
 * Soglia raggiunta dall'offerta corrente rispetto ai prezzi personali (spec 28).
 * Serve solo ad avvisare: non blocca e non compra mai automaticamente.
 */
export type PriceThreshold =
  'NO_LIMITS' | 'UNDER_TARGET' | 'OVER_TARGET' | 'NEAR_MAX' | 'AT_MAX' | 'OVER_MAX'

/**
 * Priorita: `OVER_MAX` > `AT_MAX` > `NEAR_MAX` > `OVER_TARGET` > `UNDER_TARGET`.
 *
 * `NO_LIMITS` solo quando non e impostato nessun limite: con un solo limite impostato e
 * un prezzo tranquillo il risultato e `UNDER_TARGET` (zona sicura).
 */
export function evaluatePriceThreshold(
  price: number,
  targetPrice: number | null,
  maxPrice: number | null
): PriceThreshold {
  if (maxPrice !== null) {
    if (price > maxPrice) return 'OVER_MAX'
    if (price === maxPrice) return 'AT_MAX'
    if (price >= maxPrice * MAX_PRICE_WARNING_RATIO) return 'NEAR_MAX'
  }
  if (targetPrice !== null && price > targetPrice) return 'OVER_TARGET'
  if (targetPrice !== null || maxPrice !== null) return 'UNDER_TARGET'
  return 'NO_LIMITS'
}
