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
      await defineVitestProject({
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.spec.ts'],
          // Server Nitro reale + PostgreSQL reale: e la sola prova che route,
          // autenticazione, transazioni e servizi si compongano davvero.
          // Si auto-salta senza DATABASE_URL, come i test di integrazione.
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      }),
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
