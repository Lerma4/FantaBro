<script setup lang="ts">
import { CLASSIC_ROLES } from '#shared/constants'

const model = defineModel<AuctionFormState>({ required: true })
const props = defineProps<{ showMode?: boolean; disabled?: boolean }>()

const { t } = useI18n()
</script>

<template>
  <div class="space-y-5">
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('auction.name')" name="name" required>
        <UInput v-model="model.name" :disabled="props.disabled" class="w-full" />
      </UFormField>

      <UFormField :label="t('auction.season')" name="season" required>
        <UInput
          v-model="model.season"
          placeholder="2026/27"
          :disabled="props.disabled"
          class="tabellare w-full"
        />
      </UFormField>
    </div>

    <UFormField v-if="props.showMode" :label="t('auction.mode')" name="mode">
      <div class="flex items-center gap-3">
        <UBadge color="primary" variant="subtle" size="lg">CLASSIC</UBadge>
        <span class="etichetta">{{ t('auction.modeMantraSoon') }}</span>
      </div>
    </UFormField>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('auction.initialBudget')" name="initialBudget" required>
        <UInputNumber
          v-model="model.initialBudget"
          :min="1"
          :max="100000"
          :disabled="props.disabled"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('auction.minimumPlayerCost')" name="minimumPlayerCost" required>
        <UInputNumber
          v-model="model.minimumPlayerCost"
          :min="0"
          :max="1000"
          :disabled="props.disabled"
          class="w-full"
        />
      </UFormField>
    </div>

    <fieldset>
      <legend class="etichetta">{{ t('auction.roleSlots') }}</legend>
      <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <UFormField
          v-for="role in CLASSIC_ROLES"
          :key="role"
          :label="t(`roleLong.${role}`)"
          :name="`roleSlots.${role}`"
        >
          <UInputNumber
            v-model="model.roleSlots[role]"
            :min="0"
            :max="30"
            :disabled="props.disabled"
            class="w-full"
          />
        </UFormField>
      </div>
    </fieldset>

    <fieldset>
      <legend class="etichetta">{{ t('auction.roleBudgets') }}</legend>
      <p class="mt-1 text-xs opacity-70">{{ t('auction.roleBudgetsHint') }}</p>
      <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <UFormField
          v-for="role in CLASSIC_ROLES"
          :key="role"
          :label="t(`roleLong.${role}`)"
          :name="`roleBudgets.${role}`"
        >
          <UInputNumber
            v-model="model.roleBudgets[role]"
            :min="0"
            :disabled="props.disabled"
            class="w-full"
          />
        </UFormField>
      </div>
    </fieldset>
  </div>
</template>
