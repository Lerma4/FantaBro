<script setup lang="ts">
import type { AuctionState, PlayerCurrentStats, PlayerRow, PlayerSeasonStats } from '#shared/types'

const { t } = useI18n()
const { n, d } = useFormat()
const route = useRoute()
const { auctionId, store } = useAuctionPage()
const toastError = useToastError()
const toastOk = useToastOk()

const playerId = String(route.params.playerId)

const row = ref<PlayerRow | null>(null)
const stats = ref<PlayerSeasonStats[]>([])
const currentStats = ref<PlayerCurrentStats | null>(null)
const loaded = ref(false)
const buyOpen = ref(false)
const soldOpen = ref(false)
const syncing = ref(false)

useHead({ title: computed(() => row.value?.name ?? t('detail.title')) })

onMounted(async () => {
  try {
    const res = await apiFetch<{
      row: PlayerRow
      stats: PlayerSeasonStats[]
      currentStats: PlayerCurrentStats | null
    }>(`/api/auctions/${auctionId}/players/${playerId}`)
    row.value = res.row
    stats.value = res.stats
    currentStats.value = res.currentStats
  } catch (err) {
    toastError(err)
  } finally {
    loaded.value = true
  }
})

async function syncCurrentStats() {
  syncing.value = true
  try {
    const res = await apiFetch<{ currentStats: PlayerCurrentStats | null }>(
      `/api/auctions/${auctionId}/players/${playerId}/stats/sync`,
      { method: 'POST' }
    )
    currentStats.value = res.currentStats
    if (res.currentStats) toastOk(t('detail.syncDone'))
  } catch (err) {
    toastError(err)
  } finally {
    syncing.value = false
  }
}

/** La stagione mostrata e quella dichiarata dalla riga: mai mescolate (spec 12). */
const season = computed(() => {
  const wanted = row.value?.statsSeason
  return stats.value.find((entry) => entry.season === wanted) ?? stats.value[0] ?? null
})

const available = computed(() => row.value?.status === 'AVAILABLE')

function onApplied(payload: { state: AuctionState; row: PlayerRow }) {
  store.applyServerState(payload.state)
  row.value = payload.row
  buyOpen.value = false
  soldOpen.value = false
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div v-if="row" class="mx-auto w-full max-w-3xl px-3 py-8 sm:px-5">
      <NuxtLink :to="`/auctions/${auctionId}`" class="etichetta hover:underline">
        &larr; {{ t('nav.listone') }}
      </NuxtLink>

      <div class="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div class="min-w-0">
          <h1 class="text-4xl leading-none" style="font-family: var(--font-display)">
            {{ row.name }}
          </h1>
          <p class="etichetta mt-1.5">
            {{ t(`roleLong.${row.role}`) }} · {{ row.team
            }}<template v-if="row.mantraRole"> · {{ row.mantraRole }}</template>
          </p>
        </div>

        <dl class="flex items-end gap-8">
          <div>
            <dt class="etichetta">{{ t('columns.quotation') }}</dt>
            <dd class="tabellare text-3xl leading-none">{{ n(row.quotation) }}</dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.fvm') }}</dt>
            <dd class="tabellare text-3xl leading-none font-semibold">{{ n(row.fvm) }}</dd>
          </div>
        </dl>
      </div>

      <div
        v-if="row.status !== 'AVAILABLE'"
        class="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-l-2 pl-3"
        :class="row.status === 'MY_PLAYER' ? 'border-verde-600' : 'border-granata-600'"
      >
        <span class="etichetta">{{ t(`status.${row.status}`) }}</span>
        <span v-if="row.purchasePrice != null" class="tabellare text-sm">
          {{ t('roster.paid') }} {{ n(row.purchasePrice) }}
        </span>
        <span v-if="row.soldPrice != null" class="tabellare text-sm">
          {{ t('columns.soldPrice') }} {{ n(row.soldPrice) }}
        </span>
        <span v-if="row.otherTeamName" class="text-sm">{{ row.otherTeamName }}</span>
      </div>

      <!-- azioni: comprare resta un gesto esplicito (spec 28) -->
      <div class="mt-6 flex flex-wrap items-center gap-2">
        <UPopover v-model:open="buyOpen">
          <UButton size="lg" icon="i-lucide-shopping-cart" :disabled="!available">
            {{ t('players.buy') }}
          </UButton>
          <template #content>
            <PriceForm
              mode="BUY"
              :row="row"
              :auction-id="auctionId"
              @applied="onApplied"
              @cancel="buyOpen = false"
            />
          </template>
        </UPopover>

        <UPopover v-model:open="soldOpen">
          <UButton
            size="lg"
            color="error"
            variant="soft"
            icon="i-lucide-user-minus"
            :disabled="!available"
          >
            {{ t('players.sold') }}
          </UButton>
          <template #content>
            <PriceForm
              mode="SOLD"
              :row="row"
              :auction-id="auctionId"
              @applied="onApplied"
              @cancel="soldOpen = false"
            />
          </template>
        </UPopover>

        <UButton
          size="lg"
          color="neutral"
          variant="outline"
          icon="i-lucide-columns-3"
          :to="{ path: `/auctions/${auctionId}/compare`, query: { ids: row.playerId } }"
        >
          {{ t('detail.compare') }}
        </UButton>

        <AiPanel :auction-id="auctionId" :player-id="row.playerId" :label="t('detail.askAi')" />
      </div>

      <section class="mt-10">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-xl leading-none" style="font-family: var(--font-display)">
            {{ t('detail.currentSeason') }}
          </h2>
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="syncing"
            @click="syncCurrentStats"
          >
            {{ t('detail.sync') }}
          </UButton>
        </div>

        <dl
          v-if="currentStats"
          class="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-3 sm:grid-cols-6"
          :style="{ borderColor: 'var(--fb-filo-forte)' }"
        >
          <div>
            <dt class="etichetta">{{ t('detail.currentAppearances') }}</dt>
            <dd class="tabellare text-xl leading-none">
              {{ n(currentStats.appearances) }} / {{ n(currentStats.teamAppearances) }}
            </dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('detail.currentStarts') }}</dt>
            <dd class="tabellare text-xl leading-none">
              {{ currentStats.starts === null ? '—' : n(currentStats.starts) }}
            </dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.minutes') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ n(currentStats.minutes) }}</dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.averageRating') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ d(currentStats.averageRating) }}</dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.goals') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ n(currentStats.goals) }}</dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.assists') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ n(currentStats.assists) }}</dd>
          </div>
        </dl>
        <div
          v-if="currentStats && (currentStats.pros || currentStats.cons)"
          class="mt-6 grid gap-3 sm:grid-cols-2"
        >
          <article
            v-if="currentStats.pros"
            class="border-l-2 border-verde-600 bg-verde-50/50 px-4 py-3 dark:bg-verde-950/20"
          >
            <h3 class="etichetta text-verde-700 dark:text-verde-300">{{ t('detail.pros') }}</h3>
            <p class="mt-1 text-sm leading-relaxed">{{ currentStats.pros }}</p>
          </article>
          <article
            v-if="currentStats.cons"
            class="border-l-2 border-granata-600 bg-granata-50/50 px-4 py-3 dark:bg-granata-950/20"
          >
            <h3 class="etichetta text-granata-700 dark:text-granata-300">{{ t('detail.cons') }}</h3>
            <p class="mt-1 text-sm leading-relaxed">{{ currentStats.cons }}</p>
          </article>
        </div>
        <p
          v-else
          class="mt-3 border-t pt-3 text-sm opacity-70"
          :style="{ borderColor: 'var(--fb-filo-forte)' }"
        >
          {{ t('detail.currentSeasonUnavailable') }}
        </p>
      </section>

      <section v-if="season || !currentStats" class="mt-10">
        <h2 class="text-xl leading-none" style="font-family: var(--font-display)">
          {{
            season
              ? t('detail.previousSeason', { season: season.season })
              : t('detail.previousSeasonNone')
          }}
        </h2>

        <dl
          v-if="season"
          class="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-3 sm:grid-cols-5"
          :style="{ borderColor: 'var(--fb-filo-forte)' }"
        >
          <div>
            <dt class="etichetta">{{ t('columns.appearances') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ n(season.appearances) }}</dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.averageRating') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ d(season.averageRating) }}</dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.fantasyAverage') }}</dt>
            <dd class="tabellare text-xl leading-none font-semibold">
              {{ d(season.fantasyAverage) }}
            </dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.goals') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ n(season.goals) }}</dd>
          </div>
          <div>
            <dt class="etichetta">{{ t('columns.assists') }}</dt>
            <dd class="tabellare text-xl leading-none">{{ n(season.assists) }}</dd>
          </div>
        </dl>
      </section>

      <section class="mt-10">
        <h2 class="text-xl leading-none" style="font-family: var(--font-display)">
          {{ t('detail.personal') }}
        </h2>
        <TargetFields
          class="mt-4"
          :row="row"
          :auction-id="auctionId"
          @updated="(updated) => (row = updated)"
        />
      </section>
    </div>

    <p v-else-if="loaded" class="px-5 py-12 text-lg opacity-70">
      {{ t('errors.PLAYER_NOT_FOUND') }}
    </p>
  </div>
</template>
