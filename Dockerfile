# FantaBro — immagine dell'applicazione Nuxt.
#
# Volutamente SENZA le CLI AI. Su Kubernetes Codex vive nel `codex-worker`
# (spec §37) e l'app lo raggiunge via HTTP interno; l'immagine dell'app resta
# stateless e leggera. Per la modalità Docker Compose, dove i provider CLI
# girano in-process, le CLI vanno installate in un'immagine derivata oppure
# raggiunte tramite il worker: vedi README.md, sezione "Provider AI in Docker".

# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# `packageManager` in package.json fissa la versione di pnpm: corepack la usa.
RUN corepack enable pnpm
WORKDIR /app

# ---------------------------------------------------------------------------
# Dipendenze. `--ignore-scripts` perché il `postinstall` (`nuxt prepare`)
# richiede i sorgenti, che qui non ci sono ancora: così questo layer resta in
# cache finché il lockfile non cambia.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `rebuild` esegue gli script delle sole dipendenze in `onlyBuiltDependencies`
# (esbuild e compagnia), saltati sopra ma necessari a Vite.
RUN pnpm rebuild -r && pnpm build

# ---------------------------------------------------------------------------
# Runtime dell'app: solo l'output di Nitro, nessun sorgente, nessun node_modules
# di sviluppo.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Sovrascrivibili dall'orchestratore.
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

# `node` (uid 1000) esiste già nell'immagine ufficiale: nessun processo root.
COPY --from=build --chown=node:node /app/.output ./
USER node

EXPOSE 3000
# Nitro serve anche `/api/health`, usata dalle probe Kubernetes.
CMD ["node", "server/index.mjs"]

# ---------------------------------------------------------------------------
# Stage separato per le migrazioni Drizzle. Serve perché il runtime contiene
# solo `.output`, mentre `drizzle-kit` ha bisogno di config e file di migrazione.
# Va eseguito come Job/servizio dedicato PRIMA che la nuova versione serva
# traffico (spec §3): mai come migrazione implicita all'avvio di più repliche.
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml drizzle.config.ts ./
COPY server/database ./server/database
USER node
# `drizzle-kit` invocato direttamente e non via `pnpm db:migrate`: corepack
# scaricherebbe pnpm da npmjs.org al primo uso, cioè servirebbe rete in uscita
# proprio nel Job che applica le migrazioni. Lo shim di pnpm imposta già il
# `NODE_PATH` che serve al layout isolato di `node_modules`.
CMD ["node_modules/.bin/drizzle-kit", "migrate"]

# ---------------------------------------------------------------------------
# Stage per il seed idempotente dell'ADMIN iniziale. Viene eseguito solo dal
# Job PostSync e riceve le credenziali dell'admin da un Secret separato.
FROM base AS seed
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY tsconfig.tools.json ./
COPY scripts ./scripts
COPY server/database ./server/database
COPY shared ./shared
USER node
CMD ["node_modules/.bin/tsx", "scripts/seed.ts"]
