import { describe, expect, it } from 'vitest'
import {
  ALL_ERROR_CODES,
  AUCTION_PLAYER_STATUSES,
  CLASSIC_ROLES,
  DEFAULT_ROLE_SLOTS,
} from '#shared/constants'
import itMessages from '../../i18n/locales/it.json' with { type: 'json' }

/**
 * Il contratto condiviso e la base su cui lavorano tutti i moduli:
 * se cambia un enum, questo test lo rende visibile subito.
 */
describe('contratto condiviso', () => {
  it('espone i ruoli classici nello ordine di reparto', () => {
    expect(CLASSIC_ROLES).toEqual(['P', 'D', 'C', 'A'])
  })

  it('copre i tre stati di un giocatore in asta', () => {
    expect(AUCTION_PLAYER_STATUSES).toEqual(['AVAILABLE', 'MY_PLAYER', 'SOLD'])
  })

  it('ha uno slot di default per ogni ruolo classico', () => {
    for (const role of CLASSIC_ROLES) {
      expect(DEFAULT_ROLE_SLOTS[role]).toBeGreaterThan(0)
    }
  })

  it('non ha codici errore duplicati', () => {
    expect(new Set(ALL_ERROR_CODES).size).toBe(ALL_ERROR_CODES.length)
  })

  it('ha una traduzione italiana per ogni codice errore', () => {
    const errors = (itMessages as { errors?: Record<string, string> }).errors ?? {}
    const missing = ALL_ERROR_CODES.filter((code) => !errors[code])
    expect(missing).toEqual([])
  })
})
