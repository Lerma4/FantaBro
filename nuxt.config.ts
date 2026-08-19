// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxt/test-utils/module', '@nuxtjs/i18n', '@pinia/nuxt'],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    databaseUrl: '',
    betterAuthSecret: '',
    betterAuthUrl: 'http://localhost:3000',
    ai: {
      defaultProvider: 'claude-code',
      timeoutMs: 120_000,
      maxPending: 8,
      claudeBin: 'claude',
      opencodeBin: 'opencode',
      codexBin: 'codex',
      codexWorkerUrl: '',
    },
    public: {
      appName: 'FantaBro',
    },
  },

  future: { compatibilityVersion: 4 },
  compatibilityDate: '2025-07-15',

  eslint: {
    config: {
      stylistic: false,
    },
  },

  i18n: {
    // Multilingua predisposto: aggiungere una voce a `locales` + il file JSON in `i18n/locales`.
    defaultLocale: 'it',
    strategy: 'no_prefix',
    langDir: 'locales',
    locales: [{ code: 'it', name: 'Italiano', language: 'it-IT', file: 'it.json' }],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'fantabro_locale',
      redirectOn: 'root',
    },
  },

  nitro: {
    experimental: { asyncContext: true },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  ui: {
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'],
    },
  },
})
