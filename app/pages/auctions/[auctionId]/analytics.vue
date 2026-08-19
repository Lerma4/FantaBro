<script setup lang="ts">
import { CLASSIC_ROLES } from '#shared/constants'
import type { MarketAnalytics } from '#shared/types'

const { t } = useI18n()
const { n } = useFormat()
const { auctionId } = useAuctionPage()
const toastError = useToastError()

useHead({ title: computed(() => t('analytics.title')) })

const analytics = ref<MarketAnalytics | null>(null)
const loaded = ref(false)

onMounted(async () => {
  try {
    analytics.value = await apiFetch<MarketAnalytics>(`/api/auctions/${auctionId}/analytics`)
  } catch (err) {
    toastError(err)
  } finally {
    loaded.value = true
  }
})

const empty = computed(() => loaded.value && (analytics.value?.overall.soldCount ?? 0) === 0)

const isClassicRole = (key: string): key is (typeof CLASSIC_ROLES)[number] =>
  (CLASSIC_ROLES as readonly string[]).includes(key)

const roleLabel = (key: string) => (isClassicRole(key) ? t(`roleLong.${key}`) : key)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-4xl px-3 py-8 sm:px-5">
      <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
        {{ t('analytics.title') }}
      </h1>

      <div
        v-if="empty"
        class="mt-10 border border-dashed px-6 py-12"
        :style="{ borderColor: 'var(--fb-filo-forte)' }"
      >
        <p class="text-xl leading-tight" style="font-family: var(--font-display)">
          {{ t('analytics.empty') }}
        </p>
        <p class="mt-2 max-w-prose text-sm opacity-70">{{ t('analytics.emptyHint') }}</p>
      </div>

      <template v-else-if="analytics">
        <!-- I venduti senza prezzo restano contati e restano fuori dai calcoli -->
        <p v-if="analytics.soldWithoutPrice > 0" class="mt-5">
          <span class="tabellare text-sm font-semibold">
            {{ t('analytics.soldWithoutPrice', { count: n(analytics.soldWithoutPrice) }) }}
          </span>
          <span class="etichetta ml-2">{{ t('analytics.soldWithoutPriceHint') }}</span>
        </p>

        <div class="mt-8 overflow-x-auto">
          <table class="w-full min-w-2xl text-sm" :aria-label="t('analytics.title')">
            <thead>
              <tr class="border-b" :style="{ borderColor: 'var(--fb-filo-forte)' }">
                <th scope="col" class="pb-1 text-left">
                  <span class="sr-only">{{ t('analytics.title') }}</span>
                </th>
                <th scope="col" class="etichetta pb-1 text-right">
                  {{ t('analytics.soldCount') }}
                </th>
                <th scope="col" class="etichetta pb-1 text-right">
                  {{ t('analytics.averageSoldPrice') }}
                </th>
                <th scope="col" class="etichetta pb-1 text-right">
                  {{ t('analytics.averageFvm') }}
                </th>
                <th scope="col" class="etichetta pb-1 text-right">
                  {{ t('analytics.priceToFvm') }}
                </th>
                <th scope="col" class="etichetta pb-1 text-right">
                  {{ t('analytics.premiumVsFvm') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <MarketBucketRow :bucket="analytics.overall" :label="t('analytics.overall')" />
            </tbody>

            <tbody v-if="analytics.byRole.length > 0">
              <tr>
                <th colspan="6" scope="colgroup" class="etichetta pt-6 pb-1 text-left">
                  {{ t('analytics.byRole') }}
                </th>
              </tr>
              <MarketBucketRow
                v-for="bucket in analytics.byRole"
                :key="bucket.key"
                :bucket="bucket"
                :label="roleLabel(bucket.key)"
              />
            </tbody>

            <tbody v-if="analytics.byTier.length > 0">
              <tr>
                <th colspan="6" scope="colgroup" class="etichetta pt-6 pb-1 text-left">
                  {{ t('analytics.byTier') }}
                </th>
              </tr>
              <MarketBucketRow
                v-for="bucket in analytics.byTier"
                :key="bucket.key"
                :bucket="bucket"
                :label="bucket.key"
              />
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
