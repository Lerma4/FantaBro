<script setup lang="ts">
import type { ClassicRole } from '#shared/types'

const props = defineProps<{
  role: ClassicRole
  occupied: number
  total: number
  /** Oltre questa soglia i quadretti diventano illeggibili: si torna ai numeri. */
  maxPips?: number
}>()

const { t } = useI18n()

const limit = computed(() => props.maxPips ?? 12)
const usePips = computed(() => props.total > 0 && props.total <= limit.value)
const pips = computed(() =>
  Array.from({ length: props.total }, (_, index) => index < props.occupied)
)
const full = computed(() => props.total > 0 && props.occupied >= props.total)
</script>

<template>
  <span
    class="inline-flex items-baseline gap-1.5"
    :aria-label="`${t(`roleLong.${role}`)} ${occupied}/${total}`"
  >
    <span class="etichetta !text-current opacity-70">{{ t(`roleShort.${role}`) }}</span>
    <span v-if="usePips" class="inline-flex items-center gap-0.5" :class="full ? 'opacity-45' : ''">
      <span
        v-for="(filled, index) in pips"
        :key="index"
        class="pip"
        :class="filled ? 'pip-pieno' : 'opacity-45'"
        aria-hidden="true"
      />
    </span>
    <span class="tabellare text-xs">{{ occupied }}/{{ total }}</span>
  </span>
</template>
