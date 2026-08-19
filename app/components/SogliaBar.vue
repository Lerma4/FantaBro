<script setup lang="ts">
import type { PriceThreshold } from '#shared/utils/threshold'

const props = defineProps<{
  price?: number | null
  targetPrice?: number | null
  maxPrice?: number | null
}>()

const { t } = useI18n()

/** La lettura della soglia e quella condivisa con il server: una sola verita (spec 28). */
const level = computed<PriceThreshold>(() =>
  props.price == null
    ? 'NO_LIMITS'
    : evaluatePriceThreshold(props.price, props.targetPrice ?? null, props.maxPrice ?? null)
)

/** Quanti segmenti si accendono: piu si sale, piu si e vicini a sforare. */
const STEPS: Record<PriceThreshold, number> = {
  NO_LIMITS: 0,
  UNDER_TARGET: 1,
  OVER_TARGET: 2,
  NEAR_MAX: 3,
  AT_MAX: 4,
  OVER_MAX: 4,
}

const FILL: Record<PriceThreshold, string> = {
  NO_LIMITS: 'bg-current/20',
  UNDER_TARGET: 'bg-verde-500',
  OVER_TARGET: 'bg-ocra-400',
  NEAR_MAX: 'bg-ocra-500',
  AT_MAX: 'bg-ocra-600',
  OVER_MAX: 'bg-granata-600',
}

const TEXT: Record<PriceThreshold, string> = {
  NO_LIMITS: '',
  UNDER_TARGET: '!text-verde-700 dark:!text-verde-300',
  OVER_TARGET: '!text-ocra-600 dark:!text-ocra-300',
  NEAR_MAX: '!text-ocra-600 dark:!text-ocra-300',
  AT_MAX: '!text-ocra-600 dark:!text-ocra-300',
  OVER_MAX: '!text-granata-700 dark:!text-granata-400',
}

const label = computed(() => {
  switch (level.value) {
    case 'UNDER_TARGET':
      return t('soglia.underTarget', { target: props.targetPrice ?? props.maxPrice })
    case 'OVER_TARGET':
      return t('soglia.overTarget', { target: props.targetPrice })
    case 'NEAR_MAX':
      return t('soglia.nearMax', { max: props.maxPrice })
    case 'AT_MAX':
      return t('soglia.atMax', { max: props.maxPrice })
    case 'OVER_MAX':
      return t('soglia.overMax', { max: props.maxPrice })
    default:
      return t('soglia.noLimits')
  }
})
</script>

<template>
  <div>
    <div
      class="soglia grid-cols-4 gap-px"
      role="img"
      :aria-label="`${t('soglia.label')}: ${label}`"
    >
      <span
        v-for="step in 4"
        :key="step"
        :class="step <= STEPS[level] ? FILL[level] : 'bg-current/15'"
      />
    </div>
    <p class="etichetta mt-1 leading-4" :class="TEXT[level]">{{ label }}</p>
  </div>
</template>
