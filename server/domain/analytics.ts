import { CLASSIC_ROLES, DEFAULT_TIERS } from '#shared/constants'
import type { ClassicRole, MarketAnalytics, MarketBucket } from '#shared/types'
import { round1, round2 } from './round'

/** Un giocatore uscito dal mercato (mio o di altri) ridotto ai dati che servono alle analytics. */
export interface SoldFact {
  playerId: string
  role: ClassicRole
  fvm: number
  /** `null` quando il prezzo non e stato registrato: escluso da ogni media (spec 31). */
  soldPrice: number | null
  tier: string | null
}

/** Chiave del bucket che raccoglie i venduti senza tier assegnato. */
export const NO_TIER_BUCKET_KEY = '—'
/** Chiave del bucket complessivo. */
export const OVERALL_BUCKET_KEY = 'ALL'

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return round1(values.reduce((total, value) => total + value, 0) / values.length)
}

/**
 * Un bucket usa SOLO le righe con prezzo realmente registrato: `soldCount` e il numero di
 * vendite prezzate su cui poggiano le medie, mai il totale dei venduti (spec 31).
 */
function buildBucket(key: string, facts: SoldFact[]): MarketBucket {
  const priced = facts.filter((fact) => fact.soldPrice !== null)
  const averageSoldPrice = average(priced.map((fact) => fact.soldPrice ?? 0))
  const averageFvm = average(priced.map((fact) => fact.fvm))

  const comparable = averageSoldPrice !== null && averageFvm !== null && averageFvm > 0
  return {
    key,
    soldCount: priced.length,
    averageSoldPrice,
    averageFvm,
    priceToFvm: comparable ? round2(averageSoldPrice / averageFvm) : null,
    premiumVsFvmPct: comparable ? round1((averageSoldPrice / averageFvm - 1) * 100) : null,
  }
}

/** Tier di default prima (nel loro ordine), poi tier custom in ordine alfabetico, senza-tier ultimo. */
function compareTierKeys(a: string, b: string): number {
  if (a === NO_TIER_BUCKET_KEY) return 1
  if (b === NO_TIER_BUCKET_KEY) return -1

  const defaults: readonly string[] = DEFAULT_TIERS
  const indexA = defaults.indexOf(a)
  const indexB = defaults.indexOf(b)
  if (indexA !== -1 && indexB !== -1) return indexA - indexB
  if (indexA !== -1) return -1
  if (indexB !== -1) return 1
  return a.localeCompare(b)
}

/**
 * Andamento reale del mercato d'asta (spec 31).
 *
 * **Le medie comprendono i propri acquisti**, non solo i giocatori andati ad altri: sono
 * prezzi realmente pagati nella stessa asta. Va tenuto presente l'anello di retroazione che
 * ne deriva: se sovrapago, la media di mercato sale e il confronto successivo dice che quel
 * prezzo e normale. Chi legge il numero, UI o prompt AI, deve saperlo.
 *
 * `byRole` ha sempre un bucket per ognuno dei quattro ruoli, anche a zero vendite.
 * `byTier` ha un bucket per ogni tier presente fra i venduti, piu `NO_TIER_BUCKET_KEY`
 * se ci sono venduti senza tier.
 */
export function computeMarketAnalytics(sold: SoldFact[]): MarketAnalytics {
  const tierKeys = [...new Set(sold.map((fact) => fact.tier ?? NO_TIER_BUCKET_KEY))].sort(
    compareTierKeys
  )

  return {
    overall: buildBucket(OVERALL_BUCKET_KEY, sold),
    byRole: CLASSIC_ROLES.map((role) =>
      buildBucket(
        role,
        sold.filter((fact) => fact.role === role)
      )
    ),
    byTier: tierKeys.map((key) =>
      buildBucket(
        key,
        sold.filter((fact) => (fact.tier ?? NO_TIER_BUCKET_KEY) === key)
      )
    ),
    soldWithoutPrice: sold.filter((fact) => fact.soldPrice === null).length,
  }
}
