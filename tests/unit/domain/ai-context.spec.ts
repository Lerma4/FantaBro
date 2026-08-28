import { describe, expect, it } from 'vitest'
import type { ClassicRole, PlayerContext, PlayerRow, TargetContext } from '#shared/types'
import {
  buildAuctionContext,
  DEFAULT_CONTEXT_LIMITS,
  parseAdvice,
  renderContextPrompt,
  toPlayerContext,
} from '../../../server/domain/ai-context'
import { computeMarketAnalytics } from '../../../server/domain/analytics'
import { computeAuctionState } from '../../../server/domain/budget'

const state = computeAuctionState(
  'a1',
  {
    initialBudget: 500,
    minimumPlayerCost: 1,
    roleSlots: { P: 3, D: 8, C: 8, A: 6 },
    roleBudgets: null,
  },
  [{ playerId: 'p1', role: 'A', price: 120 }]
)

const analytics = computeMarketAnalytics([])

const player = (name: string, role: ClassicRole, fvm: number): PlayerContext => ({
  name,
  team: 'Team',
  role,
  quotation: 10,
  fvm,
})

const target = (name: string, priority: number | null, maxPrice: number | null): TargetContext => ({
  name,
  role: 'C',
  priority,
  maxPrice,
})

const baseInput = {
  auction: { season: '2026/27', mode: 'CLASSIC' },
  state,
  roster: [{ name: 'Sommer', role: 'P' as ClassicRole, purchasePrice: 12 }],
  targets: [] as TargetContext[],
  alternatives: [] as PlayerContext[],
  analytics,
}

describe('buildAuctionContext', () => {
  it('riporta budget, slot e rosa correnti', () => {
    const context = buildAuctionContext(baseInput)

    expect(context.auction).toEqual({
      season: '2026/27',
      mode: 'CLASSIC',
      initialBudget: 500,
      remainingBudget: 380,
      minimumPlayerCost: 1,
      maxBid: 357,
    })
    expect(context.roster.players).toHaveLength(1)
    expect(context.roster.slots).toHaveLength(4)
    expect(context.currentPlayer).toBeUndefined()
  })

  it('limita le alternative al default e mette in testa lo stesso ruolo del giocatore in gioco', () => {
    const alternatives = [
      ...Array.from({ length: 20 }, (_, index) => player(`D${index}`, 'D', 100 - index)),
      ...Array.from({ length: 20 }, (_, index) => player(`C${index}`, 'C', 200 - index)),
    ]

    const context = buildAuctionContext({
      ...baseInput,
      currentPlayer: player('Barella', 'C', 150),
      alternatives,
    })

    expect(context.availableAlternatives).toHaveLength(DEFAULT_CONTEXT_LIMITS.alternatives)
    expect(context.availableAlternatives.every((entry) => entry.role === 'C')).toBe(true)
    expect(context.availableAlternatives[0]?.name).toBe('C0')
    expect(context.currentPlayer?.name).toBe('Barella')
  })

  it('senza giocatore in gioco ordina le alternative per FVM decrescente', () => {
    const context = buildAuctionContext({
      ...baseInput,
      alternatives: [player('Basso', 'D', 10), player('Alto', 'A', 300)],
    })

    expect(context.availableAlternatives.map((entry) => entry.name)).toEqual(['Alto', 'Basso'])
  })

  it('limita i target e li ordina per priorita, poi per prezzo massimo', () => {
    const targets = [
      target('SenzaPriorita', null, 90),
      target('Terzo', 3, 10),
      target('Primo', 1, 10),
      ...Array.from({ length: 30 }, (_, index) => target(`Riempitivo${index}`, 5, index)),
    ]

    const context = buildAuctionContext({ ...baseInput, targets })

    expect(context.targets).toHaveLength(DEFAULT_CONTEXT_LIMITS.targets)
    expect(context.targets.slice(0, 3).map((entry) => entry.name)).toEqual([
      'Primo',
      'Terzo',
      'Riempitivo29',
    ])
    expect(context.targets.map((entry) => entry.name)).not.toContain('SenzaPriorita')
  })

  it('rispetta i limiti espliciti', () => {
    const context = buildAuctionContext({
      ...baseInput,
      alternatives: [player('A', 'A', 3), player('B', 'A', 2), player('C', 'A', 1)],
      targets: [target('T1', 1, 1), target('T2', 2, 1)],
      limits: { alternatives: 2, targets: 1 },
    })

    expect(context.availableAlternatives).toHaveLength(2)
    expect(context.targets).toHaveLength(1)
  })

  it('tiene i giocatori da confrontare fuori dalle alternative', () => {
    const context = buildAuctionContext({
      ...baseInput,
      alternatives: [player('Disponibile', 'A', 100)],
      comparePlayers: [player('Venduto', 'A', 300)],
    })

    expect(context.availableAlternatives.map((entry) => entry.name)).toEqual(['Disponibile'])
    expect(context.comparePlayers?.map((entry) => entry.name)).toEqual(['Venduto'])
  })

  it('omette comparePlayers quando non ce ne sono', () => {
    expect(buildAuctionContext(baseInput).comparePlayers).toBeUndefined()
    expect(buildAuctionContext({ ...baseInput, comparePlayers: [] }).comparePlayers).toBeUndefined()
  })

  it('non muta gli array di input', () => {
    const alternatives = [player('Basso', 'D', 10), player('Alto', 'A', 300)]
    buildAuctionContext({ ...baseInput, alternatives })

    expect(alternatives.map((entry) => entry.name)).toEqual(['Basso', 'Alto'])
  })
})

describe('toPlayerContext', () => {
  const row: PlayerRow = {
    playerId: 'p9',
    name: 'Dimarco',
    team: 'Inter',
    role: 'D',
    mantraRole: 'E',
    quotation: 18,
    fvm: 120,
    status: 'AVAILABLE',
    soldPrice: null,
    otherTeamName: null,
    purchasePrice: null,
    statsSeason: '2025/26',
    appearances: 34,
    averageRating: 6.4,
    fantasyAverage: 7.1,
    goals: 5,
    assists: 8,
    tier: 'A',
    targetPrice: 40,
    maxPrice: 50,
    priority: 1,
    isTarget: true,
    notes: null,
  }

  const soldRow: PlayerRow = {
    ...row,
    status: 'SOLD',
    soldPrice: 99,
    otherTeamName: 'Altra Squadra',
  }

  it('riduce una riga di listone al contesto giocatore', () => {
    expect(toPlayerContext(row, 43)).toEqual({
      name: 'Dimarco',
      team: 'Inter',
      role: 'D',
      quotation: 18,
      fvm: 120,
      appearances: 34,
      averageRating: 6.4,
      fantasyAverage: 7.1,
      goals: 5,
      assists: 8,
      tier: 'A',
      targetPrice: 40,
      maxPrice: 50,
      currentBid: 43,
    })
  })

  it('non presenta il prezzo di vendita come offerta corrente', () => {
    expect(toPlayerContext(soldRow).currentBid).toBeNull()
    expect(toPlayerContext(soldRow, 12).currentBid).toBe(12)
  })
})

describe('renderContextPrompt', () => {
  const prompt = renderContextPrompt(buildAuctionContext(baseInput), 'Quanto vale Dimarco?')

  it('include la domanda e il contesto', () => {
    expect(prompt).toContain('Quanto vale Dimarco?')
    expect(prompt).toContain('"remainingBudget":380')
  })

  it('chiede una risposta in italiano con un blocco JSON finale', () => {
    expect(prompt).toContain('Reply in Italian.')
    expect(prompt).toContain('```json')
    expect(prompt).toContain('"recommendation"')
  })

  it('spiega che i giocatori da confrontare non sono per forza comprabili', () => {
    expect(prompt).toContain('`availableAlternatives` are players you can still buy right now.')
    expect(prompt).toContain('never recommend buying one of them unless it is also listed')
  })

  it('vieta comandi e file, e concede i soli strumenti di rete', () => {
    expect(prompt).toContain(
      'Do not run commands, do not read or write files, do not use any tool other than WebSearch'
    )
    expect(prompt).toContain('you may use WebSearch and WebFetch')
    // I numeri dell'asta restano quelli del contesto, anche potendo cercare online.
    expect(prompt).toContain(
      'Never invent prices, quotations or statistics that are not in the context above.'
    )
  })
})

describe('parseAdvice', () => {
  it('estrae un consiglio da un JSON nudo', () => {
    const raw = '{"recommendation":"BUY","reasoning":"Vale il prezzo","alternatives":["Bastoni"]}'
    const { advice, text } = parseAdvice(raw)

    expect(advice).toEqual({
      recommendation: 'BUY',
      reasoning: 'Vale il prezzo',
      alternatives: ['Bastoni'],
    })
    // Il consiglio si vede nella scheda: senza prosa attorno non resta testo da stampare.
    expect(text).toBe('')
  })

  it('estrae un consiglio da un fence markdown in coda al testo', () => {
    const raw = [
      'Dimarco a 43 e caro ma sostenibile.',
      '',
      '```json',
      '{"recommendation":"WAIT","suggestedMaxPrice":38,"confidence":0.7,"reasoning":"Aspetta"}',
      '```',
    ].join('\n')

    const { advice, text } = parseAdvice(raw)

    expect(advice?.recommendation).toBe('WAIT')
    expect(advice?.suggestedMaxPrice).toBe(38)
    expect(advice?.confidence).toBe(0.7)
    expect(advice?.alternatives).toEqual([])
    // La prosa resta, il blocco reso come scheda no: niente JSON stampato due volte.
    expect(text).toBe('Dimarco a 43 e caro ma sostenibile.')
  })

  it("preferisce l'ultimo blocco JSON valido", () => {
    const raw = [
      '{"recommendation":"PASS","reasoning":"Bozza"}',
      'Ripensandoci:',
      '{"recommendation":"BUY","reasoning":"Definitivo"}',
    ].join('\n')

    expect(parseAdvice(raw).advice?.reasoning).toBe('Definitivo')
  })

  it('ricade sul testo con un JSON malformato', () => {
    const raw = 'Testo utile\n```json\n{"recommendation":"BUY", reasoning:}\n```'
    const { advice, text } = parseAdvice(raw)

    expect(advice).toBeUndefined()
    expect(text).toContain('Testo utile')
  })

  it('ricade sul testo con un JSON che non rispetta lo schema', () => {
    const raw = '{"recommendation":"MAYBE","reasoning":"Non e un valore ammesso"}'

    expect(parseAdvice(raw).advice).toBeUndefined()
  })

  it("ricade sul testo quando non c'e nessun JSON", () => {
    const { advice, text } = parseAdvice('  Solo prosa, nessun blocco strutturato.  ')

    expect(advice).toBeUndefined()
    expect(text).toBe('Solo prosa, nessun blocco strutturato.')
  })

  it('non lancia su una risposta vuota', () => {
    expect(() => parseAdvice('')).not.toThrow()
    expect(parseAdvice('')).toEqual({ text: '' })
  })
})
