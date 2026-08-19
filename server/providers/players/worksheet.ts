// `exceljs` e CommonJS: sotto vitest un import nominale funziona, nel bundle ESM di Nitro
// Node lo rifiuta e il modulo non si carica ("Named export 'Workbook' not found").
// Default import + destrutturazione e l'unica forma che regge in entrambi.
import ExcelJS from 'exceljs'
import type { CellValue, Worksheet } from 'exceljs'
import type { Cell, CellMatrix } from '../../domain/import'

const { Workbook } = ExcelJS

/**
 * File non leggibile come workbook, o foglio inesistente. Porta il codice stabile che il
 * layer API traduce in `errors.IMPORT_INVALID_FILE` (spec 13).
 */
export class ImportFileError extends Error {
  readonly code = 'IMPORT_INVALID_FILE' as const

  constructor(detail?: string) {
    super(detail ?? 'IMPORT_INVALID_FILE')
    this.name = 'ImportFileError'
  }
}

/** Risolve il valore utile di una cella: formule -> risultato, rich text/hyperlink -> testo. */
function resolveCellValue(value: CellValue): Cell {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value !== 'object') return value

  if ('richText' in value) return value.richText.map((part) => part.text).join('')
  if ('formula' in value || 'sharedFormula' in value) return resolveCellValue(value.result)
  if ('text' in value) return value.text
  // Cella in errore (#N/A, #DIV/0!, ...): nessun dato utilizzabile.
  return null
}

/** Foglio -> matrice densa allineata alle righe del foglio (indice 0 = prima riga). */
export function worksheetToMatrix(worksheet: Worksheet): CellMatrix {
  const columnCount = worksheet.columnCount
  const matrix: CellMatrix = []

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber)
    const cells: Cell[] = []
    for (let column = 1; column <= columnCount; column++) {
      cells.push(resolveCellValue(row.getCell(column).value))
    }
    matrix.push(cells)
  }

  return matrix
}

/** ExcelJS tipizza `load` su `ArrayBuffer`: un Buffer di Nitro va copiato. */
function toArrayBuffer(buffer: Buffer | ArrayBuffer): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer
  const copy = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(copy).set(buffer)
  return copy
}

/** Carica il foglio richiesto (per nome) o il primo del workbook. */
export async function loadWorksheetMatrix(
  buffer: Buffer | ArrayBuffer,
  sheet?: string
): Promise<CellMatrix> {
  const workbook = new Workbook()

  try {
    await workbook.xlsx.load(toArrayBuffer(buffer))
  } catch (error) {
    throw new ImportFileError(error instanceof Error ? error.message : 'unreadable workbook')
  }

  const worksheet = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0]
  if (!worksheet) throw new ImportFileError(sheet ? `sheet not found: ${sheet}` : 'empty workbook')

  return worksheetToMatrix(worksheet)
}
