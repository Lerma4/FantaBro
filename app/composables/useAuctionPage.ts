/**
 * Ogni pagina d'asta ha bisogno della stessa cosa: l'id dalla rotta e l'asta
 * caricata nello store. Il caricamento e lato client perche le API sono
 * protette da sessione e non serve rendere in SSR dati privati.
 */
export function useAuctionPage() {
  const route = useRoute()
  const auctionId = String(route.params.auctionId)
  const store = useAuctionStore()
  const toastError = useToastError()
  const ready = ref(false)

  onMounted(async () => {
    try {
      await store.load(auctionId)
    } catch (err) {
      toastError(err)
    } finally {
      ready.value = true
    }
  })

  return { auctionId, store, ready }
}
