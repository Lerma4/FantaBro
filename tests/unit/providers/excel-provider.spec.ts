import { Workbook } from 'exceljs'
import { describe, expect, it } from 'vitest'
import { excelPlayerProvider, getPlayerDataProvider } from '../../../server/providers/players'
import { ImportFileError } from '../../../server/providers/players/worksheet'
import { excelStatsProvider } from '../../../server/providers/statistics/excel'

type Row = (string | number | object | null)[]

/** Genera un vero XLSX in memoria: il round-trip prova anche la lettura delle celle. */
function xlsx(sheets: Record<string, Row[]>) {
  const workbook = new Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const worksheet = workbook.addWorksheet(name)
    for (const row of rows) worksheet.addRow(row)
  }
  return workbook.xlsx.writeBuffer()
}

const listone: Row[] = [
  ['Fantacalcio - Quotazioni Ufficiali'],
  [],
  ['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'FVM'],
  ['2170', 'P', 'Por', 'Sommer', 'Inter', 5, 12],
  ['4220', 'D', 'Ds;E', 'Dimarco', 'Inter', 18, 120],
  ['XXX', 'Z', '', 'RuoloRotto', 'Inter', 3, 4],
]

/** Foglio fedele al file ufficiale: colonne Classic e Mantra affiancate, valori diversi. */
const listoneUfficiale: Row[] = [
  ['Quotazioni Fantacalcio Stagione 2026 26'],
  [],
  [
    'Id',
    'R',
    'RM',
    'Nome',
    'Squadra',
    'Qt.A',
    'Qt.I',
    'Diff.',
    'Qt.A M',
    'Qt.I M',
    'Diff.M',
    'FVM',
    'FVM M',
  ],
  ['2170', 'P', 'Por', 'Sommer', 'Inter', 5, 4, 1, 9, 8, 1, 12, 45],
  ['4220', 'D', 'Ds;E', 'Dimarco', 'Inter', 18, 16, 2, 25, 22, 3, 120, 310],
]

describe('excelPlayerProvider', () => {
  it('e registrato come provider di default', () => {
    expect(getPlayerDataProvider()).toBe(excelPlayerProvider)
    expect(excelPlayerProvider.id).toBe('excel')
  })

  it('rifiuta un id di provider sconosciuto', () => {
    expect(() => getPlayerDataProvider('fantacalcio-api')).toThrow(/unknown player data provider/)
  })

  it('fa il round-trip di un vero file XLSX', async () => {
    const result = await excelPlayerProvider.loadPlayers({ buffer: await xlsx({ Tutti: listone }) })

    expect(result.detectedHeaders).toEqual(['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'FVM'])
    expect(result.missingColumns).toEqual([])
    expect(result.importable).toBe(true)
    expect(result.players.map((player) => player.name)).toEqual(['Sommer', 'Dimarco'])
    expect(result.issues).toEqual([{ row: 6, column: 'R', code: 'INVALID_ROLE', value: 'Z' }])
  })

  it('sul file ufficiale completo legge le colonne Classic, non le Mantra', async () => {
    const result = await excelPlayerProvider.loadPlayers({
      buffer: await xlsx({ Tutti: listoneUfficiale }),
    })

    expect(result.mapping).toEqual({
      externalId: 'Id',
      role: 'R',
      mantraRole: 'RM',
      name: 'Nome',
      team: 'Squadra',
      quotation: 'Qt.A',
      fvm: 'FVM',
    })
    expect(result.issues).toEqual([])
    expect(result.players.map((player) => [player.name, player.quotation, player.fvm])).toEqual([
      ['Sommer', 5, 12],
      ['Dimarco', 18, 120],
    ])
  })

  it('legge il foglio richiesto per nome', async () => {
    const buffer = await xlsx({
      Note: [['foglio di servizio']],
      Tutti: listone,
    })

    const first = await excelPlayerProvider.loadPlayers({ buffer })
    expect(first.importable).toBe(false)

    const named = await excelPlayerProvider.loadPlayers({ buffer, sheet: 'Tutti' })
    expect(named.players).toHaveLength(2)
  })

  it('applica la mappatura manuale sul file letto', async () => {
    const buffer = await xlsx({
      Dati: [
        ['Giocatore', 'Club', 'Posizione', 'Valore', 'Mercato'],
        ['Sommer', 'Inter', 'P', 5, 12],
      ],
    })

    const result = await excelPlayerProvider.loadPlayers({
      buffer,
      mapping: {
        name: 'Giocatore',
        team: 'Club',
        role: 'Posizione',
        quotation: 'Valore',
        fvm: 'Mercato',
      },
    })

    expect(result.players).toHaveLength(1)
  })

  it('risolve formule, rich text e hyperlink', async () => {
    const buffer = await xlsx({
      Dati: [
        ['Nome', 'Squadra', 'R', 'Qt.A', 'FVM'],
        [
          { richText: [{ text: 'Lauta' }, { text: 'ro' }] },
          { text: 'Inter', hyperlink: 'https://example.test' },
          'A',
          { formula: 'B1', result: 28 },
          120,
        ],
      ],
    })

    const result = await excelPlayerProvider.loadPlayers({ buffer })

    expect(result.players).toEqual([
      {
        externalId: null,
        name: 'Lautaro',
        team: 'Inter',
        role: 'A',
        mantraRole: null,
        quotation: 28,
        fvm: 120,
      },
    ])
  })

  it('rifiuta un buffer che non e un workbook', async () => {
    await expect(
      excelPlayerProvider.loadPlayers({ buffer: Buffer.from('questo non e un xlsx') })
    ).rejects.toMatchObject({ code: 'IMPORT_INVALID_FILE' })
  })

  it('rifiuta un input senza buffer', async () => {
    await expect(excelPlayerProvider.loadPlayers({})).rejects.toBeInstanceOf(ImportFileError)
    await expect(excelPlayerProvider.loadPlayers(null)).rejects.toMatchObject({
      code: 'IMPORT_INVALID_FILE',
    })
  })

  it('rifiuta un foglio inesistente', async () => {
    await expect(
      excelPlayerProvider.loadPlayers({ buffer: await xlsx({ Tutti: listone }), sheet: 'Assente' })
    ).rejects.toMatchObject({ code: 'IMPORT_INVALID_FILE' })
  })
})

describe('excelStatsProvider', () => {
  it('legge le statistiche stagionali da un vero file XLSX', async () => {
    const buffer = await xlsx({
      Stats: [
        ['Statistiche'],
        ['Nome', 'Squadra', 'Pv', 'Mv', 'Fm', 'Gf', 'Ass'],
        ['Sommer', 'Inter', 34, 6.1, 6.3, 0, 0],
        ['Dimarco', 'Inter', 30, 6.3, 7.2, 5, 8],
      ],
    })

    const result = await excelStatsProvider.loadSeasonStats({ buffer, season: '2025/26' })

    expect(result.missingColumns).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.stats.map((entry) => entry.playerName)).toEqual(['Sommer', 'Dimarco'])
    expect(result.stats[1]).toMatchObject({
      appearances: 30,
      averageRating: 6.3,
      fantasyAverage: 7.2,
      goals: 5,
      assists: 8,
      minutes: null,
    })
  })

  it('rifiuta un buffer non valido', async () => {
    await expect(
      excelStatsProvider.loadSeasonStats({ buffer: Buffer.from('nope'), season: '2025/26' })
    ).rejects.toMatchObject({ code: 'IMPORT_INVALID_FILE' })
  })

  it("valida l'input non conforme del contratto condiviso", async () => {
    for (const input of [null, undefined, {}, 'file.xlsx', { buffer: 'file.xlsx' }]) {
      await expect(excelStatsProvider.loadSeasonStats(input)).rejects.toBeInstanceOf(
        ImportFileError
      )
    }
  })
})
