<script setup lang="ts">
const { t } = useI18n()
const { n } = useFormat()
const store = useAuctionStore()
const { user, isAdmin, clear } = useCurrentUser()

const route = useRoute()

const links = computed(() => {
  const id = store.auction?.id
  if (!id) return []
  const base = `/auctions/${id}`
  return [
    { label: t('nav.listone'), to: base, exact: true },
    { label: t('nav.roster'), to: `${base}/roster`, exact: false },
    { label: t('nav.targets'), to: `${base}/targets`, exact: false },
    { label: t('nav.analytics'), to: `${base}/analytics`, exact: false },
    { label: t('nav.import'), to: `${base}/import`, exact: false },
    { label: t('nav.settings'), to: `${base}/settings`, exact: false },
  ]
})

const isActive = (link: { to: string; exact: boolean }) =>
  link.exact ? route.path === link.to : route.path.startsWith(link.to)

/**
 * La cifra firma cambia colore quando lo spazio di manovra si assottiglia:
 * il confronto e con la media per slot residuo, non con una soglia inventata.
 */
const maxBidTone = computed(() => {
  const state = store.state
  if (!state) return 'text-[color:var(--fb-banco-testo)]'
  if (state.remainingSlots === 0 || state.maxBid <= state.minimumPlayerCost) {
    return 'text-granata-400'
  }
  const average = state.averageBudgetPerRemainingSlot ?? 0
  if (average > 0 && state.maxBid < average * 1.5) return 'text-ocra-300'
  return 'text-verde-300'
})

async function logout() {
  await authClient.signOut()
  clear()
  store.reset()
  await navigateTo('/login')
}
</script>

<template>
  <header class="banco relative z-30 border-b border-black/40">
    <!-- riga identita: chi sono, dove sono, cosa posso aprire -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
      <NuxtLink to="/" class="flex items-baseline gap-2">
        <span class="text-lg leading-none tracking-tight" style="font-family: var(--font-display)">
          FANTA<span class="text-rosa-300">BRO</span>
        </span>
      </NuxtLink>

      <div v-if="store.auction" class="flex min-w-0 items-baseline gap-2">
        <span class="h-4 w-px bg-white/20" aria-hidden="true" />
        <span class="truncate text-sm font-semibold">{{ store.auction.name }}</span>
        <span class="tabellare text-xs opacity-70">{{ store.auction.season }}</span>
      </div>

      <nav v-if="links.length" class="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="etichetta shrink-0 rounded px-2 py-1 hover:!text-white"
          :class="isActive(link) ? 'bg-white/10 !text-white' : '!text-white/60'"
          :aria-current="isActive(link) ? 'page' : undefined"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>
      <div v-else class="flex-1" />

      <div class="flex shrink-0 items-center gap-1">
        <UButton
          v-if="isAdmin"
          to="/settings/ai"
          icon="i-lucide-sparkles"
          color="neutral"
          variant="ghost"
          :aria-label="t('nav.aiSettings')"
          :title="t('nav.aiSettings')"
        />
        <ThemeToggle />
        <UButton
          v-if="user"
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          :aria-label="`${t('nav.logout')} — ${user.email}`"
          :title="`${t('nav.logout')} — ${user.email}`"
          @click="logout"
        />
      </div>
    </div>

    <!-- letture d'asta: le cifre che guidano ogni decisione -->
    <div
      v-if="store.state"
      class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-white/10 px-3 pt-2 pb-3 sm:px-5"
    >
      <dl class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <dt class="etichetta !text-white/50">{{ t('auction.budget') }}</dt>
          <dd class="tabellare text-base leading-tight">
            {{ n(store.state.initialBudget) }}
          </dd>
        </div>
        <div>
          <dt class="etichetta !text-white/50">{{ t('auction.spent') }}</dt>
          <dd class="tabellare text-base leading-tight">{{ n(store.state.spent) }}</dd>
        </div>
        <div>
          <dt class="etichetta !text-white/50">{{ t('auction.remaining') }}</dt>
          <dd class="tabellare text-base leading-tight font-semibold">
            {{ n(store.state.remainingBudget) }}
          </dd>
        </div>
        <div>
          <dt class="etichetta !text-white/50">{{ t('auction.avgPerSlot') }}</dt>
          <dd class="tabellare text-base leading-tight">
            {{ n(store.state.averageBudgetPerRemainingSlot) }}
          </dd>
        </div>
        <div>
          <dt class="etichetta !text-white/50">{{ t('auction.remainingSlots') }}</dt>
          <dd class="tabellare text-base leading-tight font-semibold">
            {{ n(store.state.remainingSlots) }}
          </dd>
        </div>
        <div>
          <dt class="etichetta !text-white/50">{{ t('auction.slots') }}</dt>
          <dd class="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-0.5">
            <SlotPips
              v-for="slot in store.state.slots"
              :key="slot.role"
              :role="slot.role"
              :occupied="slot.occupied"
              :total="slot.total"
            />
          </dd>
        </div>
      </dl>

      <div class="text-right">
        <p class="etichetta !text-white/50">{{ t('auction.maxBid') }}</p>
        <p class="cifra-firma text-cifra sm:text-cifrona" :class="maxBidTone">
          {{ n(store.state.maxBid) }}
        </p>
      </div>
    </div>
  </header>
</template>
