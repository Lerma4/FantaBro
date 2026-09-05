import type {
  AuctionEventType,
  AuctionPlayerStatus,
  ClassicRole,
  RoleBudgets,
  RoleSlots,
} from './domain'

/** Riga del listone: player + stato asta + statistiche stagione precedente + dati personali. */
export interface PlayerRow {
  playerId: string
  name: string
  team: string
  role: ClassicRole
  mantraRole: string | null
  quotation: number
  fvm: number
  status: AuctionPlayerStatus
  soldPrice: number | null
  otherTeamName: string | null
  purchasePrice: number | null
  /** Stagione delle statistiche riportate. La UI deve sempre mostrarla (spec 12). */
  statsSeason: string | null
  appearances: number | null
  averageRating: number | null
  fantasyAverage: number | null
  goals: number | null
  assists: number | null
  tier: string | null
  targetPrice: number | null
  maxPrice: number | null
  priority: number | null
  isTarget: boolean
  notes: string | null
}

/** Statistiche della stagione d'asta, richieste al provider al momento dell'apertura. */
export interface PlayerCurrentStats {
  season: string
  appearances: number
  starts: number | null
  teamAppearances: number
  minutes: number
  averageRating: number | null
  goals: number
  assists: number
  pros: string | null
  cons: string | null
  provider: 'api-football' | 'fantacalcio'
  updatedAt: string
}

export interface RoleSlotState {
  role: ClassicRole
  total: number
  occupied: number
  free: number
}

export interface RoleBudgetState {
  role: ClassicRole
  planned: number | null
  spent: number
  plannedRemaining: number | null
  /** 0-100+, `null` quando non e stato pianificato nulla per il ruolo. */
  percentageUsed: number | null
}

/** Stato derivato: mai persistito, sempre ricalcolato dagli acquisti (spec 21). */
export interface AuctionState {
  auctionId: string
  initialBudget: number
  minimumPlayerCost: number
  spent: number
  remainingBudget: number
  totalSlots: number
  occupiedSlots: number
  remainingSlots: number
  /** `null` quando non restano slot. */
  averageBudgetPerRemainingSlot: number | null
  maxBid: number
  slots: RoleSlotState[]
  roleBudgets: RoleBudgetState[]
}

export interface AuctionSummary {
  id: string
  name: string
  season: string
  mode: string
  initialBudget: number
  minimumPlayerCost: number
  roleSlots: RoleSlots
  roleBudgets: RoleBudgets | null
  memberRole: string
  playersCount: number
}

export interface AuctionEventRow {
  id: string
  type: AuctionEventType
  playerId: string | null
  playerName: string | null
  actorName: string | null
  payload: Record<string, unknown>
  createdAt: string
  revertedAt: string | null
}

/** Analytics di mercato: SOLO prezzi realmente registrati (spec 31). */
export interface MarketBucket {
  key: string
  soldCount: number
  averageSoldPrice: number | null
  averageFvm: number | null
  /** Rapporto prezzo/FVM; `null` se il FVM medio e 0 o assente. */
  priceToFvm: number | null
  /** Scostamento percentuale vs FVM: +20 significa premio del 20 per cento. */
  premiumVsFvmPct: number | null
}

export interface MarketAnalytics {
  overall: MarketBucket
  byRole: MarketBucket[]
  byTier: MarketBucket[]
  /** Giocatori SOLD senza prezzo registrato: esclusi dai calcoli, mai inventati. */
  soldWithoutPrice: number
}

/** Confronto giocatori (spec 30). */
export interface PlayerComparison {
  players: PlayerRow[]
}

/** Una stagione di statistiche agganciata al listone corrente (spec 12). */
export interface StatsImportSummary {
  season: string
  /** Giocatori del listone che hanno statistiche per quella stagione. */
  players: number
  providers: string[]
  updatedAt: string | null
}

/**
 * Cosa risulta importato per una stagione: il listone e le statistiche, che sono
 * due import distinti e si cancellano separatamente. `players` e `null` quando il
 * listone di quella stagione non e mai stato importato (o e stato cancellato).
 */
export interface ImportState {
  players: {
    season: string
    total: number
    /** Giocatori gia acquistati: finche non e 0 il listone non si puo cancellare. */
    committed: number
    updatedAt: string | null
  } | null
  stats: StatsImportSummary[]
}
