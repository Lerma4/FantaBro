import { createHash } from 'node:crypto'
import { normalizeName } from '#shared/utils/normalize'
import type {
  Auction,
  ColumnMapping,
  ImportRowIssue,
  ImportState,
  PlayerImportResult,
  PlayerSeasonStats,
} from '#shared/types'
import { getPlayerDataProvider } from '../providers/players'
import { parseStatsWorkbook } from '../providers/statistics/excel'
import { ensureAuctionPlayers } from '../repositories/auctionPlayers'
import { listAuctionIdsForSeason } from '../repositories/auctions'
import { appendEvent } from '../repositories/events'
import {
  countCommittedForSeason,
  deletePlayersForSeason,
  summarizeListone,
  upsertPlayers,
} from '../repositories/players'
import {
  deleteStatsForSeason,
  resolvePlayerIdsByName,
  summarizeStats,
  upsertSeasonStats,
} from '../repositories/stats'
import { type DbOrTx, db, withTransaction } from '../utils/db'
import { DomainError } from '../utils/errors'
import { publishAuctionChange } from '../utils/events'

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Token di preview: nessuno stato lato server, si ricalcola e si confronta.
 *
 * Copre tutto cio che decide *quali righe* vengono importate: file, mappatura e **foglio**.
 * Il listone ufficiale e multi-foglio, quindi senza il foglio si potrebbe confermare
 * `Portieri` avendo visto in preview `Tutti`. Le chiavi della mappatura sono ordinate
 * (l'ordine con cui il client le rimanda non conta) e `sheet` assente o vuoto collidono.
 *
 * La mappatura da passare e sempre quella **effettiva** (autodetect + override), non quella
 * grezza del client: la UI riempie i selettori con la mappatura rilevata in preview e la
 * rimanda in conferma, e mandare indietro cio che il server ha appena dedotto non e un
 * cambio di import. Solo una mappatura che sposta davvero le colonne invalida il token.
 */
export function importPreviewToken(
  buffer: Buffer,
  mapping?: ColumnMapping,
  sheet?: string
): string {
  const shape = JSON.stringify([Object.entries(mapping ?? {}).sort(), sheet || ''])
  return `${sha256(buffer)}:${sha256(shape)}`
}

/** Conteggio delle anomalie per codice: quello che finisce nel log d'asta. */
function countIssues(issues: ImportRowIssue[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1
  return counts
}

export interface PreviewImportInput {
  buffer: Buffer
  mapping?: ColumnMapping
  sheet?: string
}

export type PreviewImportResult = PlayerImportResult & { previewToken: string }

/** Anteprima dell'import: nessuna scrittura, solo parsing e validazione (spec 13). */
export async function previewImport(input: PreviewImportInput): Promise<PreviewImportResult> {
  const result = await getPlayerDataProvider().loadPlayers({
    buffer: input.buffer,
    sheet: input.sheet,
    mapping: input.mapping,
  })
  return {
    ...result,
    previewToken: importPreviewToken(input.buffer, result.mapping, input.sheet),
  }
}

export interface ConfirmImportInput extends PreviewImportInput {
  auction: Auction
  season: string
  previewToken: string
  userId: string
}

export interface ConfirmImportResult {
  imported: number
  updated: number
  issues: ImportRowIssue[]
}

/**
 * Conferma dell'import. Il token deve corrispondere a quello della preview: senza questo
 * controllo si confermerebbe un file diverso da quello che l'utente ha visto.
 */
export async function confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResult> {
  // Il parsing viene prima del confronto: il token e sulla mappatura effettiva, che si
  // conosce solo dopo. E lettura pura, nessuna scrittura avviene prima del controllo.
  const result = await getPlayerDataProvider().loadPlayers({
    buffer: input.buffer,
    sheet: input.sheet,
    mapping: input.mapping,
  })

  if (importPreviewToken(input.buffer, result.mapping, input.sheet) !== input.previewToken) {
    throw new DomainError('CONFLICT')
  }

  if (!result.importable) {
    throw new DomainError(
      result.missingColumns.length > 0 ? 'IMPORT_MISSING_COLUMNS' : 'IMPORT_NO_VALID_ROWS'
    )
  }

  return withTransaction(async (tx) => {
    const upserted = await upsertPlayers(tx, input.season, result.players)
    await ensureAuctionPlayers(tx, input.auction.id, upserted.playerIds)

    const event = await appendEvent(tx, {
      auctionId: input.auction.id,
      actorUserId: input.userId,
      playerId: null,
      type: 'IMPORT_COMPLETED',
      payload: {
        kind: 'PLAYERS',
        imported: upserted.inserted,
        updated: upserted.updated,
        issues: countIssues(result.issues),
      },
    })

    // Un import tocca migliaia di righe: `playerIds` vuoto vale "ricarica tutto".
    await publishAuctionChange(tx, input.auction.id, { playerIds: [], eventId: event.id })

    return { imported: upserted.inserted, updated: upserted.updated, issues: result.issues }
  })
}

export interface ImportStatsInput {
  auction: Auction
  season: string
  provider: string
  buffer: Buffer
  sheet?: string
  userId: string
}

export interface ImportStatsResult {
  imported: number
  /** Nomi presenti nel foglio ma non riconducibili a un giocatore del listone. */
  unmatched: string[]
  issues: ImportRowIssue[]
}

/**
 * Import delle statistiche di una stagione. Non crea giocatori: un nome non riconosciuto
 * torna in `unmatched`. La stagione la dichiara l'utente ed e la stessa per ogni riga:
 * statistiche di stagioni diverse non si mescolano mai (spec 12).
 */
export async function importStats(input: ImportStatsInput): Promise<ImportStatsResult> {
  const parsed = await parseStatsWorkbook({
    buffer: input.buffer,
    season: input.season,
    sheet: input.sheet,
  })

  if (parsed.stats.length === 0) {
    throw new DomainError(
      parsed.missingColumns.length > 0 ? 'IMPORT_MISSING_COLUMNS' : 'IMPORT_NO_VALID_ROWS'
    )
  }

  return withTransaction(async (tx) => {
    const names = parsed.stats.map((entry) => entry.playerName)
    // Il listone e caricato sulla stagione dell'asta: i nomi si risolvono li. `input.season`
    // e la stagione dei dati e finisce solo sulle righe scritte.
    const resolved = await resolvePlayerIdsByName(tx, input.auction.season, names)
    const updatedAt = new Date()

    const rows: PlayerSeasonStats[] = []
    const unmatched: string[] = []

    for (const entry of parsed.stats) {
      // Il resolver e indicizzato su `players.search_name`: stessa normalizzazione usata in
      // scrittura dall'import del listone, unica per tutto il progetto.
      const playerId = resolved.get(normalizeName(entry.playerName))
      if (!playerId) {
        unmatched.push(entry.playerName)
        continue
      }

      rows.push({
        playerId,
        season: input.season,
        appearances: entry.appearances,
        starts: entry.starts,
        minutes: entry.minutes,
        averageRating: entry.averageRating,
        fantasyAverage: entry.fantasyAverage,
        goals: entry.goals,
        assists: entry.assists,
        yellowCards: entry.yellowCards,
        redCards: entry.redCards,
        penaltiesScored: entry.penaltiesScored,
        penaltiesMissed: entry.penaltiesMissed,
        goalsConceded: entry.goalsConceded,
        penaltiesSaved: entry.penaltiesSaved,
        provider: input.provider,
        updatedAt,
      })
    }

    const imported = rows.length > 0 ? await upsertSeasonStats(tx, rows) : 0

    const event = await appendEvent(tx, {
      auctionId: input.auction.id,
      actorUserId: input.userId,
      playerId: null,
      type: 'IMPORT_COMPLETED',
      payload: {
        kind: 'STATS',
        season: input.season,
        provider: input.provider,
        imported,
        unmatched: unmatched.length,
        issues: countIssues(parsed.issues),
      },
    })

    // Le medie cambiano su tutto il listone: si ricarica tutto.
    await publishAuctionChange(tx, input.auction.id, { playerIds: [], eventId: event.id })

    return { imported, unmatched, issues: parsed.issues }
  })
}

/* ------------------------------------------------------ stato e cancellazioni */

/**
 * Cosa risulta importato per una stagione. Listone e statistiche sono due import
 * distinti, quindi vengono riportati separati e si cancellano separati.
 */
export async function getImportState(season: string): Promise<ImportState> {
  const [listone, committed, stats] = await Promise.all([
    summarizeListone(db, season),
    countCommittedForSeason(db, season),
    summarizeStats(db, season),
  ])

  return {
    players:
      listone.total > 0
        ? { season, total: listone.total, committed, updatedAt: listone.updatedAt }
        : null,
    stats,
  }
}

/**
 * Cancella l'intero listone di una stagione. Come la rimozione del singolo giocatore
 * e un'operazione **globale sulla stagione**: le FK in cascade portano via statistiche,
 * stato d'asta e target di ogni asta che la condivide. Per questo basta un giocatore
 * impegnato per rifiutare tutto: un'asta gia giocata non si perde per un click.
 */
export async function wipeListone(season: string): Promise<{ deleted: number }> {
  return withTransaction(async (tx) => {
    if ((await countCommittedForSeason(tx, season)) > 0) throw new DomainError('LISTONE_IN_USE')

    const deleted = await deletePlayersForSeason(tx, season)
    await reloadSeason(tx, season)
    return { deleted }
  })
}

/**
 * Cancella le statistiche di una sola stagione di dati. Nessun vincolo: sono dati
 * derivati, non spostano ne budget ne rose, e si ri-importano dal foglio.
 */
export async function wipeStats(season: string, statsSeason: string): Promise<{ deleted: number }> {
  return withTransaction(async (tx) => {
    const deleted = await deleteStatsForSeason(tx, season, statsSeason)
    await reloadSeason(tx, season)
    return { deleted }
  })
}

/**
 * `playerIds: []` e la convenzione "ricarica tutto" (vedi `utils/events`), l'unica
 * corretta dopo una cancellazione: non esistono piu righe da aggiornare in posto.
 */
async function reloadSeason(tx: DbOrTx, season: string): Promise<void> {
  for (const auctionId of await listAuctionIdsForSeason(tx, season)) {
    await publishAuctionChange(tx, auctionId, { playerIds: [] })
  }
}
