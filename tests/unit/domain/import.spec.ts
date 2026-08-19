import { describe, expect, it } from 'vitest'
import {
  detectColumnMapping,
  parsePlayerRows,
  parseStatsRows,
  type Cell,
  type CellMatrix,
} from '../../../server/domain/import'

/**
 * Intestazione reale del file "Quotazioni Fantacalcio": le colonne Classic e Mantra
 * convivono, quindi un match sbagliato importa valori plausibili ma Mantra.
 */
const OFFICIAL_HEADERS = [
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
]

/** Foglio ufficiale completo: riga di titolo, riga vuota, intestazione, dati. */
const officialSheet: CellMatrix = [
  ['Quotazioni Fantacalcio Stagione 2026 26'],
  [],
  OFFICIAL_HEADERS,
]

/** Struttura ridotta usata dai casi di validazione riga per riga. */
const officialHeader: CellMatrix = [
  ['Fantacalcio - Quotazioni Ufficiali', null, null, null, null, null, null],
  [],
  ['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'FVM'],
]

const row = (
  id: string,
  role: string,
  mantra: string,
  name: string,
  team: string,
  quotation: Cell,
  fvm: Cell
): Cell[] => [id, role, mantra, name, team, quotation, fvm]

describe('detectColumnMapping', () => {
  it('sul listone ufficiale completo prende le colonne Classic, non quelle Mantra', () => {
    expect(detectColumnMapping(OFFICIAL_HEADERS)).toEqual({
      externalId: 'Id',
      role: 'R',
      mantraRole: 'RM',
      name: 'Nome',
      team: 'Squadra',
      quotation: 'Qt.A',
      fvm: 'FVM',
    })
  })

  it('non mappa nessuna colonna di valore Mantra ne la quotazione iniziale', () => {
    expect(detectColumnMapping(['Qt.A M', 'Qt.I M', 'Diff.M', 'FVM M', 'Qt.I', 'Diff.'])).toEqual(
      {}
    )
  })

  it("non dipende dall'ordine delle colonne", () => {
    expect(detectColumnMapping(['FVM M', 'FVM'])).toEqual({ fvm: 'FVM' })
    expect(detectColumnMapping(['Qt.A M', 'Qt.A'])).toEqual({ quotation: 'Qt.A' })
    expect(detectColumnMapping(['RM', 'R'])).toEqual({ mantraRole: 'RM', role: 'R' })
  })

  it('riconosce le intestazioni di un listone ufficiale', () => {
    expect(detectColumnMapping(['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'FVM'])).toEqual({
      externalId: 'Id',
      role: 'R',
      mantraRole: 'RM',
      name: 'Nome',
      team: 'Squadra',
      quotation: 'Qt.A',
      fvm: 'FVM',
    })
  })

  it('riconosce le intestazioni inglesi', () => {
    expect(detectColumnMapping(['player id', 'name', 'team', 'role', 'quotation', 'fvm'])).toEqual({
      externalId: 'player id',
      name: 'name',
      team: 'team',
      role: 'role',
      quotation: 'quotation',
      fvm: 'fvm',
    })
  })

  it('tollera maiuscole, accenti, spazi e punteggiatura', () => {
    expect(detectColumnMapping(['  CALCIATORE ', 'SQUADRÀ', 'Qt. A', 'Ruolo Mantra'])).toEqual({
      name: 'CALCIATORE',
      team: 'SQUADRÀ',
      quotation: 'Qt. A',
      mantraRole: 'Ruolo Mantra',
    })
  })

  it('ignora le colonne sconosciute e le intestazioni vuote', () => {
    expect(detectColumnMapping(['Nome', '', 'Diff.', 'Qt.I'])).toEqual({ name: 'Nome' })
  })
})

describe('parsePlayerRows', () => {
  it('sul foglio ufficiale completo importa i valori Classic, non i Mantra', () => {
    const result = parsePlayerRows([
      ...officialSheet,
      ['2170', 'P', 'Por', 'Sommer', 'Inter', 5, 4, 1, 9, 8, 1, 12, 45],
      ['4220', 'D', 'Ds;E', 'Dimarco', 'Inter', 18, 16, 2, 25, 22, 3, 120, 310],
    ])

    expect(result.mapping).toEqual({
      externalId: 'Id',
      role: 'R',
      mantraRole: 'RM',
      name: 'Nome',
      team: 'Squadra',
      quotation: 'Qt.A',
      fvm: 'FVM',
    })
    expect(result.missingColumns).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.importable).toBe(true)
    expect(result.players).toEqual([
      {
        externalId: '2170',
        name: 'Sommer',
        team: 'Inter',
        role: 'P',
        mantraRole: 'Por',
        quotation: 5,
        fvm: 12,
      },
      {
        externalId: '4220',
        name: 'Dimarco',
        team: 'Inter',
        role: 'D',
        mantraRole: 'Ds;E',
        quotation: 18,
        fvm: 120,
      },
    ])
  })

  it('importa un listone valido con intestazione oltre la prima riga', () => {
    const result = parsePlayerRows([
      ...officialHeader,
      row('2170', 'P', 'Por', 'Sommer', 'Inter', 5, 12),
      row('4220', 'D', 'Ds;E', 'Dimarco', 'Inter', 18, 120),
    ])

    expect(result.missingColumns).toEqual([])
    expect(result.importable).toBe(true)
    expect(result.totalRows).toBe(2)
    expect(result.issues).toEqual([])
    expect(result.detectedHeaders).toEqual(['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'FVM'])
    expect(result.players).toEqual([
      {
        externalId: '2170',
        name: 'Sommer',
        team: 'Inter',
        role: 'P',
        mantraRole: 'Por',
        quotation: 5,
        fvm: 12,
      },
      {
        externalId: '4220',
        name: 'Dimarco',
        team: 'Inter',
        role: 'D',
        mantraRole: 'Ds;E',
        quotation: 18,
        fvm: 120,
      },
    ])
  })

  it('segnala le colonne obbligatorie mancanti senza validare le righe', () => {
    const result = parsePlayerRows([
      ['Nome', 'Squadra', 'Qt.A'],
      ['Sommer', 'Inter', 5],
    ])

    expect(result.missingColumns).toEqual(['role', 'fvm'])
    expect(result.importable).toBe(false)
    expect(result.players).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.totalRows).toBe(1)
  })

  it('scarta le righe con nome o squadra mancanti', () => {
    const result = parsePlayerRows([
      ...officialHeader,
      row('1', 'P', '', '', 'Inter', 5, 12),
      row('2', 'P', '', 'Sommer', '  ', 5, 12),
    ])

    expect(result.players).toEqual([])
    expect(result.issues).toEqual([
      { row: 4, column: 'Nome', code: 'MISSING_VALUE' },
      { row: 5, column: 'Squadra', code: 'MISSING_VALUE' },
    ])
  })

  it('scarta un ruolo che non e uno dei quattro classici', () => {
    const result = parsePlayerRows([
      ...officialHeader,
      row('1', 'A;C', '', 'Ibrido', 'Inter', 5, 12),
      row('2', 'Por', '', 'Mantra', 'Inter', 5, 12),
      row('3', ' a ', '', 'Minuscolo', 'Milan', 5, 12),
    ])

    expect(result.issues).toEqual([
      { row: 4, column: 'R', code: 'INVALID_ROLE', value: 'A;C' },
      { row: 5, column: 'R', code: 'INVALID_ROLE', value: 'Por' },
    ])
    expect(result.players.map((player) => player.name)).toEqual(['Minuscolo'])
    expect(result.players[0]?.role).toBe('A')
  })

  it('scarta quotazioni e FVM non numerici o negativi', () => {
    const result = parsePlayerRows([
      ...officialHeader,
      row('1', 'P', '', 'NoNumero', 'Inter', 'n.d.', 12),
      row('2', 'P', '', 'Negativo', 'Milan', 5, -3),
      row('3', 'P', '', 'Vuoto', 'Roma', '', 12),
      row('4', 'P', '', 'Virgola', 'Lazio', '5,5', '12,5'),
    ])

    expect(result.issues).toEqual([
      { row: 4, column: 'Qt.A', code: 'INVALID_NUMBER', value: 'n.d.' },
      { row: 5, column: 'FVM', code: 'INVALID_NUMBER', value: '-3' },
      { row: 6, column: 'Qt.A', code: 'MISSING_VALUE' },
    ])
    expect(result.players).toHaveLength(1)
    expect(result.players[0]).toMatchObject({ name: 'Virgola', quotation: 5.5, fvm: 12.5 })
  })

  it('accumula piu problemi sulla stessa riga', () => {
    const result = parsePlayerRows([...officialHeader, row('1', 'X', '', '', 'Inter', 'no', 12)])

    expect(result.issues.map((issue) => issue.code)).toEqual([
      'MISSING_VALUE',
      'INVALID_ROLE',
      'INVALID_NUMBER',
    ])
    expect(result.players).toEqual([])
  })

  it('scarta la seconda occorrenza di un duplicato su nome e squadra', () => {
    const result = parsePlayerRows([
      ...officialHeader,
      row('1', 'P', '', 'Sommer', 'Inter', 5, 12),
      row('2', 'P', '', ' sommér ', 'INTER', 6, 14),
      row('3', 'P', '', 'Sommer', 'Milan', 5, 12),
    ])

    expect(result.players.map((player) => player.team)).toEqual(['Inter', 'Milan'])
    expect(result.issues).toEqual([{ row: 5, column: 'Nome', code: 'DUPLICATE', value: 'sommér' }])
  })

  it('riconosce come duplicato lo stesso nome con apostrofo tipografico e semplice', () => {
    const result = parsePlayerRows([
      ...officialHeader,
      row('1', 'D', '', 'D’Ambrosio', 'Inter', 5, 12),
      row('2', 'D', '', "D'Ambrosio", 'Inter', 6, 14),
    ])

    expect(result.players.map((player) => player.name)).toEqual(['D’Ambrosio'])
    expect(result.issues).toEqual([
      { row: 5, column: 'Nome', code: 'DUPLICATE', value: "D'Ambrosio" },
    ])
  })

  it('ignora le righe vuote in coda e segnala quelle in mezzo ai dati', () => {
    const result = parsePlayerRows([
      ...officialHeader,
      row('1', 'P', '', 'Sommer', 'Inter', 5, 12),
      [],
      row('2', 'D', '', 'Dimarco', 'Inter', 18, 120),
      [null, null, null, '', null, null, null],
      [],
    ])

    expect(result.totalRows).toBe(3)
    expect(result.players).toHaveLength(2)
    expect(result.issues).toEqual([{ row: 5, code: 'EMPTY_ROW' }])
    expect(result.importable).toBe(true)
  })

  it("usa la mappatura manuale al posto dell'autodetect", () => {
    const matrix: CellMatrix = [
      ['Giocatore', 'Club', 'Posizione', 'Valore', 'Mercato'],
      ['Sommer', 'Inter', 'P', 5, 12],
    ]

    const auto = parsePlayerRows(matrix)
    expect(auto.missingColumns).toEqual(['role', 'quotation', 'fvm'])

    const manual = parsePlayerRows(matrix, {
      name: 'Giocatore',
      team: 'Club',
      role: 'Posizione',
      quotation: 'Valore',
      fvm: 'Mercato',
    })

    expect(manual.missingColumns).toEqual([])
    expect(manual.mapping.role).toBe('Posizione')
    expect(manual.players).toEqual([
      {
        externalId: null,
        name: 'Sommer',
        team: 'Inter',
        role: 'P',
        mantraRole: null,
        quotation: 5,
        fvm: 12,
      },
    ])
  })

  it('trova la riga di intestazione grazie alla mappatura manuale', () => {
    const result = parsePlayerRows(
      [
        ['Listone stagione 2026/27'],
        [],
        ['Giocatore', 'Club', 'Posizione', 'Valore', 'Mercato'],
        ['Sommer', 'Inter', 'P', 5, 12],
      ],
      {
        name: 'Giocatore',
        team: 'Club',
        role: 'Posizione',
        quotation: 'Valore',
        fvm: 'Mercato',
      }
    )

    expect(result.players).toHaveLength(1)
    expect(result.totalRows).toBe(1)
  })

  it('non e importabile senza nessuna riga valida', () => {
    const result = parsePlayerRows([...officialHeader, row('1', 'X', '', 'Ruolo', 'Inter', 5, 12)])

    expect(result.missingColumns).toEqual([])
    expect(result.importable).toBe(false)
  })

  it('non e importabile su una matrice vuota', () => {
    const result = parsePlayerRows([])

    expect(result.importable).toBe(false)
    expect(result.detectedHeaders).toEqual([])
    expect(result.totalRows).toBe(0)
  })
})

describe('parseStatsRows', () => {
  it('legge un foglio statistiche con alias italiani', () => {
    const result = parseStatsRows([
      ['Statistiche 2025/26'],
      ['Nome', 'Squadra', 'Pv', 'Mv', 'Fm', 'Gf', 'Ass', 'Amm', 'Esp', 'Rp', 'Gs', 'R+', 'R-'],
      ['Sommer', 'Inter', 34, 6.1, 6.3, 0, 0, 2, 0, 3, 38, 0, 0],
    ])

    expect(result.missingColumns).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.stats).toEqual([
      {
        playerName: 'Sommer',
        team: 'Inter',
        appearances: 34,
        starts: null,
        minutes: null,
        averageRating: 6.1,
        fantasyAverage: 6.3,
        goals: 0,
        assists: 0,
        yellowCards: 2,
        redCards: 0,
        penaltiesScored: 0,
        penaltiesMissed: 0,
        goalsConceded: 38,
        penaltiesSaved: 3,
      },
    ])
  })

  it('richiede il nome del giocatore', () => {
    expect(
      parseStatsRows([
        ['Pv', 'Mv'],
        [34, 6.1],
      ])
    ).toEqual({
      stats: [],
      issues: [],
      detectedHeaders: ['Pv', 'Mv'],
      missingColumns: ['playerName'],
    })
  })

  it('lascia null i valori non interpretabili senza scartare la riga', () => {
    const result = parseStatsRows([
      ['Nome', 'Pv', 'Mv'],
      ['Sommer', '-', ''],
      ['', 10, 6],
    ])

    expect(result.stats).toHaveLength(1)
    expect(result.stats[0]).toMatchObject({
      playerName: 'Sommer',
      appearances: null,
      averageRating: null,
    })
    expect(result.issues).toEqual([
      { row: 2, column: 'Pv', code: 'INVALID_NUMBER', value: '-' },
      { row: 3, column: 'Nome', code: 'MISSING_VALUE' },
    ])
  })
})
