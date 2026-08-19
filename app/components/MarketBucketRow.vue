<script setup lang="ts">
import type { MarketBucket } from '#shared/types'

const props = defineProps<{ bucket: MarketBucket; label: string }>()

const { n, d, pct } = useFormat()

/** La barra e larga in proporzione allo scostamento, tagliata al 100%. */
const bar = computed(() => {
  const pct = props.bucket.premiumVsFvmPct
  if (pct == null) return null
  return {
    width: `${Math.min(100, Math.abs(pct))}%`,
    /* Pagato piu del FVM = mercato caro; pagato meno = occasione. */
    tone: pct > 0 ? 'bg-ocra-400' : 'bg-verde-500',
  }
})
</script>

<template>
  <tr class="riga-listone">
    <th scope="row" class="py-2 pr-3 text-left font-medium">{{ props.label }}</th>
    <td class="tabellare py-2 pr-3 text-right">{{ n(bucket.soldCount) }}</td>
    <td class="tabellare py-2 pr-3 text-right font-semibold">{{ n(bucket.averageSoldPrice) }}</td>
    <td class="tabellare py-2 pr-3 text-right">{{ n(bucket.averageFvm) }}</td>
    <td class="tabellare py-2 pr-3 text-right">{{ d(bucket.priceToFvm) }}</td>
    <td class="py-2 text-right">
      <span class="tabellare">{{ pct(bucket.premiumVsFvmPct) }}</span>
      <span v-if="bar" class="mt-1 block h-1 w-full bg-current/10" aria-hidden="true">
        <span class="block h-full" :class="bar.tone" :style="{ width: bar.width }" />
      </span>
    </td>
  </tr>
</template>
