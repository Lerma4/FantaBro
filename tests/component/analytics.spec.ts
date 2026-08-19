import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { UApp } from '#components'
import type { MarketAnalytics, MarketBucket } from '#shared/types'
import Analytics from '~/pages/auctions/[auctionId]/analytics.vue'
import { useAuctionStore } from '~/stores/auction'
import { auctionState, auctionSummary } from './fixtures'

const bucket = (overrides: Partial<MarketBucket> = {}): MarketBucket => ({
  key: 'overall',
  soldCount: 0,
  averageSoldPrice: null,
  averageFvm: null,
  priceToFvm: null,
  premiumVsFvmPct: null,
  ...overrides,
})

/** Dodici marcature SOLD, nessun prezzo: niente da calcolare, ma tutto da dire. */
const senzaPrezzi: MarketAnalytics = {
  overall: bucket(),
  byRole: [],
  byTier: [],
  soldWithoutPrice: 12,
}

const conPrezzi: MarketAnalytics = {
  overall: bucket({ soldCount: 8, averageSoldPrice: 78, averageFvm: 65, premiumVsFvmPct: 20 }),
  byRole: [
    bucket({ key: 'A', soldCount: 3, averageSoldPrice: 78, averageFvm: 65, premiumVsFvmPct: 20 }),
  ],
  byTier: [],
  soldWithoutPrice: 4,
}

/**
 * La pagina prende l'id dalla rotta. Montandola fuori da `NuxtPage` il router
 * non popola i parametri, e senza questo mock chiamerebbe
 * `/api/auctions/undefined/analytics`: il test passerebbe sullo stato vuoto
 * prodotto da un 404, non sul caso che vuole verificare.
 */
mockNuxtImport('useRoute', () => () => ({ params: { auctionId: 'a1' } }))

let risposta: MarketAnalytics = senzaPrezzi

/**
 * Solo questa rotta: `registerEndpoint` monta con `app.use`, che combacia per
 * prefisso, quindi un handler su `/api/auctions/a1` inghiottirebbe anche
 * `/api/auctions/a1/analytics` e la pagina leggerebbe il payload sbagliato.
 */
registerEndpoint('/api/auctions/a1/analytics', () => risposta)

/**
 * L'asta e seminata nello store, cosi `useAuctionPage` non rifa la fetch del
 * dettaglio e resta una sola rotta finta da gestire.
 */
const harness = defineComponent({
  components: { Analytics },
  setup() {
    const store = useAuctionStore()
    store.setAuction(auctionSummary())
    store.applyServerState(auctionState())
  },
  template: '<Analytics />',
})

/** Dentro `UApp`: la pagina, in errore, passa da `useToastError` che vuole il provider. */
const monta = () => mountSuspended(UApp, { slots: { default: () => h(harness) } })

describe('analisi di mercato', () => {
  /**
   * Regressione: il conteggio stava dentro il ramo "ci sono dati", quindi
   * mancava proprio nel caso in cui serve — 12 SOLD che non producono analisi.
   */
  it('dichiara i venduti senza prezzo anche quando non c e nulla da calcolare', async () => {
    risposta = senzaPrezzi
    const wrapper = await monta()

    await vi.waitFor(() => expect(wrapper.text()).toContain('Venduti senza prezzo: 12'))
    expect(wrapper.text()).toContain('Nessun prezzo di vendita registrato')
    expect(wrapper.text()).toContain('Esclusi dai calcoli')
  })

  it('dichiara i venduti senza prezzo anche quando i calcoli ci sono', async () => {
    risposta = conPrezzi
    const wrapper = await monta()

    await vi.waitFor(() => expect(wrapper.text()).toContain('Venduti senza prezzo: 4'))
    expect(wrapper.text()).toContain('+20%')
    expect(wrapper.text()).not.toContain('Nessun prezzo di vendita registrato')
  })
})
