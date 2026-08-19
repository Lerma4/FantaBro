<script setup lang="ts">
import { createAuctionSchema } from '#shared/schemas'
import type { AuctionSummary } from '#shared/types'

const { t } = useI18n()
const { n } = useFormat()
const store = useAuctionStore()
const toastError = useToastError()
const toastOk = useToastOk()

useHead({ title: computed(() => t('nav.auctions')) })

store.reset()

const { data } = await useAsyncData('auctions', () => apiFetch<AuctionSummary[]>('/api/auctions'))

const auctions = computed(() => data.value ?? [])

const creating = ref(false)
const pending = ref(false)
const form = ref(emptyAuctionForm())

function openCreate() {
  form.value = emptyAuctionForm()
  creating.value = true
}

async function create() {
  pending.value = true
  try {
    const created = await apiFetch<AuctionSummary>('/api/auctions', {
      method: 'POST',
      body: auctionFormPayload(form.value),
    })
    creating.value = false
    toastOk(t('auction.created'))
    await navigateTo(`/auctions/${created.id}`)
  } catch (err) {
    toastError(err)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-5xl px-3 py-8 sm:px-5">
      <div class="flex items-end justify-between gap-4">
        <div>
          <h1 class="text-4xl leading-none" style="font-family: var(--font-display)">
            {{ t('nav.auctions') }}
          </h1>
          <p class="etichetta mt-1">{{ t('app.tagline') }}</p>
        </div>
        <UButton icon="i-lucide-plus" @click="openCreate">{{ t('auction.create') }}</UButton>
      </div>

      <!-- Schermo vuoto = invito ad agire -->
      <div
        v-if="auctions.length === 0"
        class="mt-10 border border-dashed px-6 py-14 text-center"
        :style="{ borderColor: 'var(--fb-filo-forte)' }"
      >
        <p class="text-2xl leading-tight" style="font-family: var(--font-display)">
          {{ t('auction.emptyTitle') }}
        </p>
        <p class="mt-2 text-sm opacity-70">{{ t('auction.emptyBody') }}</p>
        <UButton class="mt-6" size="lg" icon="i-lucide-plus" @click="openCreate">
          {{ t('auction.createTitle') }}
        </UButton>
      </div>

      <ul v-else class="mt-8">
        <li
          v-for="auction in auctions"
          :key="auction.id"
          class="riga-listone flex flex-wrap items-center gap-x-6 gap-y-2 py-3"
        >
          <NuxtLink
            :to="`/auctions/${auction.id}`"
            class="min-w-0 flex-1 text-lg leading-tight font-semibold hover:underline"
          >
            {{ auction.name }}
          </NuxtLink>
          <span class="tabellare text-sm opacity-70">{{ auction.season }}</span>
          <span class="etichetta">{{ auction.mode }}</span>
          <span class="etichetta">{{ t(`memberRole.${auction.memberRole}`) }}</span>
          <span class="tabellare text-sm">
            {{ n(auction.initialBudget) }}
            <span class="etichetta">{{ t('auction.budget') }}</span>
          </span>
          <span class="tabellare text-sm">
            {{ n(auction.playersCount) }}
            <span class="etichetta">{{ t('auction.players') }}</span>
          </span>
          <UButton
            :to="`/auctions/${auction.id}`"
            variant="soft"
            trailing-icon="i-lucide-arrow-right"
          >
            {{ t('auction.open') }}
          </UButton>
        </li>
      </ul>

      <UModal
        v-model:open="creating"
        :title="t('auction.createTitle')"
        :ui="{ content: 'max-w-2xl' }"
      >
        <template #body>
          <UForm
            id="create-auction"
            :schema="createAuctionSchema"
            :state="form"
            class="space-y-5"
            @submit="create"
          >
            <AuctionFields v-model="form" show-mode />
          </UForm>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="creating = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton type="submit" form="create-auction" :loading="pending">
              {{ t('auction.create') }}
            </UButton>
          </div>
        </template>
      </UModal>
    </div>
  </div>
</template>
