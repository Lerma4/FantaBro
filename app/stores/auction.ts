import { defineStore } from 'pinia'
import type { AuctionMember, AuctionState, AuctionSummary } from '#shared/types'

interface AuctionDetailResponse {
  auction: AuctionSummary
  state: AuctionState
  members: AuctionMember[]
}

/**
 * Unico stato condiviso lato client: asta corrente e stato derivato.
 * I filtri del listone restano locali alla pagina, non finiscono qui.
 */
export const useAuctionStore = defineStore('auction', () => {
  const auction = ref<AuctionSummary | null>(null)
  const state = ref<AuctionState | null>(null)
  const members = ref<AuctionMember[]>([])
  /** Stagione delle statistiche mostrate nel listone (spec 12). */
  const statsSeason = ref<string | null>(null)

  const isOwner = computed(() => auction.value?.memberRole === 'OWNER')

  async function load(auctionId: string, force = false) {
    if (!force && auction.value?.id === auctionId) return
    const res = await apiFetch<AuctionDetailResponse>(`/api/auctions/${auctionId}`)
    auction.value = res.auction
    state.value = res.state
    members.value = res.members
  }

  async function refreshState() {
    const id = auction.value?.id
    if (!id) return
    state.value = await apiFetch<AuctionState>(`/api/auctions/${id}/state`)
  }

  /** Applica lo stato arrivato da una risposta di scrittura o dallo stream SSE. */
  function applyServerState(next: AuctionState) {
    state.value = next
  }

  function setAuction(next: AuctionSummary) {
    auction.value = next
  }

  function setMembers(next: AuctionMember[]) {
    members.value = next
  }

  function setStatsSeason(season: string | null) {
    statsSeason.value = season
  }

  function reset() {
    auction.value = null
    state.value = null
    members.value = []
    statsSeason.value = null
  }

  return {
    auction,
    state,
    members,
    statsSeason,
    isOwner,
    load,
    refreshState,
    applyServerState,
    setAuction,
    setMembers,
    setStatsSeason,
    reset,
  }
})
