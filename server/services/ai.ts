import { AI_PROVIDER_IDS } from '#shared/constants'
import type { AiProviderId, AiQuickAction, AiResponse, Auction } from '#shared/types'
import { DEFAULT_CONTEXT_LIMITS, buildAuctionContext, toPlayerContext } from '../domain/ai-context'
import { askWithProvider } from '../providers/ai'
import { findPlayerRows, listPlayerRows } from '../repositories/players'
import { listRoster } from '../repositories/roster'
import { getSetting } from '../repositories/settings'
import { listTargets } from '../repositories/targets'
import { db, type DbOrTx } from '../utils/db'
import { loadMarketAnalytics } from './analytics'
import { loadAuctionState } from './auctionState'
import { loadStatsSeason } from './playerRows'

/** Chiave di impostazione del provider AI predefinito (pagina di amministrazione, spec 40). */
export const AI_DEFAULT_PROVIDER_SETTING = 'ai.defaultProviderId'

function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * Provider da usare: scelta esplicita della richiesta, poi impostazione salvata, poi
 * il default di configurazione. Un valore salvato non piu valido non blocca la richiesta.
 */
export async function resolveProviderId(
  database: DbOrTx,
  explicit?: AiProviderId
): Promise<AiProviderId> {
  if (explicit) return explicit

  const stored = await getSetting<AiProviderId>(database, AI_DEFAULT_PROVIDER_SETTING)
  if (isAiProviderId(stored)) return stored

  const configured = useRuntimeConfig().ai.defaultProvider
  return isAiProviderId(configured) ? configured : AI_PROVIDER_IDS[0]
}

export interface AskAiInput {
  auction: Auction
  providerId?: AiProviderId
  prompt: string
  playerId?: string
  currentBid?: number
  comparePlayerIds?: string[]
}

/**
 * Domanda all'AI con il contesto d'asta costruito automaticamente (spec 41).
 *
 * Non scrive **niente** sul database: una risposta AI non modifica mai lo stato d'asta
 * (spec 43). Nel contesto entrano solo dati di questa asta: nessuna credenziale, nessun
 * segreto, nessun dato di altri utenti.
 */
export async function askAi(input: AskAiInput): Promise<AiResponse> {
  const { auction } = input
  const providerId = await resolveProviderId(db, input.providerId)

  const [state, roster, targets, analytics, statsSeason] = await Promise.all([
    loadAuctionState(db, auction),
    listRoster(db, auction.id),
    listTargets(db, auction.id),
    loadMarketAnalytics(db, auction.id),
    loadStatsSeason(db, auction),
  ])

  const focusIds = [...(input.playerId ? [input.playerId] : []), ...(input.comparePlayerIds ?? [])]
  const focusRows =
    focusIds.length > 0 ? await findPlayerRows(db, auction.id, focusIds, statsSeason) : []

  const currentRow = focusRows.find((row) => row.playerId === input.playerId)
  const currentPlayer = currentRow
    ? toPlayerContext(currentRow, input.currentBid ?? null)
    : undefined

  // I giocatori da confrontare vanno in un campo loro: `findPlayerRows` e una lookup per id
  // e puo restituire un giocatore venduto o in rosa. Metterli fra le alternative li
  // etichetterebbe come comprabili, e l'AI consiglierebbe un giocatore non piu acquistabile.
  const comparePlayers = focusRows
    .filter((row) => row.playerId !== input.playerId)
    .map((row) => toPlayerContext(row))

  // Alternative reali: solo giocatori ancora disponibili, FVM piu alto, stesso ruolo di
  // quello in esame quando c'e.
  const available = await listPlayerRows(
    db,
    auction.id,
    {
      status: 'AVAILABLE',
      sort: 'fvm',
      dir: 'desc',
      limit: DEFAULT_CONTEXT_LIMITS.alternatives,
      offset: 0,
      ...(currentRow ? { role: [currentRow.role] } : {}),
    },
    statsSeason
  )

  const alternatives = available.rows
    .filter((row) => row.playerId !== input.playerId)
    .map((row) => toPlayerContext(row))

  const context = buildAuctionContext({
    auction: { season: auction.season, mode: auction.mode },
    state,
    roster: roster.map((player) => ({
      name: player.name,
      role: player.role,
      purchasePrice: player.purchasePrice,
    })),
    currentPlayer,
    targets: targets.map((target) => ({
      name: target.name,
      role: target.role,
      tier: target.tier,
      targetPrice: target.targetPrice,
      maxPrice: target.maxPrice,
      priority: target.priority,
    })),
    alternatives,
    comparePlayers,
    analytics,
  })

  return askWithProvider(providerId, context, input.prompt)
}

/**
 * Prompt predefiniti delle azioni rapide (spec 42). Sono istruzioni per il provider, non
 * testo mostrato all'utente: le etichette dei pulsanti vivono in i18n.
 */
const QUICK_ACTION_PROMPTS: Record<AiQuickAction, string> = {
  ANALYZE_PLAYER:
    'Analizza il giocatore in esame: rendimento della stagione precedente, quotazione, FVM e quanto conviene puntarci in questa asta.',
  IS_PRICE_WORTH_IT:
    'Il prezzo attualmente in gioco vale questo giocatore? Considera budget residuo, slot ancora da riempire e i prezzi di mercato registrati finora.',
  COMPARE_PLAYERS:
    'Confronta i giocatori indicati e dimmi quale conviene di piu per la mia rosa, con un prezzo massimo consigliato per ognuno.',
  RECOMMEND_NEXT_PURCHASE:
    'Su quale giocatore ancora disponibile dovrei puntare adesso, dati budget residuo, slot liberi e i miei target?',
  ANALYZE_MY_ROSTER:
    'Analizza la mia rosa attuale: punti forti, reparti scoperti e cosa manca per completarla entro il budget residuo.',
  WHERE_SHOULD_I_SPEND:
    'Come dovrei distribuire il budget residuo fra i reparti ancora da completare?',
  FIND_AVAILABLE_VALUE:
    'Fra i giocatori ancora disponibili, quali sono le occasioni migliori rispetto ai prezzi che il mercato sta pagando in questa asta?',
}

export interface QuickActionInput extends Omit<AskAiInput, 'prompt'> {
  action: AiQuickAction
}

/** Azione rapida: stesso contesto della chat libera, prompt predefinito (spec 42). */
export function quickAction(input: QuickActionInput): Promise<AiResponse> {
  const { action, ...rest } = input
  return askAi({ ...rest, prompt: QUICK_ACTION_PROMPTS[action] })
}
