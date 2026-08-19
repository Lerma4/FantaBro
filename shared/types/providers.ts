import type { ClassicRole, PlayerSeasonStats } from './domain'

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

export interface PlayerStatsProvider {
  readonly id: string
  loadSeasonStats(season: string): Promise<PlayerSeasonStats[]>
}
