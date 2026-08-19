<script setup lang="ts">
import type { AuctionEventRow, AuctionState, PlayerRow } from '#shared/types'

const props = defineProps<{
  auctionId: string
  /** Cambia a ogni operazione: il registro si ricarica solo quando serve. */
  version?: number
}>()

const emit = defineEmits<{
  reverted: [payload: { state: AuctionState; row: PlayerRow | null }]
}>()

const { t } = useI18n()
const { n, time } = useFormat()
const toastError = useToastError()
const toastOk = useToastOk()

const PAGE = 50
const REVERTABLE = new Set(['PLAYER_PURCHASED', 'PLAYER_SOLD'])

const open = ref(false)
const rows = ref<AuctionEventRow[]>([])
const total = ref(0)
const loading = ref(false)
const reverting = ref<string | null>(null)

async function loadEvents(offset = 0) {
  loading.value = true
  try {
    const res = await apiFetch<{ rows: AuctionEventRow[]; total: number }>(
      `/api/auctions/${props.auctionId}/events`,
      { query: { limit: PAGE, offset } }
    )
    rows.value = offset === 0 ? res.rows : [...rows.value, ...res.rows]
    total.value = res.total
  } catch (err) {
    toastError(err)
  } finally {
    loading.value = false
  }
}

/**
 * Il prezzo vive nel payload dell'evento, con nomi diversi per acquisto e
 * vendita: si prende il primo numero utile invece di inventare una cifra.
 */
function amount(row: AuctionEventRow): number | null {
  for (const key of ['price', 'soldPrice', 'purchasePrice'] as const) {
    const value = row.payload[key]
    if (typeof value === 'number') return value
  }
  return null
}

async function revert(row: AuctionEventRow) {
  reverting.value = row.id
  try {
    const res = await apiFetch<{ state: AuctionState; row: PlayerRow | null }>(
      `/api/auctions/${props.auctionId}/events/revert`,
      { method: 'POST', body: { eventId: row.id } }
    )
    toastOk(t('events.revertDone'))
    emit('reverted', res)
    await loadEvents()
  } catch (err) {
    toastError(err)
  } finally {
    reverting.value = null
  }
}

watch(open, (isOpen) => {
  if (isOpen) void loadEvents()
})

watch(
  () => props.version,
  () => {
    if (open.value) void loadEvents()
  }
)
</script>

<template>
  <USlideover v-model:open="open" :title="t('events.title')" side="right">
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-history"
      :aria-label="t('events.open')"
      :title="t('events.open')"
    >
      <span class="hidden lg:inline">{{ t('events.title') }}</span>
    </UButton>

    <template #body>
      <p v-if="!loading && rows.length === 0" class="text-sm opacity-70">
        {{ t('events.empty') }}
      </p>

      <ol v-else>
        <li
          v-for="row in rows"
          :key="row.id"
          class="riga-listone flex items-center gap-3 py-2 text-sm"
          :class="row.revertedAt ? 'opacity-50' : ''"
        >
          <time class="tabellare shrink-0 text-xs opacity-70" :datetime="row.createdAt">
            {{ time(row.createdAt) }}
          </time>

          <span
            class="min-w-0 flex-1 truncate"
            :class="row.revertedAt ? 'line-through decoration-granata-600' : ''"
          >
            <span class="font-medium">{{ row.playerName ?? '—' }}</span>
            <span class="etichetta ml-2">{{ t(`events.type.${row.type}`) }}</span>
          </span>

          <span v-if="amount(row) != null" class="tabellare shrink-0">
            {{ n(amount(row)) }}
          </span>

          <span v-if="row.revertedAt" class="etichetta shrink-0">{{ t('events.reverted') }}</span>
          <UButton
            v-else-if="REVERTABLE.has(row.type)"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-undo-2"
            :loading="reverting === row.id"
            :aria-label="`${t('events.revert')}: ${row.playerName ?? ''}`"
            @click="revert(row)"
          >
            {{ t('events.revert') }}
          </UButton>
        </li>
      </ol>

      <UButton
        v-if="rows.length < total"
        class="mt-4"
        color="neutral"
        variant="soft"
        block
        :loading="loading"
        @click="loadEvents(rows.length)"
      >
        {{ t('events.loadMore') }}
      </UButton>
    </template>
  </USlideover>
</template>
