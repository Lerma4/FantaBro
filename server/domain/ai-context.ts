import { playerAdviceSchema } from '#shared/schemas'
import type {
  AuctionContext,
  AuctionState,
  MarketAnalytics,
  PlayerAdvice,
  PlayerContext,
  PlayerRow,
  RosterPlayerContext,
  TargetContext,
} from '#shared/types'

/**
 * Limiti di default del contesto: il prompt deve restare compatto e rilevante, mai un dump
 * del database (spec 41). Alzarli costa token su ogni invocazione AI.
 */
export const DEFAULT_CONTEXT_LIMITS = { alternatives: 12, targets: 20 } as const

/** Ordina prima le alternative dello stesso ruolo del giocatore in gioco, poi per FVM. */
function compareAlternatives(role: PlayerContext['role'] | undefined) {
  return (a: PlayerContext, b: PlayerContext): number => {
    if (role) {
      const sameRole = Number(b.role === role) - Number(a.role === role)
      if (sameRole !== 0) return sameRole
    }
    return b.fvm - a.fvm
  }
}

/**
 * Ordina i target per priorita crescente (senza priorita in coda), poi per prezzo massimo
 * e prezzo target decrescenti. `TargetContext` non porta l'FVM, quindi i prezzi personali
 * sono il miglior indicatore di importanza disponibile.
 */
function compareTargets(a: TargetContext, b: TargetContext): number {
  const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER
  const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER
  if (priorityA !== priorityB) return priorityA - priorityB

  const valueA = a.maxPrice ?? a.targetPrice ?? 0
  const valueB = b.maxPrice ?? b.targetPrice ?? 0
  if (valueA !== valueB) return valueB - valueA
  return a.name.localeCompare(b.name)
}

/**
 * Riga di listone -> contesto giocatore. `currentBid` e il prezzo in gioco **adesso**, e solo
 * quello: non ricade su `soldPrice`, che e il prezzo a cui un giocatore e uscito dal mercato.
 * Presentarlo come offerta corrente farebbe ragionare il modello su un'asta che non c'e piu.
 */
export function toPlayerContext(row: PlayerRow, currentBid?: number | null): PlayerContext {
  return {
    name: row.name,
    team: row.team,
    role: row.role,
    quotation: row.quotation,
    fvm: row.fvm,
    appearances: row.appearances,
    averageRating: row.averageRating,
    fantasyAverage: row.fantasyAverage,
    goals: row.goals,
    assists: row.assists,
    tier: row.tier,
    targetPrice: row.targetPrice,
    maxPrice: row.maxPrice,
    currentBid: currentBid ?? null,
  }
}

/** Costruisce il contesto compatto passato al provider AI (spec 41). */
export function buildAuctionContext(input: {
  auction: { season: string; mode: string }
  state: AuctionState
  roster: RosterPlayerContext[]
  currentPlayer?: PlayerContext
  targets: TargetContext[]
  alternatives: PlayerContext[]
  /** Giocatori da confrontare: passano cosi come sono, anche se non piu comprabili (spec 30). */
  comparePlayers?: PlayerContext[]
  analytics: MarketAnalytics
  limits?: { alternatives?: number; targets?: number }
}): AuctionContext {
  const alternativesLimit = input.limits?.alternatives ?? DEFAULT_CONTEXT_LIMITS.alternatives
  const targetsLimit = input.limits?.targets ?? DEFAULT_CONTEXT_LIMITS.targets

  return {
    auction: {
      season: input.auction.season,
      mode: input.auction.mode,
      initialBudget: input.state.initialBudget,
      remainingBudget: input.state.remainingBudget,
      minimumPlayerCost: input.state.minimumPlayerCost,
      maxBid: input.state.maxBid,
    },
    roster: { players: input.roster, slots: input.state.slots },
    ...(input.currentPlayer ? { currentPlayer: input.currentPlayer } : {}),
    targets: [...input.targets].sort(compareTargets).slice(0, targetsLimit),
    availableAlternatives: [...input.alternatives]
      .sort(compareAlternatives(input.currentPlayer?.role))
      .slice(0, alternativesLimit),
    ...(input.comparePlayers?.length ? { comparePlayers: input.comparePlayers } : {}),
    marketAnalytics: input.analytics,
  }
}

/**
 * Prompt finale per la CLI: contesto strutturato + la domanda + le regole di risposta.
 * Il contesto va come JSON compatto: e completo per costruzione e non richiede un
 * renderer testuale da tenere allineato al tipo.
 */
export function renderContextPrompt(context: AuctionContext, prompt: string): string {
  return [
    'You are assisting a single fantasy football (Fantacalcio) manager during a live auction.',
    'Prices, quotations, budget, roster and availability come only from the auction context below.',
    'For facts the context does not carry — injuries, suspensions, expected line-ups, recent form —',
    'you may use WebSearch and WebFetch. Keep it to one quick lookup: the user is waiting mid-auction.',
    '',
    '`availableAlternatives` are players you can still buy right now.',
    '`comparePlayers` are players the user asked to compare: some may already be taken or',
    'sold to another team, so never recommend buying one of them unless it is also listed',
    'in `availableAlternatives`.',
    '',
    'AUCTION CONTEXT (JSON):',
    JSON.stringify(context),
    '',
    'QUESTION:',
    prompt,
    '',
    'RULES:',
    '- Reply in Italian.',
    '- Do not run commands, do not read or write files, do not use any tool other than WebSearch',
    '  and WebFetch. If a lookup fails, say so and answer from the context.',
    '- Be concise and concrete: this is read while an auction is running.',
    '- Never invent prices, quotations or statistics that are not in the context above.',
    '- Say where a fact comes from when it comes from the web, and give its date if you have it.',
    '- End the answer with a single JSON block, nothing after it:',
    '```json',
    '{"recommendation":"BUY|WAIT|PASS","suggestedMaxPrice":0,"confidence":0.0,"reasoning":"...","alternatives":["..."]}',
    '```',
    '- `recommendation` and `reasoning` are required, `reasoning` in Italian.',
    '- `confidence` is between 0 and 1. `alternatives` holds player names, possibly empty.',
  ].join('\n')
}

/** Ogni oggetto JSON bilanciato presente nel testo, ignorando le graffe dentro le stringhe. */
function jsonCandidates(text: string): string[] {
  const found: string[] = []

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue

    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < text.length; index++) {
      const char = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        found.push(text.slice(start, index + 1))
        break
      }
    }
  }

  return found
}

/**
 * Toglie dal testo il blocco JSON riconosciuto, con il fence markdown che lo circonda.
 * Il consiglio strutturato viene gia mostrato come scheda: lasciarlo anche nella prosa
 * significa stamparlo due volte all'utente.
 */
function stripAdviceBlock(text: string, candidate: string): string {
  const start = text.lastIndexOf(candidate)
  if (start < 0) return text
  const before = text.slice(0, start).replace(/```(?:json)?[ \t]*\n?$/i, '')
  const after = text.slice(start + candidate.length).replace(/^\s*```/, '')
  return `${before}${after}`.trim()
}

/**
 * Estrae e valida l'output strutturato (spec 46). Funziona anche se il JSON e dentro un
 * fence markdown o circondato da prosa. Se manca o non e valido restituisce solo il testo:
 * non lancia mai, il fallback testuale e sempre disponibile.
 */
export function parseAdvice(rawText: string): { advice?: PlayerAdvice; text: string } {
  const text = rawText.trim()

  // Dal fondo: i modelli chiudono con il blocco JSON richiesto.
  for (const candidate of jsonCandidates(text).reverse()) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch {
      continue
    }
    const parsed = playerAdviceSchema.safeParse(value)
    if (parsed.success) return { advice: parsed.data, text: stripAdviceBlock(text, candidate) }
  }

  return { text }
}
