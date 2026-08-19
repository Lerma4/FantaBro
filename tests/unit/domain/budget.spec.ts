import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_SLOTS } from '#shared/constants'
import {
  computeAuctionState,
  computeMaxBid,
  type AuctionRules,
  type PurchaseFact,
} from '../../../server/domain/budget'

const rules = (overrides: Partial<AuctionRules> = {}): AuctionRules => ({
  initialBudget: 500,
  minimumPlayerCost: 1,
  roleSlots: { ...DEFAULT_ROLE_SLOTS },
  roleBudgets: null,
  ...overrides,
})

const purchase = (playerId: string, role: PurchaseFact['role'], price: number): PurchaseFact => ({
  playerId,
  role,
  price,
})

describe('computeMaxBid', () => {
  it('applica la formula della spec 22', () => {
    expect(computeMaxBid(100, 5, 1)).toBe(96)
  })

  it('con un solo slot residuo permette di spendere tutto il budget', () => {
    expect(computeMaxBid(100, 1, 1)).toBe(100)
  })

  it('con la rosa completa non permette nessuna offerta', () => {
    expect(computeMaxBid(100, 0, 1)).toBe(0)
  })

  it('senza costo minimo coincide con il budget residuo', () => {
    expect(computeMaxBid(100, 5, 0)).toBe(100)
  })

  it('non scende sotto zero con un costo minimo piu alto del budget', () => {
    expect(computeMaxBid(3, 10, 1)).toBe(0)
  })

  it('resta un numero anche con un budget gia sforato', () => {
    const maxBid = computeMaxBid(-40, 5, 1)
    expect(maxBid).toBe(0)
    expect(Number.isNaN(maxBid)).toBe(false)
  })
})

describe('computeAuctionState', () => {
  it('senza acquisti espone il budget iniziale e tutti gli slot liberi', () => {
    const state = computeAuctionState('a1', rules(), [])

    expect(state.auctionId).toBe('a1')
    expect(state.spent).toBe(0)
    expect(state.remainingBudget).toBe(500)
    expect(state.totalSlots).toBe(25)
    expect(state.occupiedSlots).toBe(0)
    expect(state.remainingSlots).toBe(25)
    expect(state.averageBudgetPerRemainingSlot).toBe(20)
    expect(state.maxBid).toBe(476)
    expect(state.slots.map((slot) => slot.role)).toEqual(['P', 'D', 'C', 'A'])
    expect(state.slots.every((slot) => slot.free === slot.total)).toBe(true)
  })

  it('deriva spesa, slot e massima offerta dagli acquisti', () => {
    const state = computeAuctionState('a1', rules(), [
      purchase('p1', 'P', 20),
      purchase('p2', 'D', 30),
      purchase('p3', 'A', 150),
    ])

    expect(state.spent).toBe(200)
    expect(state.remainingBudget).toBe(300)
    expect(state.occupiedSlots).toBe(3)
    expect(state.remainingSlots).toBe(22)
    expect(state.maxBid).toBe(300 - 21)
    expect(state.slots.find((slot) => slot.role === 'D')).toEqual({
      role: 'D',
      total: 8,
      occupied: 1,
      free: 7,
    })
  })

  it('con la rosa completa azzera la massima offerta e non calcola la media per slot', () => {
    const full = rules({ roleSlots: { P: 1, D: 1, C: 1, A: 1 } })
    const state = computeAuctionState('a1', full, [
      purchase('p1', 'P', 10),
      purchase('p2', 'D', 10),
      purchase('p3', 'C', 10),
      purchase('p4', 'A', 10),
    ])

    expect(state.remainingSlots).toBe(0)
    expect(state.maxBid).toBe(0)
    expect(state.averageBudgetPerRemainingSlot).toBeNull()
    expect(state.remainingBudget).toBe(460)
  })

  it('con un solo slot residuo la massima offerta e tutto il budget residuo', () => {
    const state = computeAuctionState('a1', rules({ roleSlots: { P: 1, D: 1, C: 0, A: 0 } }), [
      purchase('p1', 'P', 100),
    ])

    expect(state.remainingSlots).toBe(1)
    expect(state.maxBid).toBe(400)
  })

  it('non produce valori negativi o NaN con un budget sforato in input', () => {
    const state = computeAuctionState('a1', rules({ initialBudget: 10 }), [purchase('p1', 'A', 30)])

    expect(state.remainingBudget).toBe(-20)
    expect(state.maxBid).toBe(0)
    expect(Number.isNaN(state.maxBid)).toBe(false)
  })

  it('gestisce acquisti su un ruolo senza slot configurati', () => {
    const state = computeAuctionState('a1', rules({ roleSlots: { P: 0, D: 1, C: 0, A: 0 } }), [
      purchase('p1', 'P', 10),
      purchase('p2', 'D', 10),
    ])

    expect(state.slots.find((slot) => slot.role === 'P')).toEqual({
      role: 'P',
      total: 0,
      occupied: 1,
      free: 0,
    })
    expect(state.totalSlots).toBe(1)
    expect(state.remainingSlots).toBe(0)
    expect(state.maxBid).toBe(0)
  })

  it('con costo minimo zero la massima offerta e il budget residuo', () => {
    const state = computeAuctionState('a1', rules({ minimumPlayerCost: 0 }), [])
    expect(state.maxBid).toBe(500)
  })

  it('espone i budget pianificati per ruolo, null dove non sono pianificati', () => {
    const state = computeAuctionState('a1', rules({ roleBudgets: { P: 30, D: 70 } }), [
      purchase('p1', 'P', 45),
      purchase('p2', 'D', 23),
      purchase('p3', 'A', 200),
    ])

    expect(state.roleBudgets.find((budget) => budget.role === 'P')).toEqual({
      role: 'P',
      planned: 30,
      spent: 45,
      plannedRemaining: -15,
      percentageUsed: 150,
    })
    expect(state.roleBudgets.find((budget) => budget.role === 'D')?.percentageUsed).toBe(32.9)
    expect(state.roleBudgets.find((budget) => budget.role === 'A')).toEqual({
      role: 'A',
      planned: null,
      spent: 200,
      plannedRemaining: null,
      percentageUsed: null,
    })
  })

  it('con un budget di ruolo pianificato a zero non produce Infinity', () => {
    const state = computeAuctionState('a1', rules({ roleBudgets: { P: 0 } }), [
      purchase('p1', 'P', 5),
    ])

    expect(state.roleBudgets.find((budget) => budget.role === 'P')?.percentageUsed).toBe(100)
  })
})
