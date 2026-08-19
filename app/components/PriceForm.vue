<script setup lang="ts">
import { markSoldSchema, purchasePlayerSchema } from '#shared/schemas'
import type { AuctionState, PlayerRow } from '#shared/types'

const props = defineProps<{
  mode: 'BUY' | 'SOLD'
  row: PlayerRow
  auctionId: string
}>()

const emit = defineEmits<{
  applied: [payload: { state: AuctionState; row: PlayerRow }]
  cancel: []
}>()

const { t } = useI18n()
const { n } = useFormat()
const toastError = useToastError()
const toastOk = useToastOk()

const suggested = Math.round(props.row.quotation)

/** Il prezzo di vendita ad altri resta facoltativo (spec 16): parte vuoto. */
const form = reactive<{
  playerId: string
  price: number
  soldPrice: number | undefined
  otherTeamName: string
}>({
  playerId: props.row.playerId,
  price: suggested,
  soldPrice: undefined,
  otherTeamName: '',
})

const schema = computed(() => (props.mode === 'BUY' ? purchasePlayerSchema : markSoldSchema))
const pending = ref(false)

const shownPrice = computed(() => (props.mode === 'BUY' ? form.price : form.soldPrice))

async function submit() {
  pending.value = true
  try {
    const body =
      props.mode === 'BUY'
        ? { playerId: props.row.playerId, price: form.price }
        : {
            playerId: props.row.playerId,
            soldPrice: form.soldPrice ?? null,
            otherTeamName: form.otherTeamName.trim() || null,
          }

    const res = await apiFetch<{ state: AuctionState; row: PlayerRow }>(
      `/api/auctions/${props.auctionId}/${props.mode === 'BUY' ? 'purchases' : 'sold'}`,
      { method: 'POST', body }
    )

    toastOk(
      props.mode === 'BUY'
        ? t('buy.done', { name: props.row.name, price: n(form.price) })
        : t('sold.done', { name: props.row.name })
    )
    emit('applied', res)
  } catch (err) {
    toastError(err)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UForm
    :schema="schema"
    :state="form"
    class="w-72 space-y-3 p-3"
    @submit="submit"
    @keydown.esc="emit('cancel')"
  >
    <div>
      <p class="etichetta">
        {{
          mode === 'BUY' ? t('buy.title', { name: row.name }) : t('sold.title', { name: row.name })
        }}
      </p>
      <p class="etichetta mt-0.5 !normal-case !tracking-normal">
        {{ t('buy.suggestion', { value: n(suggested) }) }}
      </p>
    </div>

    <UFormField v-if="mode === 'BUY'" :label="t('buy.price')" name="price" required>
      <UInputNumber v-model="form.price" :min="0" autofocus class="w-full" />
    </UFormField>

    <template v-else>
      <UFormField :label="t('sold.price')" name="soldPrice" :hint="t('common.optional')">
        <UInputNumber v-model="form.soldPrice" :min="0" autofocus class="w-full" />
        <template #help>{{ t('sold.priceHint') }}</template>
      </UFormField>

      <UFormField :label="t('sold.otherTeam')" name="otherTeamName" :hint="t('common.optional')">
        <UInput v-model="form.otherTeamName" class="w-full" />
      </UFormField>
    </template>

    <SogliaBar :price="shownPrice" :target-price="row.targetPrice" :max-price="row.maxPrice" />

    <div class="flex justify-end gap-2 pt-1">
      <UButton color="neutral" variant="ghost" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        type="submit"
        :color="mode === 'BUY' ? 'primary' : 'error'"
        :loading="pending"
        :icon="mode === 'BUY' ? 'i-lucide-shopping-cart' : 'i-lucide-user-minus'"
      >
        {{ mode === 'BUY' ? t('buy.confirm') : t('sold.confirm') }}
      </UButton>
    </div>
  </UForm>
</template>
