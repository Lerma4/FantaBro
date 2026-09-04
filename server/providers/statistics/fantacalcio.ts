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

let cachedIndex: CachedIndex | undefined

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
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim()
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
