import { MAX_PRICE_WARNING_RATIO } from '../constants/domain'

/**
 * Soglia raggiunta dallo offerta corrente rispetto ai prezzi personali (spec 28).
 * Serve solo ad avvisare: non blocca e non compra mai automaticamente.
 *
 * Vive in `shared/` perche la stessa lettura serve al client (banda sotto il campo
 * prezzo, badge del dettaglio) e al server (contesto AI). Una copia per lato divergerebbe:
 * era gia successo, e la copia client aveva perso il livello `AT_MAX`.
 */
export type PriceThreshold =
  'NO_LIMITS' | 'UNDER_TARGET' | 'OVER_TARGET' | 'NEAR_MAX' | 'AT_MAX' | 'OVER_MAX'

/**
 * Priorita: `OVER_MAX` > `AT_MAX` > `NEAR_MAX` > `OVER_TARGET` > `UNDER_TARGET`.
 *
 * `AT_MAX` e un livello a se: il momento in cui hai raggiunto il tuo tetto e quello in cui
 * la decisione cambia, e la spec 28 chiede tre avvisi distinti (vicino, pari, oltre).
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
