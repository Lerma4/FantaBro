<script setup lang="ts">
import { CLASSIC_ROLES } from '#shared/constants'

const model = defineModel<ListoneFilters>({ required: true })
const props = defineProps<{ teams: string[]; tiers: string[]; activeCount: number }>()
const emit = defineEmits<{ reset: [] }>()

const { t } = useI18n()
const open = ref(false)

function toggleRole(role: (typeof CLASSIC_ROLES)[number]) {
  const current = model.value.role
  model.value.role = current.includes(role) ? current.filter((r) => r !== role) : [...current, role]
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UButton color="neutral" variant="outline" icon="i-lucide-sliders-horizontal">
      {{ t('filters.advanced') }}
      <UBadge v-if="props.activeCount > 0" size="sm" variant="solid">
        {{ props.activeCount }}
      </UBadge>
    </UButton>

    <template #content>
      <div class="w-80 space-y-4 p-4">
        <fieldset>
          <legend class="etichetta">{{ t('filters.role') }}</legend>
          <UFieldGroup class="mt-1.5">
            <UButton
              v-for="role in CLASSIC_ROLES"
              :key="role"
              size="xs"
              color="neutral"
              :variant="model.role.includes(role) ? 'solid' : 'outline'"
              :aria-pressed="model.role.includes(role)"
              @click="toggleRole(role)"
            >
              {{ role }}
            </UButton>
          </UFieldGroup>
        </fieldset>

        <UFormField :label="t('filters.team')">
          <USelectMenu
            v-model="model.team"
            multiple
            :items="props.teams"
            :placeholder="t('common.all')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('filters.tier')">
          <USelectMenu
            v-model="model.tier"
            multiple
            :items="props.tiers"
            :placeholder="t('common.all')"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField :label="`${t('filters.quotation')} ${t('common.min')}`">
            <UInputNumber v-model="model.quotationMin" :min="0" class="w-full" />
          </UFormField>
          <UFormField :label="`${t('filters.quotation')} ${t('common.max')}`">
            <UInputNumber v-model="model.quotationMax" :min="0" class="w-full" />
          </UFormField>
          <UFormField :label="`${t('filters.fvm')} ${t('common.min')}`">
            <UInputNumber v-model="model.fvmMin" :min="0" class="w-full" />
          </UFormField>
          <UFormField :label="`${t('filters.fvm')} ${t('common.max')}`">
            <UInputNumber v-model="model.fvmMax" :min="0" class="w-full" />
          </UFormField>
          <UFormField :label="`${t('filters.averageRating')} ${t('common.min')}`">
            <UInputNumber
              v-model="model.averageRatingMin"
              :min="0"
              :max="10"
              :step="0.1"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="`${t('filters.fantasyAverage')} ${t('common.min')}`">
            <UInputNumber
              v-model="model.fantasyAverageMin"
              :min="0"
              :max="20"
              :step="0.1"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField :label="t('filters.appearancesMin')">
          <UInputNumber v-model="model.appearancesMin" :min="0" class="w-full" />
        </UFormField>

        <USwitch v-model="model.onlyTargets" :label="t('filters.onlyTargets')" />

        <div class="flex justify-between pt-1">
          <UButton color="neutral" variant="ghost" @click="emit('reset')">
            {{ t('common.reset') }}
          </UButton>
          <UButton color="neutral" variant="soft" @click="open = false">
            {{ t('common.close') }}
          </UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
