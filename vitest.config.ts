import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

const alias = {
  '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
  '~~': fileURLToPath(new URL('./', import.meta.url)),
  '~': fileURLToPath(new URL('./app', import.meta.url)),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.spec.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.spec.ts'],
        },
      },
      {
        // Progetto node puro, **senza** `defineVitestProject`: `setup({ server: true })`
        // avvia un server Nitro vero e il test ci parla via HTTP, quindi la pipeline vite
        // di Nuxt non serve. Con `defineVitestProject` il file non si carica nemmeno,
        // perche vite prova a bundlare l'import condizionale `bun:test` di test-utils.
        resolve: { alias },
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.spec.ts'],
          // Server Nitro reale + PostgreSQL reale: e la sola prova che route,
          // autenticazione, transazioni e servizi si compongano davvero. Ha subito
          // trovato un bug che 291 test unitari non potevano vedere, perche vitest
          // risolve i moduli CommonJS che il server buildato rifiuta.
          // Si auto-salta senza DATABASE_URL, come i test di integrazione.
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      await defineVitestProject({
        test: {
          name: 'component',
          include: ['tests/component/**/*.spec.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: { domEnvironment: 'happy-dom' },
          },
        },
      }),
    ],
  },
})
