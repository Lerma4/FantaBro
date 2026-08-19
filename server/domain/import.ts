import { CLASSIC_ROLES } from '#shared/constants'
import { REQUIRED_IMPORT_FIELDS } from '#shared/schemas'
import { normalizeName } from '#shared/utils/normalize'
import type {
  ClassicRole,
  ColumnMapping,
  ImportRowIssue,
  ParsedPlayer,
  ParsedPlayerStats,
  PlayerImportField,
  PlayerImportResult,
  StatsImportResult,
} from '#shared/types'

/**
 * Parsing puro del listone: lavora su una matrice di celle gia letta, cosi la logica di
 * validazione e testabile senza toccare ExcelJS (spec 13, 14).
 */
export type Cell = string | number | boolean | Date | null | undefined
export type CellMatrix = Cell[][]

/** Nei listoni ufficiali l'intestazione non e sulla prima riga: si cerca nelle prime righe. */
const HEADER_SEARCH_ROWS = 10

const PLAYER_IMPORT_FIELDS: readonly PlayerImportField[] = [
  'externalId',
  'name',
  'team',
  'role',
  'mantraRole',
  'quotation',
  'fvm',
]

/**
 * Alias di intestazione, gia normalizzati (minuscolo, senza accenti, senza separatori).
 * Il match e sempre di uguaglianza esatta sulla forma normalizzata, mai parziale.
 *
 * Il listone ufficiale affianca le colonne Classic e quelle Mantra: `Qt.A`/`Qt.A M`,
 * `FVM`/`FVM M`. Nessun alias deve corrispondere a una colonna Mantra di valore
 * (`qtam`, `qtim`, `diffm`, `fvmm`) ne alla quotazione iniziale (`qti`): V1 e CLASSIC e
 * importare i valori Mantra darebbe numeri plausibili ma sbagliati. L'esclusione e
 * strutturale, non dipende dall'ordine delle colonne nel foglio.
 * `mantraRole` resta mappato perche `Player.mantraRole` e un campo vero.
 */
const PLAYER_HEADER_ALIASES: Record<PlayerImportField, readonly string[]> = {
  externalId: ['id', 'idruolo', 'playerid', 'codice', 'cod'],
  name: ['nome', 'calciatore', 'giocatore', 'name', 'player', 'playername'],
  team: ['squadra', 'team', 'club'],
  role: ['r', 'rc', 'ruolo', 'ruoloclassico', 'role', 'classicrole'],
  mantraRole: ['rm', 'ruolomantra', 'mantra', 'mantrarole'],
  quotation: ['qta', 'qt', 'qtaattuale', 'quota', 'quotazione', 'quotazioneattuale', 'quotation'],
  fvm: ['fvm', 'fantavaloredimercato'],
}

type StatsField = keyof ParsedPlayerStats
type StatsNumericField = Exclude<StatsField, 'playerName' | 'team'>

const STATS_FIELDS: readonly StatsField[] = [
  'playerName',
  'team',
  'appearances',
  'starts',
  'minutes',
  'averageRating',
  'fantasyAverage',
  'goals',
  'assists',
  'yellowCards',
  'redCards',
  'penaltiesScored',
  'penaltiesMissed',
  'goalsConceded',
  'penaltiesSaved',
]

const STATS_NUMERIC_FIELDS: readonly StatsNumericField[] = STATS_FIELDS.filter(
  (field): field is StatsNumericField => field !== 'playerName' && field !== 'team'
)

/**
 * Alias delle statistiche. Nei file ufficiali `Rc` sono i rigori *calciati*, non i segnati:
 * non viene mappato su nessun campo per non riportare un dato sbagliato.
 */
const STATS_HEADER_ALIASES: Record<StatsField, readonly string[]> = {
  playerName: ['nome', 'calciatore', 'giocatore', 'name', 'player', 'playername'],
  team: ['squadra', 'team', 'club'],
  appearances: ['pv', 'pg', 'presenze', 'partitegiocate', 'appearances'],
  starts: ['tit', 'titolare', 'titolarita', 'starts'],
  minutes: ['mn', 'min', 'minuti', 'minutigiocati', 'minutes'],
  averageRating: ['mv', 'media', 'mediavoto', 'averagerating'],
  fantasyAverage: ['fm', 'mf', 'fantamedia', 'fantamediavoto', 'fantasyaverage'],
  goals: ['gf', 'gol', 'golfatti', 'reti', 'goals'],
  assists: ['as', 'ass', 'assist', 'assists'],
  yellowCards: ['amm', 'ammonizioni', 'gialli', 'cartellinigialli', 'yellowcards'],
  redCards: ['esp', 'espulsioni', 'rossi', 'cartellinirossi', 'redcards'],
  penaltiesScored: ['r+', 'rs', 'rigorisegnati', 'penaltiesscored'],
  penaltiesMissed: ['r-', 'rigorisbagliati', 'penaltiesmissed'],
  goalsConceded: ['gs', 'golsubiti', 'goalsconceded'],
  penaltiesSaved: ['rp', 'rigoriparati', 'penaltiessaved'],
}

function cellToText(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString()
  return String(cell).trim()
}

/** Minuscolo, senza accenti, senza separatori: `Qt. A` e `qta` diventano la stessa chiave. */
function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+-]/g, '')
}

function detectMapping<F extends string>(
  headers: string[],
  fields: readonly F[],
  aliases: Record<F, readonly string[]>
): Partial<Record<F, string>> {
  const mapping: Partial<Record<F, string>> = {}

  for (const header of headers) {
    const text = header.trim()
    if (text === '') continue
    const normalized = normalizeHeader(text)
    const field = fields.find((candidate) => aliases[candidate].includes(normalized))
    if (field && mapping[field] === undefined) mapping[field] = text
  }

  return mapping
}

function columnIndex(headers: string[], header: string | undefined): number {
  if (!header) return -1
  const normalized = normalizeHeader(header)
  return headers.findIndex((candidate) => normalizeHeader(candidate) === normalized)
}

function rowTexts(row: Cell[] | undefined): string[] {
  return (row ?? []).map(cellToText)
}

function isEmptyRow(row: Cell[] | undefined): boolean {
  return rowTexts(row).every((text) => text === '')
}

/**
 * Riga di intestazione = quella che riconosce piu campi, contando anche gli override manuali,
 * cosi una mappatura a mano funziona anche quando l'autodetect non riconosce nulla.
 * A pari punteggio vince la prima; se nessuna riga riconosce qualcosa si usa la prima.
 */
function findHeaderRowIndex<F extends string>(
  matrix: CellMatrix,
  fields: readonly F[],
  aliases: Record<F, readonly string[]>,
  overrides?: Partial<Record<F, string>>
): number {
  let bestIndex = 0
  let bestScore = 0

  for (let index = 0; index < Math.min(matrix.length, HEADER_SEARCH_ROWS); index++) {
    const headers = rowTexts(matrix[index])
    const detected = Object.keys(detectMapping(headers, fields, aliases)).length
    const manual = Object.values(overrides ?? {}).filter(
      (header) => typeof header === 'string' && columnIndex(headers, header) !== -1
    ).length

    if (detected + manual > bestScore) {
      bestScore = detected + manual
      bestIndex = index
    }
  }

  return bestIndex
}

/** Indice dell'ultima riga non vuota: le righe vuote in coda al foglio non sono un problema. */
function lastMeaningfulRow(matrix: CellMatrix, headerRowIndex: number): number {
  let last = matrix.length - 1
  while (last > headerRowIndex && isEmptyRow(matrix[last])) last--
  return last
}

function toClassicRole(text: string): ClassicRole | null {
  const upper = text.trim().toUpperCase()
  return CLASSIC_ROLES.find((role) => role === upper) ?? null
}

type NumberCell = { value: number } | { error: 'MISSING_VALUE' | 'INVALID_NUMBER' }

/** Accetta numeri e stringhe con virgola decimale. Valori negativi = non validi. */
function parseNumberCell(cell: Cell): NumberCell {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) && cell >= 0 ? { value: cell } : { error: 'INVALID_NUMBER' }
  }

  const text = cellToText(cell)
  if (text === '') return { error: 'MISSING_VALUE' }

  const value = Number(text.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(value) && value >= 0 ? { value } : { error: 'INVALID_NUMBER' }
}

/** Mappatura automatica campo logico -> intestazione trovata nel foglio (spec 13). */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  return detectMapping(headers, PLAYER_IMPORT_FIELDS, PLAYER_HEADER_ALIASES)
}

/**
 * Valida il listone riga per riga: niente riga malformata importata in silenzio (spec 13).
 *
 * - le righe vuote in coda al foglio vengono ignorate e non contano in `totalRows`;
 *   una riga vuota in mezzo ai dati produce una issue `EMPTY_ROW` (non bloccante);
 * - se manca una colonna obbligatoria le righe non vengono nemmeno validate: il problema
 *   da mostrare e la mappatura, non centinaia di issue derivate;
 * - un duplicato su `(nome, squadra)` normalizzati e segnalato sulla seconda occorrenza,
 *   che non viene importata.
 */
export function parsePlayerRows(matrix: CellMatrix, overrides?: ColumnMapping): PlayerImportResult {
  const headerRowIndex = findHeaderRowIndex(
    matrix,
    PLAYER_IMPORT_FIELDS,
    PLAYER_HEADER_ALIASES,
    overrides
  )
  const detectedHeaders = rowTexts(matrix[headerRowIndex])

  const mapping: ColumnMapping = detectColumnMapping(detectedHeaders)
  for (const field of PLAYER_IMPORT_FIELDS) {
    const header = overrides?.[field]
    if (header) mapping[field] = header
  }

  const indexes = {} as Record<PlayerImportField, number>
  for (const field of PLAYER_IMPORT_FIELDS) {
    indexes[field] = columnIndex(detectedHeaders, mapping[field])
  }

  const dataRows = matrix.slice(headerRowIndex + 1, lastMeaningfulRow(matrix, headerRowIndex) + 1)
  const totalRows = dataRows.length
  const missingColumns = REQUIRED_IMPORT_FIELDS.filter((field) => indexes[field] === -1)

  if (missingColumns.length > 0) {
    return {
      players: [],
      issues: [],
      mapping,
      missingColumns: [...missingColumns],
      detectedHeaders,
      totalRows,
      importable: false,
    }
  }

  const players: ParsedPlayer[] = []
  const issues: ImportRowIssue[] = []
  const seen = new Set<string>()

  dataRows.forEach((row, offset) => {
    const rowNumber = headerRowIndex + 2 + offset

    if (isEmptyRow(row)) {
      issues.push({ row: rowNumber, code: 'EMPTY_ROW' })
      return
    }

    const rowIssues: ImportRowIssue[] = []

    const name = cellToText(row[indexes.name])
    if (name === '') rowIssues.push({ row: rowNumber, column: mapping.name, code: 'MISSING_VALUE' })

    const team = cellToText(row[indexes.team])
    if (team === '') rowIssues.push({ row: rowNumber, column: mapping.team, code: 'MISSING_VALUE' })

    const roleText = cellToText(row[indexes.role])
    const role = toClassicRole(roleText)
    if (role === null) {
      rowIssues.push({
        row: rowNumber,
        column: mapping.role,
        code: roleText === '' ? 'MISSING_VALUE' : 'INVALID_ROLE',
        value: roleText || undefined,
      })
    }

    const quotation = parseNumberCell(row[indexes.quotation])
    if ('error' in quotation) {
      rowIssues.push({
        row: rowNumber,
        column: mapping.quotation,
        code: quotation.error,
        value: cellToText(row[indexes.quotation]) || undefined,
      })
    }

    const fvm = parseNumberCell(row[indexes.fvm])
    if ('error' in fvm) {
      rowIssues.push({
        row: rowNumber,
        column: mapping.fvm,
        code: fvm.error,
        value: cellToText(row[indexes.fvm]) || undefined,
      })
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues)
      return
    }
    if (role === null || 'error' in quotation || 'error' in fvm) return

    // Stessa normalizzazione del match nome -> playerId: chiavi che divergono = duplicati non visti.
    const key = normalizeName(name) + '|' + normalizeName(team)
    if (seen.has(key)) {
      issues.push({ row: rowNumber, column: mapping.name, code: 'DUPLICATE', value: name })
      return
    }
    seen.add(key)

    players.push({
      externalId: cellToText(row[indexes.externalId]) || null,
      name,
      team,
      role,
      mantraRole: cellToText(row[indexes.mantraRole]) || null,
      quotation: quotation.value,
      fvm: fvm.value,
    })
  })

  return {
    players,
    issues,
    mapping,
    missingColumns: [],
    detectedHeaders,
    totalRows,
    importable: players.length > 0,
  }
}

/**
 * Foglio statistiche: richiede solo il nome del giocatore, tutto il resto puo restare `null`
 * (spec 12). Un valore numerico non interpretabile viene segnalato ma non scarta la riga,
 * il campo resta `null`. Il match nome -> playerId e a carico del layer applicativo.
 */
export function parseStatsRows(matrix: CellMatrix): StatsImportResult {
  const headerRowIndex = findHeaderRowIndex(matrix, STATS_FIELDS, STATS_HEADER_ALIASES)
  const detectedHeaders = rowTexts(matrix[headerRowIndex])
  const mapping = detectMapping(detectedHeaders, STATS_FIELDS, STATS_HEADER_ALIASES)

  const indexes = {} as Record<StatsField, number>
  for (const field of STATS_FIELDS) indexes[field] = columnIndex(detectedHeaders, mapping[field])

  if (indexes.playerName === -1) {
    return { stats: [], issues: [], detectedHeaders, missingColumns: ['playerName'] }
  }

  const stats: ParsedPlayerStats[] = []
  const issues: ImportRowIssue[] = []
  const dataRows = matrix.slice(headerRowIndex + 1, lastMeaningfulRow(matrix, headerRowIndex) + 1)

  dataRows.forEach((row, offset) => {
    const rowNumber = headerRowIndex + 2 + offset

    if (isEmptyRow(row)) {
      issues.push({ row: rowNumber, code: 'EMPTY_ROW' })
      return
    }

    const playerName = cellToText(row[indexes.playerName])
    if (playerName === '') {
      issues.push({ row: rowNumber, column: mapping.playerName, code: 'MISSING_VALUE' })
      return
    }

    const entry: ParsedPlayerStats = {
      playerName,
      team: cellToText(row[indexes.team]) || null,
      appearances: null,
      starts: null,
      minutes: null,
      averageRating: null,
      fantasyAverage: null,
      goals: null,
      assists: null,
      yellowCards: null,
      redCards: null,
      penaltiesScored: null,
      penaltiesMissed: null,
      goalsConceded: null,
      penaltiesSaved: null,
    }

    for (const field of STATS_NUMERIC_FIELDS) {
      if (indexes[field] === -1) continue
      const cell = row[indexes[field]]
      const parsed = parseNumberCell(cell)
      if ('value' in parsed) {
        entry[field] = parsed.value
      } else if (parsed.error === 'INVALID_NUMBER') {
        issues.push({
          row: rowNumber,
          column: mapping[field],
          code: 'INVALID_NUMBER',
          value: cellToText(cell) || undefined,
        })
      }
    }

    stats.push(entry)
  })

  return { stats, issues, detectedHeaders, missingColumns: [] }
}
