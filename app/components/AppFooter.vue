<script setup lang="ts">
const { t } = useI18n()
const { public: config } = useRuntimeConfig()
</script>

<template>
  <footer class="flex items-center justify-center gap-3 px-4 py-3 text-xs opacity-60">
    <span class="tabellare">{{ t('app.version', { version: config.appVersion }) }}</span>
    <span class="h-3 w-px bg-current opacity-40" aria-hidden="true" />
    <a
      :href="config.repositoryUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1 hover:opacity-100 focus-visible:opacity-100"
      :aria-label="t('app.repository')"
    >
      <UIcon name="i-lucide-git-branch" class="size-3.5" aria-hidden="true" />
    </a>
  </footer>
</template>
