<script setup lang="ts">
const { t } = useI18n()
const colorMode = useColorMode()

const isDark = computed(() => colorMode.value === 'dark')

function toggle() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}
</script>

<template>
  <ClientOnly>
    <UButton
      :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
      color="neutral"
      variant="ghost"
      :aria-label="t('nav.themeToggle')"
      :title="t('nav.themeToggle')"
      @click="toggle"
    />
    <template #fallback>
      <span class="block size-8" aria-hidden="true" />
    </template>
  </ClientOnly>
</template>
