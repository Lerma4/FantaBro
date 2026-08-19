<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <div class="banco flex items-center justify-between px-4 py-3">
      <span class="text-lg leading-none tracking-tight" style="font-family: var(--font-display)">
        FANTA<span class="text-rosa-300">BRO</span>
      </span>
      <ThemeToggle />
    </div>
    <main class="flex flex-1 items-start justify-center px-4 py-12 sm:py-20">
      <div class="w-full max-w-sm">
        <slot />
      </div>
    </main>
    <p class="etichetta px-4 pb-6 text-center">{{ t('app.tagline') }}</p>
  </div>
</template>
