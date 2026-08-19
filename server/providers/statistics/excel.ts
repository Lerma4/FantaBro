import type { PlayerStatsProvider, StatsImportResult } from '#shared/types'
import { parseStatsRows } from '../../domain/import'
import { ImportFileError, loadWorksheetMatrix } from '../players/worksheet'

export interface ExcelStatsInput {
  buffer: Buffer | ArrayBuffer
  /**
   * Stagione dichiarata dall'utente: il foglio non la contiene (spec 12). Non serve al
   * parsing, resta opzionale perche la stagione la decide e la applica il chiamante.
   */
  season?: string
  sheet?: string
}

/** `loadSeasonStats` riceve `unknown` dal contratto condiviso: quello e il confine, si valida. */
function asExcelStatsInput(input: unknown): ExcelStatsInput {
  if (typeof input !== 'object' || input === null) {
    throw new ImportFileError('missing workbook buffer')
  }

  const { buffer, sheet } = input as Record<keyof ExcelStatsInput, unknown>
  if (!(buffer instanceof ArrayBuffer) && !Buffer.isBuffer(buffer)) {
    throw new ImportFileError('buffer must be a Buffer or an ArrayBuffer')
  }

  return { buffer, sheet: typeof sheet === 'string' ? sheet : undefined }
}

/**
 * Legge un foglio di statistiche stagionali. Il match `playerName -> playerId` resta al
 * layer applicativo, che e il solo ad avere accesso ai giocatori.
 */
export async function parseStatsWorkbook(input: ExcelStatsInput): Promise<StatsImportResult> {
  return parseStatsRows(await loadWorksheetMatrix(input.buffer, input.sheet))
}

export const excelStatsProvider: PlayerStatsProvider = {
  id: 'excel',
  // `async` anche solo per validare: chi chiama il contratto si aspetta un reject, non un throw.
  loadSeasonStats: async (input) => parseStatsWorkbook(asExcelStatsInput(input)),
}
