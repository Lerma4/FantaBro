<script setup lang="ts">
import type { PlayerRow } from '#shared/types'

const { t } = useI18n()
const { n } = useFormat()
const { auctionId } = useAuctionPage()
const toastError = useToastError()

useHead({ title: computed(() => t('targets.title')) })

const rows = ref<PlayerRow[]>([])
const loaded = ref(false)

async function load() {
  try {
    const res = await apiFetch<{ rows: PlayerRow[] }>(`/api/auctions/${auctionId}/players`, {
      query: { onlyTargets: true, status: 'ALL', sort: 'priority', dir: 'asc', limit: 2000 },
    })
    rows.value = res.rows
  } catch (err) {
    toastError(err)
  } finally {
    loaded.value = true
  }
}

function onUpdated(updated: PlayerRow) {
  // Togliere il flag target fa uscire il giocatore da questa lista.
  rows.value = updated.isTarget
    ? rows.value.map((row) => (row.playerId === updated.playerId ? updated : row))
    : rows.value.filter((row) => row.playerId !== updated.playerId)
}

onMounted(load)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-5xl px-3 py-8 sm:px-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
          {{ t('targets.title') }}
        </h1>
        <p class="etichetta">{{ t('sort.priority') }}</p>
      </div>

      <p v-if="loaded && rows.length === 0" class="mt-10 text-lg opacity-70">
        {{ t('targets.empty') }}
      </p>

      <ul class="mt-6">
        <li v-for="row in rows" :key="row.playerId" class="riga-listone py-4">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span v-if="row.priority != null" class="tabellare text-lg font-semibold opacity-60">
              {{ n(row.priority) }}
            </span>
            <NuxtLink
              :to="`/auctions/${auctionId}/players/${row.playerId}`"
              class="text-lg leading-none font-semibold hover:underline"
            >
              {{ row.name }}
            </NuxtLink>
            <span class="etichetta">{{ row.role }} · {{ row.team }}</span>
            <span class="tabellare text-sm opacity-70">
              {{ t('columns.quotation') }} {{ n(row.quotation) }} · {{ t('columns.fvm') }}
              {{ n(row.fvm) }}
            </span>
            <span v-if="row.status !== 'AVAILABLE'" class="etichetta">
              {{ t(`status.${row.status}`) }}
            </span>
          </div>

          <TargetFields
            class="mt-3"
            layout="compact"
            :row="row"
            :auction-id="auctionId"
            @updated="onUpdated"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
