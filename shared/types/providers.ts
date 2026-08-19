import type { ClassicRole } from './domain'

/** Riga giocatore validata, pronta per lo upsert. */
export interface ParsedPlayer {
  externalId: string | null
  name: string
  team: string
  role: ClassicRole
  mantraRole: string | null
  quotation: number
  fvm: number
}

export type PlayerImportField =
  'externalId' | 'name' | 'team' | 'role' | 'mantraRole' | 'quotation' | 'fvm'

export interface ImportRowIssue {
  /** 1-based, come mostrato dal foglio di calcolo. */
  row: number
  column?: string
  code:
    | 'MISSING_VALUE'
    | 'INVALID_ROLE'
    | 'INVALID_NUMBER'
    | 'DUPLICATE'
    | 'MALFORMED_ROW'
    | 'EMPTY_ROW'
  value?: string
}

/** Mappatura campo logico -> intestazione trovata nel foglio. */
export type ColumnMapping = Partial<Record<PlayerImportField, string>>

export interface PlayerImportResult {
  players: ParsedPlayer[]
  issues: ImportRowIssue[]
  mapping: ColumnMapping
  missingColumns: PlayerImportField[]
  detectedHeaders: string[]
  totalRows: number
  /** `true` solo se non manca nessuna colonna obbligatoria e ci e almeno una riga valida. */
  importable: boolean
}

export interface PlayerDataProvider {
  readonly id: string
  loadPlayers(input: unknown): Promise<PlayerImportResult>
}

/**
 * Riga di statistiche letta da una fonte esterna, ancora non risolta su un giocatore:
 * le fonti conoscono il nome, non il nostro id. Il match lo fa il layer applicativo,
 * che e il solo ad avere accesso ai giocatori.
 */
export interface ParsedPlayerStats {
  playerName: string
  team: string | null
  appearances: number | null
  starts: number | null
  minutes: number | null
  averageRating: number | null
  fantasyAverage: number | null
  goals: number | null
  assists: number | null
  yellowCards: number | null
  redCards: number | null
  penaltiesScored: number | null
  penaltiesMissed: number | null
  goalsConceded: number | null
  penaltiesSaved: number | null
}

export interface StatsImportResult {
  stats: ParsedPlayerStats[]
  issues: ImportRowIssue[]
  detectedHeaders: string[]
  missingColumns: string[]
}

/**
 * `input` e volutamente `unknown` come in `PlayerDataProvider`: una fonte Excel ha bisogno
 * del file caricato a mano, una fonte HTTP futura della sola stagione. La stagione di
 * riferimento la dichiara e la applica il chiamante, cosi non si mescolano stagioni (spec 12).
 */
export interface PlayerStatsProvider {
  readonly id: string
  loadSeasonStats(input: unknown): Promise<StatsImportResult>
}
