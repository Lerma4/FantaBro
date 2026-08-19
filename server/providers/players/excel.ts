import type { ColumnMapping, PlayerDataProvider, PlayerImportResult } from '#shared/types'
import { parsePlayerRows } from '../../domain/import'
import { ImportFileError, loadWorksheetMatrix } from './worksheet'

/** Input del provider Excel: il file caricato a mano piu la mappatura eventualmente corretta. */
export interface ExcelPlayerInput {
  buffer: Buffer | ArrayBuffer
  sheet?: string
  mapping?: ColumnMapping
}

/** `loadPlayers` riceve `unknown` dal contratto condiviso: qui e un confine, si valida. */
function asExcelPlayerInput(input: unknown): ExcelPlayerInput {
  if (typeof input !== 'object' || input === null) {
    throw new ImportFileError('missing workbook buffer')
  }

  const { buffer, sheet, mapping } = input as Record<keyof ExcelPlayerInput, unknown>
  if (!(buffer instanceof ArrayBuffer) && !Buffer.isBuffer(buffer)) {
    throw new ImportFileError('buffer must be a Buffer or an ArrayBuffer')
  }

  return {
    buffer,
    sheet: typeof sheet === 'string' ? sheet : undefined,
    mapping:
      typeof mapping === 'object' && mapping !== null ? (mapping as ColumnMapping) : undefined,
  }
}

/**
 * Import manuale da XLSX: deve restare disponibile a prescindere da qualunque altro
 * provider (spec 13, 14). L'unico punto del dominio che tocca ExcelJS e questo layer.
 */
export const excelPlayerProvider: PlayerDataProvider = {
  id: 'excel',

  async loadPlayers(input: unknown): Promise<PlayerImportResult> {
    const { buffer, sheet, mapping } = asExcelPlayerInput(input)
    return parsePlayerRows(await loadWorksheetMatrix(buffer, sheet), mapping)
  },
}
