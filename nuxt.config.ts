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

  // Senza `host` il server di sviluppo si lega al solo loopback IPv6 (`[::1]`), e un
  // browser che risolve `localhost` in `127.0.0.1` apre la connessione e resta in attesa:
  // sembra un server bloccato, ed e invece un server che non ascolta dove lo si cerca.
  //
  // Loopback IPv4 esplicito, non `0.0.0.0`: il server di sviluppo espone anche gli
  // endpoint Vite (HMR, sorgenti, accesso al filesystem di progetto), che non vanno
  // offerti alla rete locale per default. Per provare l'asta in due su macchine diverse
  // si usa `pnpm dev --host`, che e una scelta esplicita di chi sviluppa.
  devServer: { host: '127.0.0.1' },

  nitro: {
    experimental: { asyncContext: true },
    // Nitro non ha un limite di dimensione del body: `readMultipartFormData` bufferizza
    // tutto prima che il codice applicativo possa guardare. Il limite duro va quindi
    // messo davanti (Ingress/reverse proxy, vedi k8s/), e lo import lo ricontrolla a
    // valle come difesa in profondita.
  },

  typescript: {
    strict: true,
    typeCheck: false,
    // I test dei componenti stanno in tests/component, fuori dalle include generate da Nuxt:
    // senza questa riga sfuggirebbero a "nuxt typecheck".
    tsConfig: { include: ['../tests/component/**/*'] },
  },

  ui: {
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'],
    },
  },
})
