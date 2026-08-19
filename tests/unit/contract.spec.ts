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

  /**
   * Il server restituisce solo codici; i messaggi vivono in i18n. Un codice senza
   * traduzione arriverebbe all'utente come stringa grezza, quindi va rotto qui.
   * `errors.<CODE>` dice cosa e successo, `errors.hint.<CODE>` cosa fare (spec 45).
   */
  it('ha una traduzione italiana per ogni codice errore', () => {
    const messages: Record<string, unknown> = itMessages.errors
    const missing = ALL_ERROR_CODES.filter((code) => typeof messages[code] !== 'string')
    expect(missing).toEqual([])
  })

  it('non ha suggerimenti azionabili orfani, agganciati a codici inesistenti', () => {
    const hints: Record<string, unknown> = itMessages.errors.hint ?? {}
    const orphans = Object.keys(hints).filter(
      (code) => !(ALL_ERROR_CODES as readonly string[]).includes(code)
    )
    expect(orphans).toEqual([])
  })
})
