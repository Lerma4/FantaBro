<script setup lang="ts">
const { t } = useI18n()

useHead({
  titleTemplate: (title) => (title ? `${title} - FantaBro` : 'FantaBro'),
  htmlAttrs: { lang: 'it' },
  link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
})
</script>

<template>
  <UApp :locale="undefined">
    <NuxtLoadingIndicator color="var(--color-verde-500)" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <span class="sr-only">{{ t('app.name') }}</span>
  </UApp>
</template>
