<script setup lang="ts">
import { AI_PROVIDER_IDS } from '#shared/constants'
import { aiSettingsSchema } from '#shared/schemas'
import type { AiProviderId, AiProviderStatus } from '#shared/types'

const { t, te } = useI18n()
const { time } = useFormat()
const { isAdmin } = useCurrentUser()
const store = useAuctionStore()
const toastError = useToastError()
const toastOk = useToastOk()

useHead({ title: computed(() => t('ai.settingsTitle')) })

store.reset()

const STATE_COLOR = {
  AVAILABLE: 'success',
  NOT_AUTHENTICATED: 'warning',
  NOT_INSTALLED: 'neutral',
  ERROR: 'error',
} as const

const providers = ref<AiProviderStatus[]>([])
const testing = ref<AiProviderId | null>(null)
const saving = ref(false)
const settings = reactive<{ defaultProviderId: AiProviderId }>({
  defaultProviderId: AI_PROVIDER_IDS[0],
})

const providerItems = computed(() =>
  AI_PROVIDER_IDS.map((id) => ({ label: t(`ai.provider_name.${id}`), value: id }))
)

/** Il server manda una chiave i18n; se non la conosciamo resta il dettaglio. */
function hint(provider: AiProviderStatus) {
  return provider.hintKey && te(provider.hintKey) ? t(provider.hintKey) : undefined
}

async function load() {
  try {
    const [list, current] = await Promise.all([
      apiFetch<AiProviderStatus[]>('/api/ai/providers'),
      apiFetch<{ defaultProviderId: AiProviderId }>('/api/ai/settings'),
    ])
    providers.value = list
    settings.defaultProviderId = current.defaultProviderId
  } catch (err) {
    toastError(err)
  }
}

async function test(providerId: AiProviderId) {
  testing.value = providerId
  try {
    const updated = await apiFetch<AiProviderStatus>(`/api/ai/providers/${providerId}/test`, {
      method: 'POST',
    })
    providers.value = providers.value.map((provider) =>
      provider.id === providerId ? updated : provider
    )
  } catch (err) {
    toastError(err)
  } finally {
    testing.value = null
  }
}

async function save() {
  saving.value = true
  try {
    await apiFetch<{ defaultProviderId: AiProviderId }>('/api/ai/settings', {
      method: 'PUT',
      body: { defaultProviderId: settings.defaultProviderId },
    })
    toastOk(t('ai.settingsSaved'))
  } catch (err) {
    toastError(err)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  if (isAdmin.value) void load()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-2xl px-3 py-8 sm:px-5">
      <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
        {{ t('ai.settingsTitle') }}
      </h1>

      <p v-if="!isAdmin" class="mt-8 text-lg opacity-70">{{ t('ai.adminOnly') }}</p>

      <template v-else>
        <p class="etichetta mt-2 leading-4">{{ t('ai.neverShowTokens') }}</p>

        <ul class="mt-8">
          <li
            v-for="provider in providers"
            :key="provider.id"
            class="riga-listone flex flex-wrap items-center gap-x-4 gap-y-2 py-4"
          >
            <div class="min-w-0 flex-1">
              <p class="text-lg leading-none font-semibold">
                {{ t(`ai.provider_name.${provider.id}`) }}
              </p>
              <p class="etichetta mt-1">
                {{ t('ai.executable') }}
                <span class="tabellare !normal-case">{{ provider.executable }}</span>
                <template v-if="provider.checkedAt">
                  · {{ t('ai.checkedAt', { time: time(provider.checkedAt) }) }}
                </template>
              </p>
              <p v-if="hint(provider)" class="mt-1.5 text-sm">{{ hint(provider) }}</p>
              <p v-else-if="provider.detail" class="mt-1.5 text-sm opacity-70">
                {{ provider.detail }}
              </p>
            </div>

            <UBadge :color="STATE_COLOR[provider.state]" variant="subtle" size="lg">
              {{ t(`ai.state.${provider.state}`) }}
            </UBadge>

            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-plug-zap"
              :loading="testing === provider.id"
              @click="test(provider.id)"
            >
              {{ t('ai.testConnection') }}
            </UButton>
          </li>
        </ul>

        <UForm
          :schema="aiSettingsSchema"
          :state="settings"
          class="mt-10 flex flex-wrap items-end gap-3"
          @submit="save"
        >
          <UFormField :label="t('ai.defaultProvider')" name="defaultProviderId" class="w-56">
            <USelect v-model="settings.defaultProviderId" :items="providerItems" class="w-full" />
          </UFormField>
          <UButton type="submit" :loading="saving" icon="i-lucide-check">
            {{ t('common.save') }}
          </UButton>
        </UForm>
      </template>
    </div>
  </div>
</template>
