import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createError } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { UApp } from '#components'
import PriceForm from '~/components/PriceForm.vue'
import { toApiError } from '~/composables/useApi'
import { playerRow } from './fixtures'

const AUCTION_ID = 'a1'

registerEndpoint(`/api/auctions/${AUCTION_ID}/purchases`, {
  method: 'POST',
  handler: () => {
    // Il server risponde solo con un codice stabile, nessun testo per l'utente.
    throw createError({ statusCode: 409, data: { code: 'PLAYER_NOT_AVAILABLE' } })
  },
})

describe('errori del server mostrati all utente', () => {
  it('traduce il codice e aggiunge il suggerimento azionabile (spec 45)', async () => {
    const wrapper = await mountSuspended(UApp, {
      slots: {
        default: () => h(PriceForm, { mode: 'BUY', row: playerRow(), auctionId: AUCTION_ID }),
      },
    })

    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Il giocatore non è più disponibile.')
    )
    expect(document.body.textContent).toContain('Ricarica il listone')
  })
})

describe('toApiError', () => {
  it('estrae il codice dal corpo `{ data: { code } }` di createError', () => {
    const error = { status: 409, data: { statusCode: 409, data: { code: 'PLAYER_NOT_AVAILABLE' } } }

    expect(toApiError(error).code).toBe('PLAYER_NOT_AVAILABLE')
  })

  it('estrae il codice anche quando il payload e direttamente il corpo', () => {
    expect(toApiError({ status: 422, data: { code: 'BUDGET_EXCEEDED' } }).code).toBe(
      'BUDGET_EXCEEDED'
    )
  })

  it('ricade sullo status quando il codice manca', () => {
    expect(toApiError({ status: 403 }).code).toBe('FORBIDDEN')
    expect(toApiError({ status: 401 }).code).toBe('UNAUTHORIZED')
    expect(toApiError({ status: 404 }).code).toBe('NOT_FOUND')
  })

  it('non si fida di codici sconosciuti', () => {
    expect(toApiError({ status: 500, data: { code: 'MAI_VISTO' } }).code).toBe('INTERNAL_ERROR')
  })
})
