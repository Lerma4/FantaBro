<script setup lang="ts">
const { t } = useI18n()

useHead({
  titleTemplate: (title) => (title ? `${title} - FantaBro` : 'FantaBro'),
  htmlAttrs: { lang: 'it' },
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
