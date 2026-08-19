<script setup lang="ts">
import type { PlayerRow } from '#shared/types'

const { t } = useI18n()
const { n, d } = useFormat()
const route = useRoute()
const router = useRouter()
const { auctionId } = useAuctionPage()
const toastError = useToastError()

useHead({ title: computed(() => t('compare.title')) })

const ids = computed(() => {
  const raw = route.query.ids
  const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  return String(text)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 6)
})

const players = ref<PlayerRow[]>([])
const loading = ref(false)

async function load() {
  if (ids.value.length < 2) {
    players.value = []
    return
  }
  loading.value = true
  try {
    const res = await apiFetch<{ players: PlayerRow[] }>(
      `/api/auctions/${auctionId}/players/compare`,
      { method: 'POST', body: { playerIds: ids.value } }
    )
    players.value = res.players
  } catch (err) {
    toastError(err)
  } finally {
    loading.value = false
  }
}

function drop(playerId: string) {
  return router.replace({
    path: route.path,
    query: { ids: ids.value.filter((id) => id !== playerId).join(',') || undefined },
  })
}

const statsSeason = computed(() => players.value[0]?.statsSeason ?? null)

interface Attribute {
  label: string
  value: (player: PlayerRow) => string
  strong?: boolean
}

const identity = computed<Attribute[]>(() => [
  { label: t('columns.role'), value: (p) => t(`roleLong.${p.role}`) },
  { label: t('columns.team'), value: (p) => p.team },
  { label: t('columns.quotation'), value: (p) => n(p.quotation) },
  { label: t('columns.fvm'), value: (p) => n(p.fvm), strong: true },
  { label: t('columns.status'), value: (p) => t(`status.${p.status}`) },
])

const seasonAttributes = computed<Attribute[]>(() => [
  { label: t('columns.appearances'), value: (p) => n(p.appearances) },
  { label: t('columns.averageRating'), value: (p) => d(p.averageRating) },
  { label: t('columns.fantasyAverage'), value: (p) => d(p.fantasyAverage), strong: true },
  { label: t('columns.goals'), value: (p) => n(p.goals) },
  { label: t('columns.assists'), value: (p) => n(p.assists) },
])

const personal = computed<Attribute[]>(() => [
  { label: t('columns.tier'), value: (p) => p.tier ?? '—' },
  { label: t('targets.targetPrice'), value: (p) => n(p.targetPrice) },
  { label: t('targets.maxPrice'), value: (p) => n(p.maxPrice) },
])

onMounted(load)
watch(ids, load)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-5xl px-3 py-8 sm:px-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
          {{ t('compare.title') }}
        </h1>
        <AiPanel
          v-if="players.length >= 2"
          :auction-id="auctionId"
          :compare-player-ids="players.map((player) => player.playerId)"
          auto-action="COMPARE_PLAYERS"
          :label="t('compare.askAi')"
        />
      </div>

      <div v-if="loading" class="etichetta mt-10">{{ t('common.loading') }}</div>

      <div v-else-if="players.length < 2" class="mt-10">
        <p class="text-lg opacity-70">{{ t('compare.empty') }}</p>
        <UButton class="mt-5" :to="`/auctions/${auctionId}`" icon="i-lucide-list">
          {{ t('nav.listone') }}
        </UButton>
      </div>

      <div v-else class="mt-6 overflow-x-auto">
        <table class="w-full text-sm" :aria-label="t('compare.title')">
          <thead>
            <tr class="border-b" :style="{ borderColor: 'var(--fb-filo-forte)' }">
              <th scope="col" class="w-40 pb-2 text-left">
                <span class="sr-only">{{ t('compare.title') }}</span>
              </th>
              <th
                v-for="player in players"
                :key="player.playerId"
                scope="col"
                class="pb-2 pl-4 text-left align-bottom"
              >
                <NuxtLink
                  :to="`/auctions/${auctionId}/players/${player.playerId}`"
                  class="block leading-tight font-semibold hover:underline"
                >
                  {{ player.name }}
                </NuxtLink>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`${t('common.remove')}: ${player.name}`"
                  @click="drop(player.playerId)"
                />
              </th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="attribute in identity" :key="attribute.label" class="riga-listone">
              <th scope="row" class="etichetta py-2 text-left">{{ attribute.label }}</th>
              <td
                v-for="player in players"
                :key="player.playerId"
                class="py-2 pl-4"
                :class="attribute.strong ? 'tabellare font-semibold' : 'tabellare'"
              >
                {{ attribute.value(player) }}
              </td>
            </tr>
          </tbody>

          <tbody>
            <tr>
              <th
                :colspan="players.length + 1"
                scope="colgroup"
                class="etichetta pt-6 pb-1 text-left"
              >
                {{
                  statsSeason
                    ? t('players.statsSeason', { season: statsSeason })
                    : t('players.statsSeasonNone')
                }}
              </th>
            </tr>
            <tr v-for="attribute in seasonAttributes" :key="attribute.label" class="riga-listone">
              <th scope="row" class="etichetta py-2 text-left">{{ attribute.label }}</th>
              <td
                v-for="player in players"
                :key="player.playerId"
                class="tabellare py-2 pl-4"
                :class="attribute.strong ? 'font-semibold' : ''"
              >
                {{ attribute.value(player) }}
              </td>
            </tr>
          </tbody>

          <tbody>
            <tr>
              <th
                :colspan="players.length + 1"
                scope="colgroup"
                class="etichetta pt-6 pb-1 text-left"
              >
                {{ t('detail.personal') }}
              </th>
            </tr>
            <tr v-for="attribute in personal" :key="attribute.label" class="riga-listone">
              <th scope="row" class="etichetta py-2 text-left">{{ attribute.label }}</th>
              <td v-for="player in players" :key="player.playerId" class="tabellare py-2 pl-4">
                {{ attribute.value(player) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
