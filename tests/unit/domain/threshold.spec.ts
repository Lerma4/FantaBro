import { describe, expect, it } from 'vitest'
import { MAX_PRICE_WARNING_RATIO } from '#shared/constants'
import { evaluatePriceThreshold } from '#shared/utils/threshold'

describe('evaluatePriceThreshold', () => {
  it('senza limiti impostati non segnala nulla', () => {
    expect(evaluatePriceThreshold(50, null, null)).toBe('NO_LIMITS')
  })

  it('confronta con il prezzo target quando non e impostato un massimo', () => {
    expect(evaluatePriceThreshold(20, 25, null)).toBe('UNDER_TARGET')
    expect(evaluatePriceThreshold(25, 25, null)).toBe('UNDER_TARGET')
    expect(evaluatePriceThreshold(26, 25, null)).toBe('OVER_TARGET')
  })

  it('segnala il superamento del prezzo massimo', () => {
    expect(evaluatePriceThreshold(101, 50, 100)).toBe('OVER_MAX')
  })

  it('segnala il prezzo massimo raggiunto esattamente', () => {
    expect(evaluatePriceThreshold(100, 50, 100)).toBe('AT_MAX')
  })

  // Il caso che la copia client sbagliava: `price >= maxPrice * ratio` inghiottiva `AT_MAX`.
  it('distingue il massimo raggiunto dal solo avvicinarsi', () => {
    expect(evaluatePriceThreshold(50, null, 50)).toBe('AT_MAX')
    expect(evaluatePriceThreshold(45, null, 50)).toBe('NEAR_MAX')
    expect(evaluatePriceThreshold(50, null, 50)).not.toBe(evaluatePriceThreshold(45, null, 50))
  })

  it('avvisa quando il prezzo si avvicina al massimo', () => {
    expect(MAX_PRICE_WARNING_RATIO).toBe(0.9)
    expect(evaluatePriceThreshold(90, 50, 100)).toBe('NEAR_MAX')
    expect(evaluatePriceThreshold(99, 50, 100)).toBe('NEAR_MAX')
    expect(evaluatePriceThreshold(89, 50, 100)).toBe('OVER_TARGET')
  })

  it('il massimo ha priorita sul target', () => {
    expect(evaluatePriceThreshold(150, 10, 100)).toBe('OVER_MAX')
    expect(evaluatePriceThreshold(95, 10, 100)).toBe('NEAR_MAX')
  })

  it('con solo il prezzo massimo impostato resta in zona sicura sotto la soglia', () => {
    expect(evaluatePriceThreshold(10, null, 100)).toBe('UNDER_TARGET')
    expect(evaluatePriceThreshold(95, null, 100)).toBe('NEAR_MAX')
    expect(evaluatePriceThreshold(120, null, 100)).toBe('OVER_MAX')
  })

  it('gestisce un prezzo massimo a zero', () => {
    expect(evaluatePriceThreshold(0, null, 0)).toBe('AT_MAX')
    expect(evaluatePriceThreshold(1, null, 0)).toBe('OVER_MAX')
  })
})
