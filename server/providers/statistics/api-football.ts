import type { PlayerCurrentStats } from '#shared/types'

const API_URL = 'https://v3.football.api-sports.io'
const SERIE_A_LEAGUE_ID = 135
const CACHE_TTL_MS = 60 * 60 * 1000

interface ApiPlayerStats {
  team: { id: number; name: string }
  games: {
    appearences: number | null
    minutes: number | null
    rating: string | null
  }
  goals: { total: number | null; assists: number | null }
}

interface ApiPlayer {
  statistics: ApiPlayerStats[]
}

interface ApiStandings {
  league: {
    standings: Array<Array<{ team: { id: number }; all: { played: number | null } }>>
  }
}

interface CachedStats {
  expiresAt: number
  value: PlayerCurrentStats | null
}

const cache = new Map<string, CachedStats>()

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function sameTeam(left: string, right: string) {
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  )
}

function numberOrZero(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumber(value: string | null) {
  const parsed = value === null ? null : Number(value)
  return parsed !== null && Number.isFinite(parsed) ? parsed : null
}

export function selectTeamStats(players: ApiPlayer[], team: string) {
  return players
    .flatMap((player) => player.statistics)
    .find((stats) => sameTeam(stats.team.name, team))
}

async function fetchResponse<T>(path: string, apiKey: string): Promise<T[] | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { 'x-apisports-key': apiKey },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { response?: unknown }
    return Array.isArray(body.response) ? (body.response as T[]) : null
  } catch {
    return null
  }
}

async function loadCurrentSeasonStats(
  input: Pick<PlayerCurrentStatsInput, 'name' | 'team' | 'season'>,
  apiKey: string
): Promise<PlayerCurrentStats | null> {
  const season = Number(input.season.slice(0, 4))
  const players = await fetchResponse<ApiPlayer>(
    `/players?league=${SERIE_A_LEAGUE_ID}&season=${season}&search=${encodeURIComponent(input.name)}`,
    apiKey
  )
  const playerStats = players && selectTeamStats(players, input.team)
  if (!playerStats) return null

  const standings = await fetchResponse<ApiStandings>(
    `/standings?league=${SERIE_A_LEAGUE_ID}&season=${season}&team=${playerStats.team.id}`,
    apiKey
  )
  const teamAppearances = standings?.[0]?.league.standings
    .flat()
    .find((entry) => entry.team.id === playerStats.team.id)?.all.played
  if (teamAppearances === undefined || teamAppearances === null) return null

  return {
    season: input.season,
    appearances: numberOrZero(playerStats.games.appearences),
    starts: null,
    teamAppearances,
    minutes: numberOrZero(playerStats.games.minutes),
    averageRating: nullableNumber(playerStats.games.rating),
    goals: numberOrZero(playerStats.goals.total),
    assists: numberOrZero(playerStats.goals.assists),
    pros: null,
    cons: null,
    provider: 'api-football',
    updatedAt: new Date().toISOString(),
  }
}

export interface PlayerCurrentStatsInput {
  name: string
  team: string
  season: string
}

/** Il dato live e opzionale: un provider assente o guasto non deve bloccare la scheda giocatore. */
export async function getCurrentSeasonStats(
  input: PlayerCurrentStatsInput,
  apiKey: string
): Promise<PlayerCurrentStats | null> {
  if (!apiKey) return null

  const key = `${input.season}:${input.team}:${input.name}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  // ponytail: cache per processo; Redis serve solo se aumentano repliche o traffico.
  const value = await loadCurrentSeasonStats(input, apiKey)
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}
