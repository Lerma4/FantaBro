import { describe, expect, it, vi } from 'vitest'
import { defineComponent, onMounted } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { PlayerRow } from '#shared/types'
import ListoneRow from '~/components/ListoneRow.vue'
import { usePlayerList } from '~/composables/usePlayerList'
import { playerRow } from './fixtures'

const AUCTION_ID = 'a1'

const dimarco = playerRow({ playerId: 'p-dimarco', name: 'Dimarco' })
const bastoni = playerRow({ playerId: 'p-bastoni', name: 'Bastoni' })

registerEndpoint(`/api/auctions/${AUCTION_ID}/players`, () => ({
  rows: [dimarco, bastoni],
  total: 2,
  statsSeason: '2025/26',
  teams: ['Inter'],
}))

/** Il listone in miniatura: le stesse righe della pagina, senza la finestra virtuale. */
const Listone = defineComponent({
  components: { ListoneRow },
  props: {
    applied: { type: Object as () => PlayerRow, required: true },
  },
  setup(props) {
    const list = usePlayerList(AUCTION_ID)
    onMounted(() => list.fetchRows())
    return { list, props }
  },
  template: `
    <div>
      <button data-test="apply" @click="list.applyRow(props.applied)">apply</button>
      <button data-test="only-targets" @click="list.filters.value.onlyTargets = true">t</button>
      <p data-test="total">{{ list.total.value }}</p>
      <ListoneRow
        v-for="row in list.rows.value"
        :key="row.playerId"
        :row="row"
        :auction-id="'${AUCTION_ID}'"
      />
    </div>
  `,
})

describe('usePlayerList', () => {
  it('con filtro Disponibili una riga acquistata sparisce dalla lista', async () => {
    const wrapper = await mountSuspended(Listone, {
      props: {
        applied: playerRow({ playerId: 'p-dimarco', name: 'Dimarco', status: 'MY_PLAYER' }),
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('Bastoni'))
    expect(wrapper.text()).toContain('Dimarco')
    expect(wrapper.get('[data-test="total"]').text()).toBe('2')

    await wrapper.get('[data-test="apply"]').trigger('click')

    expect(wrapper.text()).not.toContain('Dimarco')
    expect(wrapper.text()).toContain('Bastoni')
    expect(wrapper.get('[data-test="total"]').text()).toBe('1')
  })

  it('una riga che resta disponibile viene sostituita al suo posto', async () => {
    const wrapper = await mountSuspended(Listone, {
      props: { applied: playerRow({ playerId: 'p-dimarco', name: 'Dimarco rivisto' }) },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('Dimarco'))

    await wrapper.get('[data-test="apply"]').trigger('click')

    expect(wrapper.text()).toContain('Dimarco rivisto')
    expect(wrapper.text()).toContain('Bastoni')
    expect(wrapper.get('[data-test="total"]').text()).toBe('2')
  })

  it('il filtro solo target fa uscire un giocatore che non e piu target', async () => {
    const wrapper = await mountSuspended(Listone, {
      props: {
        applied: playerRow({ playerId: 'p-dimarco', name: 'Dimarco', isTarget: false }),
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('Dimarco'))

    await wrapper.get('[data-test="only-targets"]').trigger('click')
    await wrapper.get('[data-test="apply"]').trigger('click')

    expect(wrapper.text()).not.toContain('Dimarco')
  })
})
