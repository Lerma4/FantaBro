<script setup lang="ts">
import { CLASSIC_ROLES } from '#shared/constants'
import type { AuctionState, ClassicRole, PlayerRow } from '#shared/types'

interface RosterEntry {
  playerId: string
  name: string
  role: ClassicRole
  team: string
  purchasePrice: number
  purchasedAt: string
}

const { t } = useI18n()
const { n, time } = useFormat()
const { auctionId, store } = useAuctionPage()
const toastError = useToastError()
const toastOk = useToastOk()

useHead({ title: computed(() => t('roster.title')) })

const players = ref<RosterEntry[]>([])
const loaded = ref(false)
const reverting = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await apiFetch<{ players: RosterEntry[] }>(`/api/auctions/${auctionId}/roster`)
    players.value = res.players
  } catch (err) {
    toastError(err)
  } finally {
    loaded.value = true
  }
})

const byRole = computed(() =>
  CLASSIC_ROLES.map((role) => ({
    role,
    slot: store.state?.slots.find((slot) => slot.role === role),
    budget: store.state?.roleBudgets.find((budget) => budget.role === role),
    players: players.value
      .filter((player) => player.role === role)
      .sort((a, b) => b.purchasePrice - a.purchasePrice),
  }))
)

async function revert(player: RosterEntry) {
  reverting.value = player.playerId
  try {
    const res = await apiFetch<{ state: AuctionState; row: PlayerRow }>(
      `/api/auctions/${auctionId}/players/revert`,
      { method: 'POST', body: { playerId: player.playerId } }
    )
    store.applyServerState(res.state)
    players.value = players.value.filter(({ playerId }) => playerId !== player.playerId)
    toastOk(t('events.revertDone'))
  } catch (err) {
    toastError(err)
  } finally {
    reverting.value = null
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-4xl px-3 py-8 sm:px-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
          {{ t('roster.title') }}
        </h1>
        <p v-if="store.state" class="text-right">
          <span class="etichetta">{{ t('roster.spent') }}</span>
          <span class="tabellare block text-2xl leading-none font-semibold">
            {{ n(store.state.spent) }}
          </span>
        </p>
      </div>

      <p v-if="loaded && players.length === 0" class="mt-10 text-lg opacity-70">
        {{ t('roster.empty') }}
      </p>

      <template v-else>
        <section v-for="group in byRole" :key="group.role" class="mt-9">
          <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 class="text-xl leading-none" style="font-family: var(--font-display)">
              {{ t(`roleLong.${group.role}`) }}
            </h2>
            <SlotPips
              v-if="group.slot"
              :role="group.role"
              :occupied="group.slot.occupied"
              :total="group.slot.total"
            />
          </div>

          <!-- budget pianificato: consultivo, non un limite (spec 23) -->
          <dl
            v-if="group.budget"
            class="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b pb-2"
            :style="{ borderColor: 'var(--fb-filo)' }"
          >
            <div class="flex items-baseline gap-1.5">
              <dt class="etichetta">{{ t('roster.planned') }}</dt>
              <dd class="tabellare text-sm">{{ n(group.budget.planned) }}</dd>
            </div>
            <div class="flex items-baseline gap-1.5">
              <dt class="etichetta">{{ t('roster.spent') }}</dt>
              <dd class="tabellare text-sm">{{ n(group.budget.spent) }}</dd>
            </div>
            <div class="flex items-baseline gap-1.5">
              <dt class="etichetta">{{ t('roster.plannedRemaining') }}</dt>
              <dd class="tabellare text-sm">{{ n(group.budget.plannedRemaining) }}</dd>
            </div>
            <div class="flex items-baseline gap-1.5">
              <dt class="etichetta">{{ t('roster.percentageUsed') }}</dt>
              <dd
                class="tabellare text-sm"
                :class="
                  group.budget.percentageUsed != null && group.budget.percentageUsed > 100
                    ? 'text-ocra-600 dark:text-ocra-300'
                    : ''
                "
              >
                {{
                  group.budget.percentageUsed == null ? '—' : `${n(group.budget.percentageUsed)}%`
                }}
              </dd>
            </div>
          </dl>

          <ul v-if="group.players.length > 0" class="mt-1">
            <li
              v-for="player in group.players"
              :key="player.playerId"
              class="riga-listone flex items-center gap-3 py-2 text-sm"
            >
              <NuxtLink
                :to="`/auctions/${auctionId}/players/${player.playerId}`"
                class="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {{ player.name }}
              </NuxtLink>
              <span class="hidden text-xs opacity-60 sm:block">{{ player.team }}</span>
              <time
                class="tabellare hidden text-xs opacity-60 sm:block"
                :datetime="player.purchasedAt"
              >
                {{ time(player.purchasedAt) }}
              </time>
              <span class="tabellare w-14 text-right font-semibold">
                {{ n(player.purchasePrice) }}
              </span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-undo-2"
                :loading="reverting === player.playerId"
                :aria-label="`${t('events.revert')}: ${player.name}`"
                @click="revert(player)"
              />
            </li>
          </ul>
          <p v-else class="mt-2 text-sm opacity-50">{{ t('common.empty') }}</p>
        </section>
      </template>

      <p class="etichetta mt-10 leading-4">{{ t('common.advisory') }}</p>
    </div>
  </div>
</template>
