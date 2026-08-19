<script setup lang="ts">
import { DEFAULT_TIERS } from '#shared/constants'
import type { PlayerRow } from '#shared/types'

const props = defineProps<{
  row: PlayerRow
  auctionId: string
  /** `compact` sta in una riga della lista target, `stack` nella scheda. */
  layout?: 'compact' | 'stack'
}>()

const emit = defineEmits<{ updated: [row: PlayerRow] }>()

const { t } = useI18n()
const toastError = useToastError()
const toastOk = useToastOk()
const tierListId = useId()

interface Draft {
  tier: string
  targetPrice: number | undefined
  maxPrice: number | undefined
  priority: number | undefined
  notes: string
}

function draftFrom(row: PlayerRow): Draft {
  return {
    tier: row.tier ?? '',
    targetPrice: row.targetPrice ?? undefined,
    maxPrice: row.maxPrice ?? undefined,
    priority: row.priority ?? undefined,
    notes: row.notes ?? '',
  }
}

const draft = ref<Draft>(draftFrom(props.row))
const saving = ref(false)

watch(
  () => props.row,
  (row) => {
    draft.value = draftFrom(row)
  }
)

const dirty = computed(() => {
  const saved = draftFrom(props.row)
  return (
    saved.tier !== draft.value.tier ||
    saved.targetPrice !== draft.value.targetPrice ||
    saved.maxPrice !== draft.value.maxPrice ||
    saved.priority !== draft.value.priority ||
    saved.notes !== draft.value.notes
  )
})

async function save() {
  saving.value = true
  try {
    const res = await apiFetch<{ row: PlayerRow }>(`/api/auctions/${props.auctionId}/targets`, {
      method: 'POST',
      body: {
        playerId: props.row.playerId,
        tier: draft.value.tier.trim() || null,
        targetPrice: draft.value.targetPrice ?? null,
        maxPrice: draft.value.maxPrice ?? null,
        priority: draft.value.priority ?? null,
        notes: draft.value.notes.trim() || null,
      },
    })
    toastOk(t('targets.saved'))
    emit('updated', res.row)
  } catch (err) {
    toastError(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div :class="props.layout === 'compact' ? 'flex flex-wrap items-end gap-2' : 'space-y-3'">
    <!-- Il tier accetta valori liberi: i default sono solo suggerimenti. -->
    <UFormField :label="t('targets.tier')" :class="props.layout === 'compact' ? 'w-24' : ''">
      <UInput
        v-model="draft.tier"
        :list="tierListId"
        :placeholder="t('targets.tierPlaceholder')"
        class="w-full"
      />
    </UFormField>
    <datalist :id="tierListId">
      <option v-for="tier in DEFAULT_TIERS" :key="tier" :value="tier" />
    </datalist>

    <UFormField :label="t('targets.targetPrice')" :class="props.layout === 'compact' ? 'w-24' : ''">
      <UInputNumber v-model="draft.targetPrice" :min="0" class="w-full" />
    </UFormField>

    <UFormField :label="t('targets.maxPrice')" :class="props.layout === 'compact' ? 'w-24' : ''">
      <UInputNumber v-model="draft.maxPrice" :min="0" class="w-full" />
    </UFormField>

    <UFormField :label="t('targets.priority')" :class="props.layout === 'compact' ? 'w-24' : ''">
      <UInputNumber v-model="draft.priority" :min="1" :max="999" class="w-full" />
    </UFormField>

    <UFormField
      :label="t('targets.notes')"
      :class="props.layout === 'compact' ? 'min-w-40 flex-1' : ''"
    >
      <UInput
        v-if="props.layout === 'compact'"
        v-model="draft.notes"
        :placeholder="t('targets.notesPlaceholder')"
        class="w-full"
      />
      <UTextarea
        v-else
        v-model="draft.notes"
        :rows="3"
        :placeholder="t('targets.notesPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <UButton :disabled="!dirty" :loading="saving" icon="i-lucide-check" @click="save">
      {{ t('common.save') }}
    </UButton>
  </div>
</template>
