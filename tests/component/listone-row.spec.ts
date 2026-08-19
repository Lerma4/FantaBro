import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ListoneRow from '~/components/ListoneRow.vue'
import { playerRow } from './fixtures'

const AUCTION_ID = 'a1'

registerEndpoint(`/api/auctions/${AUCTION_ID}/targets`, {
  method: 'POST',
  handler: () => ({ row: playerRow({ isTarget: false }) }),
})

function byAriaLabel(labels: string[], needle: string) {
  return labels.find((label) => label.toLowerCase().includes(needle))
}

describe('ListoneRow', () => {
  it('espone COMPRA, VENDUTO, TARGET e DETTAGLI senza aprire il dettaglio', async () => {
    const wrapper = await mountSuspended(ListoneRow, {
      props: { row: playerRow(), auctionId: AUCTION_ID },
    })

    const labels = wrapper
      .findAll('[aria-label]')
      .map((node) => node.attributes('aria-label') ?? '')

    expect(byAriaLabel(labels, 'compra')).toBeDefined()
    expect(byAriaLabel(labels, 'venduto')).toBeDefined()
    expect(byAriaLabel(labels, 'target')).toBeDefined()
    expect(byAriaLabel(labels, 'dettagli')).toBeDefined()
  })

  it('mostra le cifre del giocatore incolonnate', async () => {
    const wrapper = await mountSuspended(ListoneRow, {
      props: { row: playerRow(), auctionId: AUCTION_ID },
    })
    const text = wrapper.text()

    expect(text).toContain('Dimarco')
    expect(text).toContain('120')
    expect(text).toContain('6,32')
    expect(text).toContain('7,18')
  })

  it('emette toggle-select con il playerId quando si spunta la riga', async () => {
    const row = playerRow()
    const wrapper = await mountSuspended(ListoneRow, {
      props: { row, auctionId: AUCTION_ID },
    })

    await wrapper.find('[role="checkbox"]').trigger('click')

    expect(wrapper.emitted('toggle-select')).toEqual([[row.playerId]])
  })

  it('emette updated con la riga tornata dal server quando si toglie il target', async () => {
    const wrapper = await mountSuspended(ListoneRow, {
      props: { row: playerRow(), auctionId: AUCTION_ID },
    })

    const star = wrapper
      .findAll('button')
      .find((node) => (node.attributes('aria-label') ?? '').startsWith('Togli dai target'))
    expect(star).toBeDefined()
    await star?.trigger('click')

    await vi.waitFor(() => expect(wrapper.emitted('updated')).toBeTruthy())
    const emitted = wrapper.emitted('updated') as [{ isTarget: boolean }][]
    expect(emitted[0]?.[0]?.isTarget).toBe(false)
  })

  it('disabilita COMPRA e VENDUTO su un giocatore non disponibile', async () => {
    const wrapper = await mountSuspended(ListoneRow, {
      props: { row: playerRow({ status: 'SOLD', soldPrice: 35 }), auctionId: AUCTION_ID },
    })

    const buy = wrapper
      .findAll('button')
      .find((node) => (node.attributes('aria-label') ?? '').startsWith('Compra'))

    expect(buy?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('35')
  })
})
