import { describe, expect, it } from 'vitest'
import type { AuctionRules, PurchaseFact } from '../../../server/domain/budget'
import { checkMarkSold, checkPurchase, checkRevert } from '../../../server/domain/purchase'

const rules: AuctionRules = {
  initialBudget: 100,
  minimumPlayerCost: 1,
  roleSlots: { P: 1, D: 2, C: 2, A: 1 },
  roleBudgets: null,
}

const bought: PurchaseFact[] = [{ playerId: 'p1', role: 'P', price: 10 }]

describe('checkPurchase', () => {
  it('accetta un acquisto valido', () => {
    expect(
      checkPurchase({ rules, purchases: [], role: 'D', price: 30, status: 'AVAILABLE' })
    ).toEqual({ ok: true })
  })

  it('rifiuta un giocatore gia in rosa', () => {
    expect(
      checkPurchase({ rules, purchases: [], role: 'D', price: 30, status: 'MY_PLAYER' })
    ).toEqual({ ok: false, code: 'PLAYER_ALREADY_OWNED' })
  })

  it('rifiuta un giocatore venduto ad altri', () => {
    expect(checkPurchase({ rules, purchases: [], role: 'D', price: 30, status: 'SOLD' })).toEqual({
      ok: false,
      code: 'PLAYER_NOT_AVAILABLE',
    })
  })

  it('rifiuta un prezzo sotto il costo minimo', () => {
    expect(
      checkPurchase({ rules, purchases: [], role: 'D', price: 0, status: 'AVAILABLE' })
    ).toEqual({ ok: false, code: 'PRICE_BELOW_MINIMUM' })
  })

  it('rifiuta un acquisto senza slot liberi nel ruolo', () => {
    expect(
      checkPurchase({ rules, purchases: bought, role: 'P', price: 5, status: 'AVAILABLE' })
    ).toEqual({ ok: false, code: 'ROLE_SLOTS_FULL' })
  })

  it('rifiuta un acquisto oltre il budget residuo', () => {
    expect(
      checkPurchase({ rules, purchases: bought, role: 'D', price: 95, status: 'AVAILABLE' })
    ).toEqual({ ok: false, code: 'BUDGET_EXCEEDED' })
  })

  it("rifiuta un'offerta che renderebbe impossibile riempire gli slot restanti", () => {
    // Budget residuo 90, slot restanti 5: la massima offerta e 86.
    expect(
      checkPurchase({ rules, purchases: bought, role: 'D', price: 88, status: 'AVAILABLE' })
    ).toEqual({ ok: false, code: 'REMAINING_SLOTS_UNFILLABLE' })
  })

  it('controlla la disponibilita prima del prezzo', () => {
    expect(checkPurchase({ rules, purchases: [], role: 'D', price: 0, status: 'SOLD' })).toEqual({
      ok: false,
      code: 'PLAYER_NOT_AVAILABLE',
    })
  })

  it('controlla gli slot prima del budget', () => {
    expect(
      checkPurchase({ rules, purchases: bought, role: 'P', price: 999, status: 'AVAILABLE' })
    ).toEqual({ ok: false, code: 'ROLE_SLOTS_FULL' })
  })
})

describe('checkMarkSold', () => {
  it('accetta un giocatore disponibile', () => {
    expect(checkMarkSold('AVAILABLE')).toEqual({ ok: true })
  })

  it('rifiuta un giocatore della propria rosa', () => {
    expect(checkMarkSold('MY_PLAYER')).toEqual({ ok: false, code: 'PLAYER_ALREADY_OWNED' })
  })

  it('rifiuta un giocatore gia venduto', () => {
    expect(checkMarkSold('SOLD')).toEqual({ ok: false, code: 'PLAYER_NOT_AVAILABLE' })
  })
})

describe('checkRevert', () => {
  it('annulla un acquisto', () => {
    expect(checkRevert({ type: 'PLAYER_PURCHASED', revertedAt: null })).toEqual({ ok: true })
  })

  it('annulla una marcatura SOLD', () => {
    expect(checkRevert({ type: 'PLAYER_SOLD', revertedAt: null })).toEqual({ ok: true })
  })

  it('rifiuta un evento gia annullato', () => {
    expect(checkRevert({ type: 'PLAYER_PURCHASED', revertedAt: new Date() })).toEqual({
      ok: false,
      code: 'EVENT_ALREADY_REVERTED',
    })
  })

  it('rifiuta un tipo di evento non annullabile', () => {
    expect(checkRevert({ type: 'PLAYER_TIER_UPDATED', revertedAt: null })).toEqual({
      ok: false,
      code: 'EVENT_NOT_REVERTABLE',
    })
    expect(checkRevert({ type: 'IMPORT_COMPLETED', revertedAt: null })).toEqual({
      ok: false,
      code: 'EVENT_NOT_REVERTABLE',
    })
  })

  it('segnala prima il doppio annullamento del tipo non annullabile', () => {
    expect(checkRevert({ type: 'PLAYER_PURCHASE_REVERTED', revertedAt: new Date() })).toEqual({
      ok: false,
      code: 'EVENT_ALREADY_REVERTED',
    })
  })
})
