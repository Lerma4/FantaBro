<template>
  <div class="flex h-dvh flex-col overflow-hidden">
    <!--
      Guscio a viewport fissa: il banco comando resta in testa e l'area di
      lavoro scorre da sola. Cosi le intestazioni di colonna del listone
      restano appiccicate sotto il banco senza calcoli di altezza.
    -->
    <BancoComando class="shrink-0" />
    <main class="min-h-0 flex-1 overflow-hidden">
      <slot />
    </main>
    <AppFooter class="shrink-0" />
  </div>
</template>
