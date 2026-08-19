import { describe, expect, it, vi } from 'vitest'
import { readBody } from 'h3'
import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import PriceForm from '~/components/PriceForm.vue'
import { auctionState, playerRow } from './fixtures'

const AUCTION_ID = 'a1'

let lastPurchase: Record<string, unknown> | null = null
let lastSold: Record<string, unknown> | null = null

registerEndpoint(`/api/auctions/${AUCTION_ID}/purchases`, {
  method: 'POST',
  handler: async (event) => {
    lastPurchase = await readBody(event)
    return { state: auctionState(), row: playerRow({ status: 'MY_PLAYER' }), eventId: 'e1' }
  },
})

registerEndpoint(`/api/auctions/${AUCTION_ID}/sold`, {
  method: 'POST',
  handler: async (event) => {
    lastSold = await readBody(event)
    return { state: auctionState(), row: playerRow({ status: 'SOLD' }), eventId: 'e2' }
  },
})

/** Il fixture ha quotazione 20, prezzo target 30, prezzo massimo 40. */
const row = () => playerRow()

/**
 * `mountSuspended` e generico: con gli argomenti di tipo di default il wrapper
 * perde i tipi degli elementi. `VueWrapper` li tiene, e gli helper restano
 * tipizzati senza cast.
 */
type Wrapper = VueWrapper

/** Il campo numerico di Nuxt UI conferma il valore digitato al blur. */
async function typePrice(wrapper: Wrapper, value: string) {
  const input = wrapper.find('input')
  await input.setValue(value)
  await input.trigger('blur')
}

/** Lettura della banda soglia: quali segmenti sono accesi e con che tinta. */
function banda(wrapper: Wrapper) {
  const band = wrapper.find('.soglia')
  const accesi = band
    .findAll('span')
    .map((segment) => segment.classes())
    .filter((classes) => !classes.includes('bg-current/15'))
  return {
    etichetta: band.attributes('aria-label') ?? '',
    accesi: accesi.length,
    tinta: accesi[0]?.join(' ') ?? '',
  }
}

describe('PriceForm in modalita COMPRA', () => {
  it('preseleziona la quotazione e legge la soglia entro il target', async () => {
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: row(), auctionId: AUCTION_ID },
    })

    expect(wrapper.find('input').element.value).toBe('20')
    expect(wrapper.text()).toContain('Entro il tuo target (30)')
  })

  it('avvisa quando il prezzo si avvicina al massimo personale', async () => {
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: row(), auctionId: AUCTION_ID },
    })

    await typePrice(wrapper, '38')

    expect(wrapper.text()).toContain('Vicino al tuo massimo (40)')
  })

  it('distingue il prezzo esattamente pari al massimo (spec 28)', async () => {
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: row(), auctionId: AUCTION_ID },
    })

    await typePrice(wrapper, '40')

    expect(wrapper.text()).toContain('Sei esattamente al tuo massimo (40)')
  })

  it('avvisa quando il prezzo supera il massimo personale', async () => {
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: row(), auctionId: AUCTION_ID },
    })

    await typePrice(wrapper, '45')

    expect(wrapper.text()).toContain('Oltre il tuo massimo (40)')
  })

  it('segnala il sorpasso del target senza gridare al massimo', async () => {
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: row(), auctionId: AUCTION_ID },
    })

    await typePrice(wrapper, '33')

    expect(wrapper.text()).toContain('Sopra il tuo target (30)')
  })

  it('conferma solo su richiesta esplicita e invia playerId e prezzo', async () => {
    lastPurchase = null
    const target = row()
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: target, auctionId: AUCTION_ID },
    })

    // Nessuna richiesta prima della conferma: mai un acquisto automatico (spec 28).
    await typePrice(wrapper, '43')
    expect(lastPurchase).toBeNull()

    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => expect(lastPurchase).not.toBeNull())
    expect(lastPurchase).toEqual({ playerId: target.playerId, price: 43 })
    expect(wrapper.emitted('applied')).toBeTruthy()
  })

  it('con il prezzo vuoto non invia nulla e mostra l errore sul campo', async () => {
    lastPurchase = null
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: row(), auctionId: AUCTION_ID },
    })

    await typePrice(wrapper, '')
    await wrapper.find('form').trigger('submit')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(lastPurchase).toBeNull()
    expect(wrapper.text()).toMatch(/numero/i)
  })
})

/**
 * Regressione: la vecchia soglia lato client inghiottiva `price === maxPrice` in
 * NEAR_MAX, quindi 45 e 50 su un massimo di 50 rendevano identici. La spec 28
 * chiede tre avvisi distinti, e questo test li tiene distinti.
 */
describe('soglia al massimo personale', () => {
  const conMassimo50 = () => playerRow({ targetPrice: 30, maxPrice: 50 })

  it('rende AT_MAX diverso da NEAR_MAX su massimo 50', async () => {
    const vicino = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: conMassimo50(), auctionId: AUCTION_ID },
    })
    await typePrice(vicino, '45')
    const a45 = banda(vicino)

    const pari = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: conMassimo50(), auctionId: AUCTION_ID },
    })
    await typePrice(pari, '50')
    const a50 = banda(pari)

    expect(a45.etichetta).toContain('Vicino al tuo massimo (50)')
    expect(a50.etichetta).toContain('Sei esattamente al tuo massimo (50)')

    // Non basta il testo: banda e tinta devono differire a colpo d'occhio.
    expect(a45.accesi).toBe(3)
    expect(a50.accesi).toBe(4)
    expect(a50.tinta).not.toBe(a45.tinta)
  })

  it('oltre il massimo passa al granata, distinto dallo ocra del confine', async () => {
    const oltre = await mountSuspended(PriceForm, {
      props: { mode: 'BUY', row: conMassimo50(), auctionId: AUCTION_ID },
    })
    await typePrice(oltre, '51')
    const a51 = banda(oltre)

    expect(a51.etichetta).toContain('Oltre il tuo massimo (50)')
    expect(a51.tinta).toContain('granata')
  })
})

describe('PriceForm in modalita VENDUTO', () => {
  it('conferma senza prezzo e senza squadra (spec 16)', async () => {
    lastSold = null
    const target = row()
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'SOLD', row: target, auctionId: AUCTION_ID },
    })

    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => expect(lastSold).not.toBeNull())
    expect(lastSold).toEqual({
      playerId: target.playerId,
      soldPrice: null,
      otherTeamName: null,
    })
    expect(wrapper.emitted('applied')).toBeTruthy()
  })

  it('emette cancel quando si annulla', async () => {
    const wrapper = await mountSuspended(PriceForm, {
      props: { mode: 'SOLD', row: row(), auctionId: AUCTION_ID },
    })

    const cancel = wrapper.findAll('button').find((node) => node.text() === 'Annulla')
    await cancel?.trigger('click')

    expect(wrapper.emitted('cancel')).toBeTruthy()
  })
})
