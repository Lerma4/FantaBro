<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
const route = useRoute()
const { load } = useCurrentUser()

useHead({ title: computed(() => t('auth.title')) })

const schema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
})

const form = reactive({ email: '', password: '' })
const pending = ref(false)
const failed = ref(false)

async function submit() {
  pending.value = true
  failed.value = false
  const { error } = await authClient.signIn.email({
    email: form.email.trim(),
    password: form.password,
  })
  pending.value = false
  if (error) {
    failed.value = true
    return
  }
  await load(true)
  const redirect = route.query.redirect
  await navigateTo(typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/')
}
</script>

<template>
  <div>
    <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
      {{ t('auth.title') }}
    </h1>
    <p class="etichetta mt-1">{{ t('auth.subtitle') }}</p>

    <UForm :schema="schema" :state="form" class="mt-8 space-y-4" @submit="submit">
      <UFormField :label="t('auth.email')" name="email" required>
        <UInput
          v-model="form.email"
          type="email"
          autocomplete="username"
          autofocus
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('auth.password')" name="password" required>
        <UInput
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          class="w-full"
        />
      </UFormField>

      <UAlert
        v-if="failed"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="t('auth.failed')"
      />

      <UButton type="submit" block size="lg" :loading="pending">
        {{ pending ? t('auth.signingIn') : t('auth.signIn') }}
      </UButton>
    </UForm>

    <p class="etichetta mt-6 leading-4">{{ t('auth.noPublicSignup') }}</p>
  </div>
</template>
