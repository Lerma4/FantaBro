<script setup lang="ts">
import type { AuctionState, PlayerRow } from '#shared/types'

const props = defineProps<{
  row: PlayerRow
  auctionId: string
  selected?: boolean
}>()

const emit = defineEmits<{
  applied: [payload: { state: AuctionState; row: PlayerRow }]
  updated: [row: PlayerRow]
  removed: [playerId: string]
  'toggle-select': [playerId: string]
}>()

const { t } = useI18n()
const { n, d } = useFormat()
const toastError = useToastError()
const toastOk = useToastOk()
/** Rimuovere dal listone e' amministrazione della stagione, non dell'asta (spec 8). */
const { isAdmin } = useCurrentUser()

const buyOpen = ref(false)
const soldOpen = ref(false)
const removeOpen = ref(false)
const targeting = ref(false)
const removing = ref(false)
const reverting = ref(false)

const available = computed(() => props.row.status === 'AVAILABLE')

const statusTone = computed(() =>
  props.row.status === 'MY_PLAYER'
    ? 'bg-verde-600'
    : props.row.status === 'SOLD'
      ? 'bg-granata-600'
      : ''
)

/** Il prezzo che conta per una riga non disponibile: pagato o incassato da altri. */
const closedPrice = computed(() =>
  props.row.status === 'MY_PLAYER' ? props.row.purchasePrice : props.row.soldPrice
)

function applied(payload: { state: AuctionState; row: PlayerRow }) {
  buyOpen.value = false
  soldOpen.value = false
  emit('applied', payload)
}

async function toggleTarget() {
  targeting.value = true
  try {
    const res = await apiFetch<{ row: PlayerRow }>(`/api/auctions/${props.auctionId}/targets`, {
      method: 'POST',
      body: { playerId: props.row.playerId, isTarget: !props.row.isTarget },
    })
    emit('updated', res.row)
  } catch (err) {
    toastError(err)
  } finally {
    targeting.value = false
  }
}

async function remove() {
  removing.value = true
  try {
    await apiFetch(`/api/players/${props.row.playerId}`, { method: 'DELETE' })
    toastOk(t('players.removed', { name: props.row.name }))
    removeOpen.value = false
    emit('removed', props.row.playerId)
  } catch (err) {
    toastError(err)
  } finally {
    removing.value = false
  }
}

async function revert() {
  reverting.value = true
  try {
    const res = await apiFetch<{ state: AuctionState; row: PlayerRow }>(
      `/api/auctions/${props.auctionId}/players/revert`,
      { method: 'POST', body: { playerId: props.row.playerId } }
    )
    toastOk(t('events.revertDone'))
    emit('applied', res)
  } catch (err) {
    toastError(err)
  } finally {
    reverting.value = false
  }
}
</script>

<template>
  <div class="riga-listone griglia-listone h-10 px-2 text-sm" role="row">
    <div role="cell" class="flex items-center justify-center">
      <UCheckbox
        :model-value="selected ?? false"
        :aria-label="`${t('players.select')}: ${row.name}`"
        @update:model-value="emit('toggle-select', row.playerId)"
      />
    </div>

    <div role="cell" class="flex min-w-0 items-center gap-2">
      <span
        v-if="statusTone"
        class="size-1.5 shrink-0 rounded-full"
        :class="statusTone"
        :title="t(`status.${row.status}`)"
      />
      <NuxtLink
        :to="`/auctions/${auctionId}/players/${row.playerId}`"
        class="truncate font-medium hover:underline"
      >
        {{ row.name }}
      </NuxtLink>
      <span v-if="closedPrice != null" class="tabellare shrink-0 text-xs opacity-60">
        {{ n(closedPrice) }}
      </span>
    </div>

    <div role="cell" class="tabellare text-center text-xs opacity-70">{{ row.role }}</div>

    <div role="cell" class="hidden truncate text-xs opacity-70 sm:block">{{ row.team }}</div>

    <div role="cell" class="tabellare text-right">{{ n(row.quotation) }}</div>
    <div role="cell" class="tabellare hidden text-right font-semibold sm:block">
      {{ n(row.fvm) }}
    </div>
    <div role="cell" class="tabellare hidden text-right opacity-80 sm:block">
      {{ d(row.averageRating) }}
    </div>
    <div role="cell" class="tabellare hidden text-right opacity-80 sm:block">
      {{ d(row.fantasyAverage) }}
    </div>
    <div role="cell" class="hidden text-center sm:block">
      <span v-if="row.tier" class="etichetta">{{ row.tier }}</span>
      <span v-else class="opacity-30">·</span>
    </div>
    <div role="cell" class="tabellare hidden text-right sm:block">
      {{ row.targetPrice == null ? '·' : n(row.targetPrice) }}
    </div>

    <div role="cell" class="flex items-center justify-end gap-1">
      <UButton
        v-if="!available"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-undo-2"
        :loading="reverting"
        :aria-label="`${t('events.revert')}: ${row.name}`"
        @click="revert"
      />

      <UPopover v-model:open="buyOpen" :content="{ align: 'end' }">
        <UButton
          size="xs"
          icon="i-lucide-shopping-cart"
          :disabled="!available"
          :aria-label="`${t('players.buy')}: ${row.name}`"
        >
          <span class="hidden sm:inline">{{ t('players.buy') }}</span>
        </UButton>
        <template #content>
          <PriceForm
            mode="BUY"
            :row="row"
            :auction-id="auctionId"
            @applied="applied"
            @cancel="buyOpen = false"
          />
        </template>
      </UPopover>

      <UPopover v-model:open="soldOpen" :content="{ align: 'end' }">
        <UButton
          size="xs"
          color="error"
          variant="soft"
          icon="i-lucide-user-minus"
          :disabled="!available"
          :aria-label="`${t('players.sold')}: ${row.name}`"
        />
        <template #content>
          <PriceForm
            mode="SOLD"
            :row="row"
            :auction-id="auctionId"
            @applied="applied"
            @cancel="soldOpen = false"
          />
        </template>
      </UPopover>

      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="row.isTarget ? 'i-lucide-star' : 'i-lucide-star-off'"
        :class="row.isTarget ? '!text-rosa-500' : ''"
        :loading="targeting"
        :aria-pressed="row.isTarget"
        :aria-label="`${row.isTarget ? t('players.targetOff') : t('players.targetOn')}: ${row.name}`"
        @click="toggleTarget"
      />

      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-chevron-right"
        :to="`/auctions/${auctionId}/players/${row.playerId}`"
        :aria-label="`${t('players.details')}: ${row.name}`"
      />

      <!-- Cancellazione dal listone: solo ADMIN, e solo dietro conferma esplicita. -->
      <UPopover v-if="isAdmin" v-model:open="removeOpen" :content="{ align: 'end' }">
        <UButton
          size="xs"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :aria-label="`${t('players.remove')}: ${row.name}`"
        />
        <template #content>
          <div class="w-72 space-y-3 p-3">
            <p class="etichetta">{{ t('players.removeTitle', { name: row.name }) }}</p>
            <p class="text-xs opacity-70">{{ t('players.removeWarning') }}</p>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="ghost" @click="removeOpen = false">
                {{ t('common.cancel') }}
              </UButton>
              <UButton color="error" icon="i-lucide-trash-2" :loading="removing" @click="remove">
                {{ t('players.removeConfirm') }}
              </UButton>
            </div>
          </div>
        </template>
      </UPopover>
    </div>
  </div>
</template>
