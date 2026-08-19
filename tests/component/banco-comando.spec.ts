import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BancoComando from '~/components/BancoComando.vue'
import { useAuctionStore } from '~/stores/auction'
import { auctionState, auctionSummary } from './fixtures'

/** Il banco si monta con lo store gia popolato: e la sua unica sorgente. */
function harness(state = auctionState()) {
  return defineComponent({
    components: { BancoComando },
    setup() {
      const store = useAuctionStore()
      store.setAuction(auctionSummary())
      store.applyServerState(state)
    },
    template: '<BancoComando />',
  })
}

describe('BancoComando', () => {
  it('rende budget, speso, residuo e media per slot', async () => {
    const wrapper = await mountSuspended(harness())
    const text = wrapper.text()

    expect(text).toContain('500')
    expect(text).toContain('213')
    expect(text).toContain('287')
    expect(text).toContain('26')
  })

  it('stampa gli slot liberi totali, senza farli sommare a mente (spec 20, 21)', async () => {
    const wrapper = await mountSuspended(harness())
    const voce = wrapper.findAll('dt').find((node) => node.text() === 'Slot liberi')
      ?.element.nextElementSibling

    expect(voce?.textContent?.trim()).toBe('11')
  })

  it('rende la cifra firma MAX OFFERTA', async () => {
    const wrapper = await mountSuspended(harness())
    const firma = wrapper.find('.cifra-firma')

    expect(firma.exists()).toBe(true)
    expect(firma.text()).toBe('277')
  })

  it('rende un pip per ogni slot del ruolo, pieni quanti gli occupati', async () => {
    const wrapper = await mountSuspended(harness())
    const difesa = wrapper
      .findAll('[aria-label]')
      .find((node) => node.attributes('aria-label') === 'Difensori 5/8')

    expect(difesa).toBeDefined()
    expect(difesa?.findAll('.pip')).toHaveLength(8)
    expect(difesa?.findAll('.pip-pieno')).toHaveLength(5)
  })

  it('colora la cifra firma di allarme quando non resta spazio di manovra', async () => {
    const stretto = auctionState({ maxBid: 1, remainingBudget: 1, remainingSlots: 1 })
    const wrapper = await mountSuspended(harness(stretto))

    expect(wrapper.find('.cifra-firma').classes()).toContain('text-granata-400')
  })

  it('mostra nome asta e stagione', async () => {
    const wrapper = await mountSuspended(harness())

    expect(wrapper.text()).toContain('Lega dei Bro')
    expect(wrapper.text()).toContain('2026/27')
  })
})
