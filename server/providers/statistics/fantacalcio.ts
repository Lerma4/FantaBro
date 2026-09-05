import type { PlayerCurrentStats } from '#shared/types'

const INDEX_URL = 'https://www.fantacalcio.it/statistiche-serie-a'
const CACHE_TTL_MS = 60 * 60 * 1000

export interface FantacalcioPlayerLink {
  name: string
  team: string
  url: string
  id: number
}

interface CachedIndex {
  expiresAt: number
  links: FantacalcioPlayerLink[]
}

interface CachedStats {
  expiresAt: number
  value: PlayerCurrentStats | null
}

let cachedIndex: CachedIndex | undefined
const statsCache = new Map<string, CachedStats>()

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function sameTeam(left: string, right: string) {
  const a = normalize(left)
  const b = normalize(right)
  return a === b || a.includes(b) || b.includes(a)
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);?/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&agrave;/g, 'à')
    .replace(/&egrave;/g, 'è')
    .replace(/&igrave;/g, 'ì')
    .replace(/&ograve;/g, 'ò')
    .replace(/&ugrave;/g, 'ù')
    .trim()
}

function plainText(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function readFantacalcioAdvice(html: string) {
  const advice = { pros: null as string | null, cons: null as string | null }
  const pattern =
    /<li\b[^>]*>[\s\S]*?<strong\b[^>]*>\s*(PRO|CONTRO)\s*<\/strong>\s*:?([\s\S]*?)<\/li>/gi

  for (const match of html.matchAll(pattern)) {
    const text = plainText(match[2] ?? '')
    if (!text) continue
    if (match[1]?.toUpperCase() === 'PRO') advice.pros = text
    if (match[1]?.toUpperCase() === 'CONTRO') advice.cons = text
  }

  return advice
}

function readStat(html: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(
    new RegExp(
      `<th[^>]*itemprop=["']name description["'][^>]*>\\s*${escapedLabel}\\s*<\\/th>[\\s\\S]*?<td[^>]*class=["'][^"']*value[^"']*["'][^>]*>([0-9]+(?:[,.][0-9]+)?)`,
      'i'
    )
  )
  if (!match?.[1]) return null
  const value = Number(match[1].replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function readAverageRating(html: string) {
  const match = html.match(
    /<meta[^>]*itemprop=["']name description["'][^>]*content=["']Media voto["'][\s\S]*?<meta[^>]*itemprop=["']value["'][^>]*content=["']([^"']+)/i
  )
  if (!match?.[1]) return null
  const value = Number(match[1].replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

export function readFantacalcioMatchStats(html: string) {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].flatMap((match) =>
    match[1] ? [match[1]] : []
  )
  const matches = rows.filter((row) => /class=["'][^"']*match\b/i.test(row))
  let appearances = 0
  let starts = 0
  let minutes = 0

  for (const row of matches) {
    const grade = row.match(/class=["']grade["'][^>]*data-value=["']([^"']*)/i)?.[1]
    if (!grade) continue
    appearances += 1
    const entered = row.match(/class=["']sub-in["'][^>]*data-minute=["']([^"']*)/i)?.[1]
    if (!entered) starts += 1
    const enteredMinute = Number(entered) || 0
    const exited =
      Number(row.match(/class=["']sub-out["'][^>]*data-minute=["']([^"']*)/i)?.[1]) || 90
    minutes += Math.max(0, exited - enteredMinute)
  }

  return { teamAppearances: matches.length, appearances, starts, minutes }
}

export function extractFantacalcioPlayerLinks(html: string): FantacalcioPlayerLink[] {
  const links: FantacalcioPlayerLink[] = []
  const pattern =
    /<a\b[^>]*href=["'](https:\/\/www\.fantacalcio\.it\/serie-a\/squadre\/([^/"']+)\/([^/"']+)\/(\d+))["'][^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/a>/gi

  for (const match of html.matchAll(pattern)) {
    const [, url, team, , id, name] = match
    if (!url || !team || !id || !name) continue
    links.push({ name: decodeHtml(name), team, url, id: Number(id) })
  }

  return links
}

export function findFantacalcioPlayerLink(
  links: FantacalcioPlayerLink[],
  name: string,
  team: string
) {
  const normalizedName = normalize(name)
  const teamPlayers = links.filter((link) => sameTeam(link.team, team))
  const exact = teamPlayers.find((link) => normalize(link.name) === normalizedName)
  if (exact) return exact

  const partial = teamPlayers.filter((link) => {
    const candidate = normalize(link.name)
    return (
      normalizedName.length >= 4 &&
      candidate.length >= 4 &&
      (candidate.includes(normalizedName) || normalizedName.includes(candidate))
    )
  })
  return partial.length === 1 ? partial[0] : undefined
}

async function loadIndex() {
  if (cachedIndex && cachedIndex.expiresAt > Date.now()) return cachedIndex.links

  try {
    const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return []
    const links = extractFantacalcioPlayerLinks(await response.text())
    cachedIndex = { links, expiresAt: Date.now() + CACHE_TTL_MS }
    return links
  } catch {
    return []
  }
}

/** Recupera l'ID interno dal link pubblicato da Fantacalcio, senza calcolarlo. */
export async function resolveFantacalcioPlayerUrl(name: string, team: string) {
  const links = await loadIndex()
  const player = findFantacalcioPlayerLink(links, name, team)
  return player?.url ?? null
}

function cacheKey(input: { season: string; team: string; name: string }) {
  return `${input.season}:${normalize(input.team)}:${normalize(input.name)}`
}

export function getCachedFantacalcioStats(input: { season: string; team: string; name: string }) {
  const cached = statsCache.get(cacheKey(input))
  return cached && cached.expiresAt > Date.now() ? cached.value : null
}

export async function syncFantacalcioStats(input: {
  season: string
  team: string
  name: string
}): Promise<PlayerCurrentStats | null> {
  const link = findFantacalcioPlayerLink(await loadIndex(), input.name, input.team)
  if (!link) {
    statsCache.set(cacheKey(input), { value: null, expiresAt: Date.now() + CACHE_TTL_MS })
    return null
  }

  try {
    const response = await fetch(link.url, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return null
    const html = await response.text()
    const matchStats = readFantacalcioMatchStats(html)
    const advice = readFantacalcioAdvice(html)
    const appearances = readStat(html, 'Partite a voto')
    const goals = readStat(html, 'Gol')
    const assists = readStat(html, 'Assist')
    if (
      appearances === null ||
      goals === null ||
      assists === null ||
      matchStats.teamAppearances === 0
    ) {
      return null
    }

    const value: PlayerCurrentStats = {
      season: input.season,
      appearances,
      starts: matchStats.starts,
      teamAppearances: matchStats.teamAppearances,
      minutes: matchStats.minutes,
      averageRating: readAverageRating(html),
      goals,
      assists,
      pros: advice.pros,
      cons: advice.cons,
      provider: 'fantacalcio',
      updatedAt: new Date().toISOString(),
    }
    statsCache.set(cacheKey(input), { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
  } catch {
    return null
  }
}
