import type { AuctionPlayerStatus, ClassicRole, PlayerRow } from '#shared/types'

export type PlayerSort =
  'name' | 'quotation' | 'fvm' | 'averageRating' | 'fantasyAverage' | 'appearances' | 'priority'

export interface ListoneFilters {
  q: string
  status: AuctionPlayerStatus | 'ALL'
  role: ClassicRole[]
  team: string[]
  tier: string[]
  onlyTargets: boolean
  quotationMin?: number
  quotationMax?: number
  fvmMin?: number
  fvmMax?: number
  averageRatingMin?: number
  fantasyAverageMin?: number
  appearancesMin?: number
  sort: PlayerSort
  dir: 'asc' | 'desc'
}

interface PlayersResponse {
  rows: PlayerRow[]
  total: number
  statsSeason: string | null
  teams: string[]
}

function emptyListoneFilters(): ListoneFilters {
  return {
    q: '',
    status: 'AVAILABLE',
    role: [],
    team: [],
    tier: [],
    onlyTargets: false,
    sort: 'fvm',
    dir: 'desc',
  }
}

/**
 * Filtri e righe del listone. Filtra il server (l'unico che vede tutto il
 * listone), con debounce corto e scarto delle risposte scadute: durante l'asta
 * si digita veloce e l'ordine di arrivo delle risposte non e garantito.
 */
export function usePlayerList(auctionId: string) {
  const store = useAuctionStore()
  const toastError = useToastError()

  const filters = ref<ListoneFilters>(emptyListoneFilters())
  const rows = shallowRef<PlayerRow[]>([])
  const total = ref(0)
  const teams = ref<string[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  const query = computed(() => {
    const f = filters.value
    const q: Record<string, string | number | boolean | string[]> = {
      status: f.status,
      sort: f.sort,
      dir: f.dir,
      limit: 2000,
    }
    const text = f.q.trim()
    if (text) q.q = text
    if (f.role.length) q.role = f.role
    if (f.team.length) q.team = f.team
    if (f.tier.length) q.tier = f.tier
    if (f.onlyTargets) q.onlyTargets = true
    for (const key of [
      'quotationMin',
      'quotationMax',
      'fvmMin',
      'fvmMax',
      'averageRatingMin',
      'fantasyAverageMin',
      'appearancesMin',
    ] as const) {
      const value = f[key]
      if (typeof value === 'number' && Number.isFinite(value)) q[key] = value
    }
    return q
  })

  const activeFilterCount = computed(() => {
    const f = filters.value
    let count = 0
    if (f.role.length) count++
    if (f.team.length) count++
    if (f.tier.length) count++
    if (f.onlyTargets) count++
    for (const key of [
      'quotationMin',
      'quotationMax',
      'fvmMin',
      'fvmMax',
      'averageRatingMin',
      'fantasyAverageMin',
      'appearancesMin',
    ] as const) {
      if (typeof f[key] === 'number') count++
    }
    return count
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0

  async function fetchRows() {
    const mine = ++sequence
    loading.value = true
    try {
      const res = await apiFetch<PlayersResponse>(`/api/auctions/${auctionId}/players`, {
        query: query.value,
      })
      if (mine !== sequence) return
      rows.value = res.rows
      total.value = res.total
      teams.value = res.teams
      store.setStatsSeason(res.statsSeason)
      loaded.value = true
    } catch (err) {
      if (mine === sequence) toastError(err)
    } finally {
      if (mine === sequence) loading.value = false
    }
  }

  function schedule(delay = 200) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void fetchRows()
    }, delay)
  }

  /**
   * Applica al posto giusto la riga tornata da una scrittura: se non rientra
   * piu nel filtro corrente sparisce dalla lista, senza rifare la fetch.
   */
  function applyRow(row: PlayerRow) {
    const f = filters.value
    const stillMatches =
      (f.status === 'ALL' || f.status === row.status) && (!f.onlyTargets || row.isTarget)

    if (!stillMatches) {
      const before = rows.value.length
      rows.value = rows.value.filter((r) => r.playerId !== row.playerId)
      if (rows.value.length < before) total.value = Math.max(0, total.value - 1)
      return
    }
    rows.value = rows.value.map((r) => (r.playerId === row.playerId ? row : r))
  }

  /** Qualcuno ha toccato l'asta da un'altra sessione: si ricarica, con calma. */
  function invalidate() {
    schedule(300)
  }

  function resetFilters() {
    filters.value = emptyListoneFilters()
  }

  watch(query, () => schedule())
  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return {
    filters,
    rows,
    total,
    teams,
    loading,
    loaded,
    activeFilterCount,
    fetchRows,
    applyRow,
    invalidate,
    resetFilters,
  }
}
