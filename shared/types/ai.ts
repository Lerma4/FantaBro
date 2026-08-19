import type { AI_PROVIDER_IDS, AI_PROVIDER_STATES, AI_QUICK_ACTIONS } from '../constants/ai'
import type { AiErrorCode, ClassicRole } from './domain'
import type { MarketAnalytics, RoleSlotState } from './views'

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
export type AiProviderState = (typeof AI_PROVIDER_STATES)[number]
export type AiQuickAction = (typeof AI_QUICK_ACTIONS)[number]

export interface AiProviderStatus {
  id: AiProviderId
  state: AiProviderState
  /** Nome dello eseguibile atteso. Mai un path completo, mai credenziali. */
  executable: string
  /** Chiave i18n con la azione amministrativa richiesta, es. `ai.hint.codexLogin`. */
  hintKey?: string
  /** Messaggio diagnostico sanificato: senza segreti o dump di environment. */
  detail?: string
  checkedAt: string
}

export interface PlayerContext {
  name: string
  team: string
  role: ClassicRole
  quotation: number
  fvm: number
  appearances?: number | null
  averageRating?: number | null
  fantasyAverage?: number | null
  goals?: number | null
  assists?: number | null
  tier?: string | null
  targetPrice?: number | null
  maxPrice?: number | null
  currentBid?: number | null
}

export interface RosterPlayerContext {
  name: string
  role: ClassicRole
  purchasePrice: number
}

export interface TargetContext {
  name: string
  role: ClassicRole
  tier?: string | null
  targetPrice?: number | null
  maxPrice?: number | null
  priority?: number | null
}

/** Contesto compatto passato allo AI. Mai un dump del database (spec 41). */
export interface AuctionContext {
  auction: {
    season: string
    mode: string
    initialBudget: number
    remainingBudget: number
    minimumPlayerCost: number
    maxBid: number
  }
  roster: {
    players: RosterPlayerContext[]
    slots: RoleSlotState[]
  }
  currentPlayer?: PlayerContext
  targets: TargetContext[]
  availableAlternatives: PlayerContext[]
  marketAnalytics: MarketAnalytics
}

export interface PlayerAdvice {
  recommendation: 'BUY' | 'WAIT' | 'PASS'
  suggestedMaxPrice?: number
  confidence?: number
  reasoning: string
  alternatives: string[]
}

export interface AiResponse {
  providerId: AiProviderId
  /** Testo sempre presente: fallback quando lo output strutturato non e valido. */
  text: string
  advice?: PlayerAdvice
  durationMs: number
}

/**
 * Errore di provider AI. Trasporta un codice stabile che il client traduce
 * via i18n (`errors.<CODE>`); `detail` e sempre gia sanificato.
 */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message?: string,
    readonly detail?: string
  ) {
    super(message ?? code)
    this.name = 'AiProviderError'
  }
}

/** Contratto unico per tutti gli adapter AI (spec 33). */
export interface AiProvider {
  readonly id: AiProviderId
  getStatus(): Promise<AiProviderStatus>
  ask(context: AuctionContext, prompt: string): Promise<AiResponse>
}
