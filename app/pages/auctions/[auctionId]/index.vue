<script setup lang="ts">
import { AUCTION_PLAYER_STATUSES, DEFAULT_TIERS } from '#shared/constants'
import type { AuctionPlayerStatus, AuctionState, PlayerRow } from '#shared/types'

const { t } = useI18n()
const { n } = useFormat()
const { auctionId, store } = useAuctionPage()

const {
  filters,
  rows,
  total,
  teams,
  loading,
  loaded,
  activeFilterCount,
  fetchRows,
  applyRow,
  removeRow,
  invalidate,
  resetFilters,
} = usePlayerList(auctionId)

useHead({ title: computed(() => t('players.title')) })

/* ------------------------------------------------------------------ filtri */

const statuses: (AuctionPlayerStatus | 'ALL')[] = [...AUCTION_PLAYER_STATUSES, 'ALL']

const sortItems = computed(() =>
  (
    [
      'fvm',
      'quotation',
      'name',
      'averageRating',
      'fantasyAverage',
      'appearances',
      'priority',
    ] as const
  ).map((value) => ({ label: t(`sort.${value}`), value }))
)

/** Tier proposti nel filtro: i default piu quelli davvero usati nel listone. */
const tierOptions = computed(() => {
  const found = new Set<string>(DEFAULT_TIERS)
  for (const row of rows.value) if (row.tier) found.add(row.tier)
  return [...found]
})

/* ------------------------------------------------- finestra virtuale righe */

/** Altezza di riga fissa: e cio che rende calcolabile la finestra. */
const ROW_H = 40
const OVERSCAN = 10

const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(720)

const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN))
const end = computed(() =>
  Math.min(rows.value.length, start.value + Math.ceil(viewportH.value / ROW_H) + OVERSCAN * 2)
)
const windowRows = computed(() => rows.value.slice(start.value, end.value))
const padTop = computed(() => start.value * ROW_H)
const padBottom = computed(() => Math.max(0, (rows.value.length - end.value) * ROW_H))

function onScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop
}

let sizeObserver: ResizeObserver | undefined

/* ----------------------------------------------------------- selezione 2-6 */

const selected = ref<string[]>([])
const isSelected = (playerId: string) => selected.value.includes(playerId)

function toggleSelect(playerId: string) {
  selected.value = isSelected(playerId)
    ? selected.value.filter((id) => id !== playerId)
    : [...selected.value, playerId]
}

function goCompare() {
  return navigateTo({
    path: `/auctions/${auctionId}/compare`,
    query: { ids: selected.value.join(',') },
  })
}

/* --------------------------------------------------------------- scritture */

/** Contatore di operazioni: il registro si ricarica solo quando serve. */
const operations = ref(0)

function onApplied(payload: { state: AuctionState; row: PlayerRow }) {
  store.applyServerState(payload.state)
  applyRow(payload.row)
  operations.value += 1
}

function onRowUpdated(row: PlayerRow) {
  applyRow(row)
  operations.value += 1
}

/**
 * Rimozione dal listone (solo ADMIN): la riga sparisce subito, senza aspettare
 * lo stream. `store.load(..., true)` rilegge il conteggio del listone, che vive
 * sull'asta e non nello stato d'asta: senza, cancellare l'ultimo giocatore
 * mostrerebbe il vuoto sbagliato.
 */
function onRowRemoved(playerId: string) {
  removeRow(playerId)
  selected.value = selected.value.filter((id) => id !== playerId)
  void store.load(auctionId, true).catch(() => undefined)
}

function onReverted(payload: { state: AuctionState; row: PlayerRow | null }) {
  store.applyServerState(payload.state)
  if (payload.row) applyRow(payload.row)
  else invalidate()
  operations.value += 1
}

/* ------------------------------------------------------ scorciatoie e vita */

function onKeydown(event: KeyboardEvent) {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
  event.preventDefault()
  document.getElementById('listone-search')?.focus()
}

onMounted(() => {
  void fetchRows()
  window.addEventListener('keydown', onKeydown)

  const el = viewport.value
  if (el) {
    viewportH.value = el.clientHeight
    sizeObserver = new ResizeObserver(() => {
      viewportH.value = el.clientHeight
    })
    sizeObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  sizeObserver?.disconnect()
})

// Cambiare filtro significa una lista nuova: si torna in cima.
watch(
  filters,
  () => {
    scrollTop.value = 0
    if (viewport.value) viewport.value.scrollTop = 0
  },
  { deep: true }
)

useAuctionStream(auctionId, () => invalidate())

const emptyListone = computed(
  () => loaded.value && rows.value.length === 0 && store.auction?.playersCount === 0
)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- riga di comando: cercare viene prima di tutto (spec 49) -->
    <div
      class="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-2 sm:px-3"
      :style="{ borderColor: 'var(--fb-filo)' }"
    >
      <UInput
        id="listone-search"
        v-model="filters.q"
        icon="i-lucide-search"
        :placeholder="t('players.searchPlaceholder')"
        :aria-label="t('players.searchPlaceholder')"
        class="w-full sm:w-72"
        autofocus
      >
        <template #trailing>
          <UKbd value="/" :title="t('players.searchHint')" />
        </template>
      </UInput>

      <UFieldGroup :aria-label="t('columns.status')">
        <UButton
          v-for="status in statuses"
          :key="status"
          size="sm"
          color="neutral"
          :variant="filters.status === status ? 'solid' : 'outline'"
          :aria-pressed="filters.status === status"
          @click="filters.status = status"
        >
          {{ t(`status.${status}`) }}
        </UButton>
      </UFieldGroup>

      <PlayerFilters
        v-model="filters"
        :teams="teams"
        :tiers="tierOptions"
        :active-count="activeFilterCount"
        @reset="resetFilters"
      />

      <div class="flex items-center gap-1">
        <USelect
          v-model="filters.sort"
          :items="sortItems"
          :aria-label="t('common.sort')"
          class="w-40"
        />
        <UButton
          color="neutral"
          variant="outline"
          :icon="
            filters.dir === 'desc'
              ? 'i-lucide-arrow-down-wide-narrow'
              : 'i-lucide-arrow-up-narrow-wide'
          "
          :aria-label="t(`sort.${filters.dir}`)"
          :title="t(`sort.${filters.dir}`)"
          @click="filters.dir = filters.dir === 'desc' ? 'asc' : 'desc'"
        />
      </div>

      <div class="ml-auto flex items-center gap-1">
        <AuctionEventLog :auction-id="auctionId" :version="operations" @reverted="onReverted" />
        <AiPanel :auction-id="auctionId" />
      </div>
    </div>

    <!-- selezione per il confronto: appare solo quando c'e qualcosa da fare -->
    <div
      v-if="selected.length > 0"
      class="flex shrink-0 items-center gap-2 border-b px-2 py-1.5 sm:px-3"
      :style="{ borderColor: 'var(--fb-filo)' }"
    >
      <span class="etichetta">{{ t('compare.title') }}</span>
      <UButton
        size="xs"
        :disabled="selected.length < 2 || selected.length > 6"
        icon="i-lucide-columns-3"
        @click="goCompare"
      >
        {{ t('players.compareSelected', { count: selected.length }) }}
      </UButton>
      <UButton size="xs" color="neutral" variant="ghost" @click="selected = []">
        {{ t('players.clearSelection') }}
      </UButton>
    </div>

    <div
      role="table"
      :aria-label="t('players.title')"
      :aria-rowcount="total"
      class="flex min-h-0 flex-1 flex-col"
    >
      <div class="shrink-0" role="rowgroup">
        <p class="etichetta px-2 pt-1.5 text-right sm:px-3">
          {{ t('columns.averageRating') }} / {{ t('columns.fantasyAverage') }} ·
          {{
            store.statsSeason
              ? t('players.statsSeason', { season: store.statsSeason })
              : t('players.statsSeasonNone')
          }}
        </p>
        <div
          class="griglia-listone border-b px-2 py-1"
          :style="{ borderColor: 'var(--fb-filo-forte)' }"
          role="row"
          aria-rowindex="1"
        >
          <span role="columnheader" class="sr-only">{{ t('players.select') }}</span>
          <span role="columnheader" class="etichetta">{{ t('columns.name') }}</span>
          <span role="columnheader" class="etichetta text-center">{{ t('columns.role') }}</span>
          <span role="columnheader" class="etichetta hidden sm:block">
            {{ t('columns.team') }}
          </span>
          <span role="columnheader" class="etichetta text-right">
            {{ t('columns.quotation') }}
          </span>
          <span role="columnheader" class="etichetta hidden text-right sm:block">
            {{ t('columns.fvm') }}
          </span>
          <span role="columnheader" class="etichetta hidden text-right sm:block">
            {{ t('columns.averageRating') }}
          </span>
          <span role="columnheader" class="etichetta hidden text-right sm:block">
            {{ t('columns.fantasyAverage') }}
          </span>
          <span role="columnheader" class="etichetta hidden text-center sm:block">
            {{ t('columns.tier') }}
          </span>
          <span role="columnheader" class="etichetta hidden text-right sm:block">
            {{ t('columns.target') }}
          </span>
          <span role="columnheader" class="etichetta text-right">{{ t('columns.actions') }}</span>
        </div>
      </div>

      <div
        ref="viewport"
        role="rowgroup"
        class="listone-virtuale min-h-0 flex-1 overflow-y-auto"
        @scroll.passive="onScroll"
      >
        <div :style="{ height: `${padTop}px` }" aria-hidden="true" />

        <ListoneRow
          v-for="(row, index) in windowRows"
          :key="row.playerId"
          v-memo="[row, isSelected(row.playerId), start + index]"
          :row="row"
          :auction-id="auctionId"
          :selected="isSelected(row.playerId)"
          :aria-rowindex="start + index + 2"
          :class="{ 'riga-alt': (start + index) % 2 === 1 }"
          :style="{ height: `${ROW_H}px` }"
          @applied="onApplied"
          @updated="onRowUpdated"
          @removed="onRowRemoved"
          @toggle-select="toggleSelect"
        />

        <div :style="{ height: `${padBottom}px` }" aria-hidden="true" />

        <div v-if="loaded && rows.length === 0" class="px-4 py-16 text-center">
          <p class="text-xl leading-tight" style="font-family: var(--font-display)">
            {{ emptyListone ? t('players.empty') : t('players.emptyFiltered') }}
          </p>
          <UButton
            v-if="emptyListone"
            class="mt-5"
            icon="i-lucide-upload"
            :to="`/auctions/${auctionId}/import`"
          >
            {{ t('players.goToImport') }}
          </UButton>
          <UButton v-else class="mt-5" color="neutral" variant="soft" @click="resetFilters">
            {{ t('common.reset') }}
          </UButton>
        </div>
      </div>
    </div>

    <div
      class="flex shrink-0 items-center justify-between gap-3 border-t px-2 py-1.5 sm:px-3"
      :style="{ borderColor: 'var(--fb-filo)' }"
    >
      <p class="tabellare text-xs opacity-70">
        {{ t('players.count', { shown: n(rows.length), total: n(total) }) }}
      </p>
      <UIcon
        v-if="loading"
        name="i-lucide-loader-circle"
        class="animate-spin opacity-60"
        :aria-label="t('common.loading')"
      />
    </div>
  </div>
</template>
