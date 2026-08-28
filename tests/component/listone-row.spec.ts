import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { AppRole } from '#shared/types'
import ListoneRow from '~/components/ListoneRow.vue'
import { useCurrentUser } from '~/composables/useCurrentUser'
import { playerRow } from './fixtures'

const AUCTION_ID = 'a1'
const PLAYER_ID = playerRow().playerId

registerEndpoint(`/api/auctions/${AUCTION_ID}/targets`, {
  method: 'POST',
  handler: () => ({ row: playerRow({ isTarget: false }) }),
})

registerEndpoint(`/api/players/${PLAYER_ID}`, {
  method: 'DELETE',
  handler: () => ({ playerId: PLAYER_ID, season: '2026/27' }),
})

/** La riga legge il ruolo applicativo da `useCurrentUser`: qui si decide chi la monta. */
function asRole(role: AppRole, onRemoved: (playerId: string) => void = () => {}) {
  return defineComponent({
    components: { ListoneRow },
    setup() {
      const { user } = useCurrentUser()
      user.value = { id: 'u1', email: 'admin@fantabro.test', name: 'Admin', role }
      return { row: playerRow(), auctionId: AUCTION_ID, onRemoved }
    },
    template: '<ListoneRow :row="row" :auction-id="auctionId" @removed="onRemoved" />',
  })
}

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

  it('non offre la rimozione dal listone a chi non e ADMIN', async () => {
    const wrapper = await mountSuspended(asRole('MEMBER'))

    const remove = wrapper
      .findAll('button')
      .find((node) => (node.attributes('aria-label') ?? '').startsWith('Rimuovi dal listone'))

    expect(remove).toBeUndefined()
  })

  it('emette removed dopo la conferma, quando chi guarda e ADMIN', async () => {
    const removed: string[] = []
    const wrapper = await mountSuspended(asRole('ADMIN', (id) => removed.push(id)))

    const remove = wrapper
      .findAll('button')
      .find((node) => (node.attributes('aria-label') ?? '').startsWith('Rimuovi dal listone'))
    expect(remove).toBeDefined()

    // La cancellazione non parte dal primo click: passa dalla conferma (spec 49).
    await remove?.trigger('click')
    expect(removed).toEqual([])

    // Il contenuto del popover e' teletrasportato fuori dal wrapper: si cerca nel documento.
    const confirm = await vi.waitFor(() => {
      const button = [...document.body.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === 'Rimuovi'
      )
      expect(button).toBeDefined()
      return button
    })
    confirm?.click()

    await vi.waitFor(() => expect(removed).toEqual([PLAYER_ID]))
  })
})
