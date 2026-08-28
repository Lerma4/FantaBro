import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedPlayer, PlayerImportResult } from '#shared/types'
import { makeAuction } from './fixtures'

const m = vi.hoisted(() => ({
  tx: { transaction: true },
  loadPlayers: vi.fn(),
  parseStatsWorkbook: vi.fn(),
  upsertPlayers: vi.fn(),
  ensureAuctionPlayers: vi.fn(),
  appendEvent: vi.fn(),
  resolvePlayerIdsByName: vi.fn(),
  upsertSeasonStats: vi.fn(),
  publishAuctionChange: vi.fn(),
  summarizeListone: vi.fn(),
  countCommittedForSeason: vi.fn(),
  deletePlayersForSeason: vi.fn(),
  summarizeStats: vi.fn(),
  deleteStatsForSeason: vi.fn(),
  listAuctionIdsForSeason: vi.fn(),
}))

vi.mock('../../../server/utils/db', () => ({
  db: {},
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(m.tx),
}))
vi.mock('../../../server/utils/events', () => ({ publishAuctionChange: m.publishAuctionChange }))
vi.mock('../../../server/providers/players', () => ({
  getPlayerDataProvider: () => ({ id: 'excel', loadPlayers: m.loadPlayers }),
}))
vi.mock('../../../server/providers/statistics/excel', () => ({
  parseStatsWorkbook: m.parseStatsWorkbook,
}))
vi.mock('../../../server/repositories/players', () => ({
  upsertPlayers: m.upsertPlayers,
  summarizeListone: m.summarizeListone,
  countCommittedForSeason: m.countCommittedForSeason,
  deletePlayersForSeason: m.deletePlayersForSeason,
}))
vi.mock('../../../server/repositories/auctions', () => ({
  listAuctionIdsForSeason: m.listAuctionIdsForSeason,
}))
vi.mock('../../../server/repositories/auctionPlayers', () => ({
  ensureAuctionPlayers: m.ensureAuctionPlayers,
}))
vi.mock('../../../server/repositories/events', () => ({ appendEvent: m.appendEvent }))
vi.mock('../../../server/repositories/stats', () => ({
  resolvePlayerIdsByName: m.resolvePlayerIdsByName,
  upsertSeasonStats: m.upsertSeasonStats,
  summarizeStats: m.summarizeStats,
  deleteStatsForSeason: m.deleteStatsForSeason,
}))

const {
  confirmImport,
  getImportState,
  importPreviewToken,
  importStats,
  previewImport,
  wipeListone,
  wipeStats,
} = await import('../../../server/services/import')

const auction = makeAuction()
const buffer = Buffer.from('listone-xlsx')

const parsedPlayer: ParsedPlayer = {
  externalId: null,
  name: 'Dimarco',
  team: 'Inter',
  role: 'D',
  mantraRole: null,
  quotation: 20,
  fvm: 60,
}

function importResult(overrides: Partial<PlayerImportResult> = {}): PlayerImportResult {
  return {
    players: [parsedPlayer],
    issues: [],
    mapping: { name: 'Nome', team: 'Squadra', role: 'R', quotation: 'Qt.A', fvm: 'FVM' },
    missingColumns: [],
    detectedHeaders: ['Nome', 'Squadra', 'R', 'Qt.A', 'FVM'],
    totalRows: 1,
    importable: true,
    ...overrides,
  }
}

function statsEntry(playerName: string) {
  return {
    playerName,
    team: 'Inter',
    appearances: 34,
    starts: 30,
    minutes: 2700,
    averageRating: 6.3,
    fantasyAverage: 7.1,
    goals: 4,
    assists: 8,
    yellowCards: 5,
    redCards: 0,
    penaltiesScored: 0,
    penaltiesMissed: 0,
    goalsConceded: null,
    penaltiesSaved: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.loadPlayers.mockResolvedValue(importResult())
  m.upsertPlayers.mockResolvedValue({ inserted: 1, updated: 0, playerIds: ['player-1'] })
  m.appendEvent.mockResolvedValue({ id: 'event-import' })
  m.listAuctionIdsForSeason.mockResolvedValue([])
})

describe('previewImport / confirmImport', () => {
  it('conferma un import il cui token combacia con la preview', async () => {
    const preview = await previewImport({ buffer })
    const result = await confirmImport({
      auction,
      buffer,
      season: auction.season,
      previewToken: preview.previewToken,
      userId: 'user-1',
    })

    expect(m.upsertPlayers).toHaveBeenCalledWith(m.tx, auction.season, [parsedPlayer])
    expect(m.ensureAuctionPlayers).toHaveBeenCalledWith(m.tx, auction.id, ['player-1'])
    expect(m.appendEvent).toHaveBeenCalledWith(
      m.tx,
      expect.objectContaining({ type: 'IMPORT_COMPLETED', playerId: null })
    )
    // Un import cambia migliaia di righe: la notifica dice "ricarica tutto".
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, auction.id, {
      playerIds: [],
      eventId: 'event-import',
    })
    expect(result).toEqual({ imported: 1, updated: 0, issues: [] })
  })

  it('conferma quando il client rimanda la mappatura rilevata dalla preview', async () => {
    // La UI riempie i selettori con `preview.mapping` e la rimanda in conferma: e lo stesso
    // import, non un import diverso, e il token deve restare valido.
    const preview = await previewImport({ buffer })

    await confirmImport({
      auction,
      buffer,
      season: auction.season,
      mapping: preview.mapping,
      previewToken: preview.previewToken,
      userId: 'user-1',
    })

    expect(m.upsertPlayers).toHaveBeenCalledWith(m.tx, auction.season, [parsedPlayer])
  })

  it('rifiuta la conferma di un file diverso da quello visto in preview', async () => {
    const tokenOfAnotherFile = importPreviewToken(Buffer.from('un-altro-file'))

    await expect(
      confirmImport({
        auction,
        buffer,
        season: auction.season,
        previewToken: tokenOfAnotherFile,
        userId: 'user-1',
      })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'CONFLICT' })

    expect(m.upsertPlayers).not.toHaveBeenCalled()
    expect(m.publishAuctionChange).not.toHaveBeenCalled()
  })

  it('rifiuta la conferma di un foglio diverso da quello visto in preview', async () => {
    // Il listone ufficiale e multi-foglio: stesso file e stessa mappatura non bastano.
    const preview = await previewImport({ buffer, sheet: 'Tutti' })

    await expect(
      confirmImport({
        auction,
        buffer,
        season: auction.season,
        sheet: 'Portieri',
        previewToken: preview.previewToken,
        userId: 'user-1',
      })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'CONFLICT' })

    expect(m.upsertPlayers).not.toHaveBeenCalled()
  })

  it('tratta sheet assente e sheet vuoto come lo stesso foglio', () => {
    expect(importPreviewToken(buffer, undefined, '')).toBe(importPreviewToken(buffer))
  })

  it('il token cambia con la mappatura ma non con l ordine delle sue chiavi', () => {
    expect(importPreviewToken(buffer, { name: 'Nome', team: 'Squadra' })).toBe(
      importPreviewToken(buffer, { team: 'Squadra', name: 'Nome' })
    )
    expect(importPreviewToken(buffer, { name: 'Nome' })).not.toBe(importPreviewToken(buffer))
  })

  it('rifiuta un file con colonne obbligatorie mancanti', async () => {
    const parsed = importResult({ importable: false, missingColumns: ['fvm'], players: [] })
    m.loadPlayers.mockResolvedValue(parsed)

    await expect(
      confirmImport({
        auction,
        buffer,
        season: auction.season,
        previewToken: importPreviewToken(buffer, parsed.mapping),
        userId: 'user-1',
      })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'IMPORT_MISSING_COLUMNS' })

    expect(m.upsertPlayers).not.toHaveBeenCalled()
  })

  it('rifiuta un file senza nessuna riga valida', async () => {
    const parsed = importResult({
      importable: false,
      players: [],
      issues: [{ row: 2, code: 'INVALID_ROLE', value: 'X' }],
    })
    m.loadPlayers.mockResolvedValue(parsed)

    await expect(
      confirmImport({
        auction,
        buffer,
        season: auction.season,
        previewToken: importPreviewToken(buffer, parsed.mapping),
        userId: 'user-1',
      })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'IMPORT_NO_VALID_ROWS' })
  })
})

describe('importStats', () => {
  it('non crea giocatori e riporta i nomi non risolti', async () => {
    m.parseStatsWorkbook.mockResolvedValue({
      season: '2025/26',
      stats: [statsEntry('Dimarco'), statsEntry('Sconosciuto')],
      issues: [],
      detectedHeaders: ['Nome'],
      missingColumns: [],
    })
    m.resolvePlayerIdsByName.mockResolvedValue(new Map([['dimarco', 'player-1']]))
    m.upsertSeasonStats.mockResolvedValue(1)

    const result = await importStats({
      auction,
      season: '2025/26',
      provider: 'excel',
      buffer: Buffer.from('stats-xlsx'),
      userId: 'user-1',
    })

    expect(m.upsertPlayers).not.toHaveBeenCalled()

    // I nomi si agganciano al listone dell'asta: la stagione dei dati non c'entra (spec 12).
    expect(m.resolvePlayerIdsByName).toHaveBeenCalledWith(expect.anything(), auction.season, [
      'Dimarco',
      'Sconosciuto',
    ])
    expect(result.unmatched).toEqual(['Sconosciuto'])
    expect(result.imported).toBe(1)

    // Ogni riga scritta porta la stagione dichiarata dall'utente, mai un'altra (spec 12).
    const [, rows] = m.upsertSeasonStats.mock.calls[0] as [unknown, { season: string }[]]
    expect(rows).toHaveLength(1)
    expect(rows.every((row) => row.season === '2025/26')).toBe(true)
  })

  it('rifiuta un foglio statistiche senza righe utilizzabili', async () => {
    m.parseStatsWorkbook.mockResolvedValue({
      season: '2025/26',
      stats: [],
      issues: [],
      detectedHeaders: [],
      missingColumns: ['name'],
    })

    await expect(
      importStats({
        auction,
        season: '2025/26',
        provider: 'excel',
        buffer: Buffer.from('vuoto'),
        userId: 'user-1',
      })
    ).rejects.toMatchObject({ name: 'DomainError', code: 'IMPORT_MISSING_COLUMNS' })

    expect(m.upsertSeasonStats).not.toHaveBeenCalled()
  })
})

describe('getImportState', () => {
  it('mette insieme listone e statistiche della stagione', async () => {
    const importedAt = '2026-08-20T09:00:00.000Z'
    m.summarizeListone.mockResolvedValue({ total: 513, updatedAt: importedAt })
    m.countCommittedForSeason.mockResolvedValue(2)
    m.summarizeStats.mockResolvedValue([
      { season: '2025/26', players: 380, providers: ['excel'], updatedAt: importedAt },
    ])

    const state = await getImportState('2026/27')

    expect(state).toEqual({
      players: { season: '2026/27', total: 513, committed: 2, updatedAt: importedAt },
      stats: [{ season: '2025/26', players: 380, providers: ['excel'], updatedAt: importedAt }],
    })
  })

  it('senza listone importato torna players a null', async () => {
    m.summarizeListone.mockResolvedValue({ total: 0, updatedAt: null })
    m.countCommittedForSeason.mockResolvedValue(0)
    m.summarizeStats.mockResolvedValue([])

    expect(await getImportState('2026/27')).toEqual({ players: null, stats: [] })
  })
})

describe('wipeListone', () => {
  it('rifiuta se un giocatore della stagione e gia impegnato', async () => {
    m.countCommittedForSeason.mockResolvedValue(3)

    await expect(wipeListone('2026/27')).rejects.toMatchObject({
      name: 'DomainError',
      code: 'LISTONE_IN_USE',
    })
    expect(m.deletePlayersForSeason).not.toHaveBeenCalled()
  })

  it('cancella il listone e fa ricaricare ogni asta della stagione', async () => {
    m.countCommittedForSeason.mockResolvedValue(0)
    m.deletePlayersForSeason.mockResolvedValue(513)
    m.listAuctionIdsForSeason.mockResolvedValue(['asta-1', 'asta-2'])

    expect(await wipeListone('2026/27')).toEqual({ deleted: 513 })

    expect(m.deletePlayersForSeason).toHaveBeenCalledWith(m.tx, '2026/27')
    expect(m.publishAuctionChange).toHaveBeenCalledTimes(2)
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, 'asta-1', { playerIds: [] })
  })
})

describe('wipeStats', () => {
  it('cancella solo la stagione di dati indicata e ricarica le aste', async () => {
    m.deleteStatsForSeason.mockResolvedValue(380)
    m.listAuctionIdsForSeason.mockResolvedValue(['asta-1'])

    expect(await wipeStats('2026/27', '2025/26')).toEqual({ deleted: 380 })

    expect(m.deleteStatsForSeason).toHaveBeenCalledWith(m.tx, '2026/27', '2025/26')
    expect(m.publishAuctionChange).toHaveBeenCalledWith(m.tx, 'asta-1', { playerIds: [] })
  })
})
