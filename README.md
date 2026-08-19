# FantaBro

Assistente personale per l'asta del Fantacalcio, self-hosted.

**Non** è una piattaforma di gestione lega: serve a supportare la _tua_ squadra
durante un'asta dal vivo. Listone aggiornato con quotazioni e FVM, statistiche
della stagione precedente, ricerca rapida, rosa, budget e slot per ruolo,
giocatori venduti agli altri, target con tier e prezzi massimi, analytics di
mercato e consigli AI basati sullo stato reale dell'asta.

Il requisito di prodotto più importante: **l'app deve restare veloce e affidabile
durante un'asta reale**. Tutto il resto viene dopo.

La specifica completa è in [`docs/SPEC.md`](docs/SPEC.md) ed è la fonte di verità.

## Stack

- **Nuxt 4** + Vue 3 + TypeScript strict + **Nuxt UI 4** (Tailwind v4)
- Nitro server routes; Pinia solo dove serve stato condiviso lato client
- **Zod** per la validazione a runtime
- **PostgreSQL** + **Drizzle ORM**, migrazioni con Drizzle Kit
- **Better Auth** (email/password, nessuna registrazione pubblica)
- ExcelJS dietro un provider astratto
- **Vitest** (+ Vue Test Utils per i component test)
- ESLint, Prettier, `nuxt typecheck`
- Docker / Docker Compose / Kubernetes
- `@nuxtjs/i18n` — predisposto al multilingua, per ora solo `it`

È un singolo progetto full-stack Nuxt. L'unica eccezione è `worker/codex`,
richiesta dalla specifica per isolare la sessione Codex autenticata.

## Setup locale

Servono **Node ≥ 22.6**, **pnpm 10** e un PostgreSQL raggiungibile.

```bash
pnpm install
cp .env.example .env      # poi compila i valori
```

In `.env` il minimo indispensabile è:

- `DATABASE_URL` e `NUXT_DATABASE_URL` (stessa stringa: la prima la usa Drizzle
  Kit, la seconda l'applicazione);
- `NUXT_BETTER_AUTH_SECRET` — genera un valore casuale con `openssl rand -base64 48`.

### Database e migrazioni

Le migrazioni si gestiscono **solo** con Drizzle Kit. Non usare `ALTER TABLE` a
mano: dev, staging e produzione devono condividere la stessa storia di migrazioni.

```bash
pnpm db:generate    # genera una migrazione dopo aver cambiato lo schema Drizzle
pnpm db:migrate     # applica le migrazioni pendenti
pnpm db:studio      # ispeziona il database
pnpm db:seed        # crea il primo utente ADMIN (legge SEED_ADMIN_*)
```

I file generati in `server/database/migrations/` vanno committati insieme alla
feature che ha cambiato lo schema.

Non esiste registrazione pubblica: il primo account si crea con `pnpm db:seed` e
gli altri utenti li invita un ADMIN.

#### Attenzione: il giornale delle migrazioni non sta in `public`

Drizzle tiene il registro delle migrazioni applicate in uno schema **separato**,
chiamato `drizzle`. Un reset che cancella solo `public` lascia quindi il giornale
intatto, e la conseguenza è silenziosa:

```sql
DROP SCHEMA public CASCADE; CREATE SCHEMA public;   -- reset apparentemente completo
```

```bash
pnpm db:migrate     # stampa "migrations applied successfully!"
```

Drizzle legge il giornale, vede tutte le migrazioni già registrate, **non applica
niente e riporta successo**. Il database resta vuoto, l'applicazione parte e
fallisce alla prima query con un errore che non ha alcun rapporto con la causa.

Il reset corretto cancella **entrambi** gli schemi (o ricrea il database):

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

Un `db:migrate` che dichiara successo **non** garantisce che le tabelle esistano:
la verifica vera è contarle, e devono essere **14**.

```sql
select count(*) from information_schema.tables where table_schema = 'public';
```

Perché conta in produzione: un ripristino da backup del solo `public`, o un
restore parziale, lascia il giornale **avanti** rispetto allo schema reale, e le
migrazioni successive non vengono più applicate — in silenzio. È lo scenario in
cui il `Job` di migrazione Kubernetes riporterebbe successo mentre lo schema è
incompleto, quindi dopo un restore verificare il conteggio delle tabelle prima di
promuovere la nuova versione dell'app.

### Avvio

```bash
pnpm dev            # http://localhost:3000
```

## Comandi di verifica

```bash
pnpm lint           # ESLint
pnpm lint:fix
pnpm typecheck      # nuxt typecheck
pnpm test           # Vitest, tutti i progetti
pnpm test:watch
pnpm format         # Prettier, scrive
pnpm format:check   # Prettier, solo controllo
pnpm build          # build di produzione
pnpm verify         # lint + typecheck + test
```

Una feature non è completa se uno di questi controlli fallisce.

I test sono divisi in tre progetti Vitest: `tests/unit` (logica pura, nessun
database — è qui che sta la maggior parte del valore), `tests/integration`
(richiede PostgreSQL, si auto-salta se `DATABASE_URL` non è impostata) e
`tests/component` (componenti Vue).

## Provider AI

I consigli AI arrivano da tre **CLI di coding agent** installate sul server:
Claude Code, OpenCode e Codex. FantaBro le usa in modalità non interattiva e ne
legge solo la risposta testuale.

### Prerequisiti delle CLI

| Provider    | Eseguibile | Installazione                        | Login amministrativo        |
| ----------- | ---------- | ------------------------------------ | --------------------------- |
| Claude Code | `claude`   | `npm i -g @anthropic-ai/claude-code` | `claude auth login`         |
| OpenCode    | `opencode` | `npm i -g opencode-ai`               | `opencode providers login`  |
| Codex       | `codex`    | `npm i -g @openai/codex`             | `codex login --device-auth` |

Verifica dello stato, senza invocare alcun modello:

```bash
claude auth status --json     # {"loggedIn":true,...}
opencode providers list       # elenco delle credenziali registrate
codex login status            # "Logged in using ChatGPT"
```

Non è necessario installarle tutte: un provider assente compare semplicemente
come `NOT_INSTALLED` nella pagina _Impostazioni → AI_, e gli altri funzionano.

### Nessuna API key

FantaBro usa **le sessioni CLI già autenticate sul server**, cioè
l'abbonamento/login che l'amministratore ha configurato. Non serve nessuna API
key, e non esiste alcun fallback silenzioso alla fatturazione a consumo: se la
sessione manca, lo stato è `NOT_AUTHENTICATED` e l'errore è esplicito.

Questa garanzia non è una convenzione: l'environment dei processi AI è costruito
da zero a partire da una allowlist, e `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` non
ne fanno parte. Le CLI non le vedono nemmeno. Per lo stesso motivo non vedono
`DATABASE_URL` né i segreti dell'applicazione.

### Perché il login è lato server

Gli utenti di FantaBro e l'identità AI sono due cose diverse. Ogni utente accede
a FantaBro con le proprie credenziali; l'AI usa **una identità per provider,
configurata sul server** e condivisa dall'applicazione. Nessun utente di FantaBro
deve fare un login AI.

### Dove vivono le credenziali e cosa sopravvive a un riavvio

I file di autenticazione dei provider non sono mai nel repository, mai in un
layer Docker, mai in una risposta HTTP, mai in un log. Vivono solo su volumi
persistenti:

| Provider    | Posizione                                       | In Docker Compose                                |
| ----------- | ----------------------------------------------- | ------------------------------------------------ |
| Claude Code | `~/.claude`                                     | volume `ai-claude`                               |
| OpenCode    | `~/.local/share/opencode`, `~/.config/opencode` | volumi `ai-opencode-data` / `ai-opencode-config` |
| Codex       | `$CODEX_HOME` (default `/var/lib/codex`)        | volume `ai-codex` sul codex-worker               |

Finché il volume esiste, il login sopravvive a riavvio del container,
ricostruzione dell'immagine e aggiornamento dell'applicazione. Se il volume viene
cancellato, l'amministratore deve rifare il login.

### Perché il worker Codex è uno solo

Su Kubernetes Codex **non** gira dentro ogni replica di FantaBro. Vive in un
servizio interno dedicato, `codex-worker`, con **una sola replica** e `CODEX_HOME`
su PersistentVolume.

Il motivo è concreto: lo stato di autenticazione è un file scrivibile. Montarlo
in più pod significa corromperlo. Con un worker solo c'è un unico proprietario
del file, e le repliche di FantaBro restano stateless e scalabili. Il worker
espone un Service ClusterIP senza Ingress: parla solo con FantaBro, e una
NetworkPolicy lo impone.

Per la stessa ragione le invocazioni sono serializzate: coda FIFO con
concorrenza 1 per provider. Se troppe richieste si accumulano, la risposta è
`PROVIDER_BUSY` invece di un errore confuso.

In sviluppo il worker non serve: se `NUXT_AI_CODEX_WORKER_URL` è vuota,
`CodexProvider` esegue `codex` in locale.

```bash
# Avvio del worker in locale (richiede la risoluzione dell'alias #shared).
pnpm exec tsx --tsconfig tsconfig.tools.json worker/codex/server.ts
# poi:
curl -s http://127.0.0.1:8787/status
```

### Cosa l'AI non può fare

Le CLI AI sono coding agent, e FantaBro non ha bisogno delle loro capacità di
tool o filesystem. Quindi:

- esecuzione solo lato server, con array di argomenti e mai interpolazione di
  shell; il prompt viaggia su stdin, non in `argv`;
- working directory una cartella temporanea **vuota**: nessun accesso al codice
  del progetto;
- strumenti disattivati, permessi minimi, sessioni non persistite;
- timeout su ogni invocazione, concorrenza controllata, nessuna perdita di
  contesto fra richieste;
- nessuna credenziale di database nel contesto;
- l'AI **non** scrive su PostgreSQL e **non** modifica lo stato d'asta: risponde
  solo testo/JSON. Ogni cambiamento di stato passa dai normali servizi
  applicativi e dai loro controlli di autorizzazione.

## Deploy con Docker

`docker-compose.yml` avvia PostgreSQL, le migrazioni, l'app e il codex-worker.

```bash
cp .env.example .env      # compila almeno BETTER_AUTH_SECRET e POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec app node -e "1"   # sanity check
```

Le migrazioni girano in un servizio dedicato (`migrate`) che deve terminare con
successo prima che l'app parta: niente migrazioni implicite a runtime con più
repliche in corsa.

### Provider AI in Docker

L'immagine dell'app **non** contiene le CLI AI, per tenerla leggera e stateless.
In Compose l'unico provider disponibile è quindi Codex, tramite il worker
(`NUXT_AI_CODEX_WORKER_URL=http://codex-worker:8787`).

Il primo login Codex si fa una volta sola contro il container in esecuzione:

```bash
docker compose exec codex-worker sh -c 'cat > "$CODEX_HOME/config.toml" <<EOF
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
EOF'
docker compose exec codex-worker codex login --device-auth
docker compose exec codex-worker codex login status
```

Per usare anche Claude Code e OpenCode serve un'immagine derivata che le
installi; i volumi per la loro configurazione persistente sono già dichiarati nel
compose.

### Limitazione nota: nessun proxy davanti all'app

In Compose l'app pubblica la propria porta **direttamente**, senza reverse proxy.
Manca quindi il limite duro sulla dimensione del body che su Kubernetes applica
l'Ingress: la difesa resta solo quella applicativa (la route di import rifiuta
oltre 15 MB e rifiuta i body che non dichiarano `content-length`). Per una
installazione esposta su Internet, mettere davanti un reverse proxy con il
proprio limite di body — vedi la sezione sui limiti di upload qui sotto.

## Deploy su Kubernetes

I manifest sono in [`k8s/`](k8s/), con il proprio
[README](k8s/README.md): ordine di deploy, Job delle migrazioni, procedura di
login iniziale di Codex e configurazione consigliata della CLI.

In sintesi: FantaBro è un `Deployment` stateless scalabile dietro Ingress; il
codex-worker è uno `StatefulSet` a una replica con PVC, Service ClusterIP e
nessun Ingress; le migrazioni sono un `Job` da completare prima di aggiornare
l'app.

Dopo un ripristino da backup, verificare il conteggio delle tabelle **prima** di
promuovere la nuova versione: un giornale delle migrazioni disallineato fa
riportare successo al `Job` con lo schema incompleto (vedi
[Database e migrazioni](#database-e-migrazioni)).

## Limite di upload

L'import del listone è un upload di file Excel. Il limite è **15 MB**, applicato
in **due punti** con ruoli diversi:

| Dove                          | Valore | Ruolo                                                                  |
| ----------------------------- | ------ | ---------------------------------------------------------------------- |
| Ingress (`k8s/app.yaml`)      | `16m`  | Limite **duro**: rifiuta la richiesta prima che tocchi l'app           |
| Route di import (applicativo) | 15 MB  | Errore di dominio con codice stabile, e rifiuto senza `content-length` |

I 16 MB dell'Ingress sono volutamente **sopra** i 15 MB applicativi: il body
multipart è più grande del file per via di boundary e header di parte, quindi un
limite esterno pari a 15 MB rifiuterebbe con un 413 opaco un file da 15 MB
valido, prima che l'app possa restituire il proprio errore.

Il limite esterno non è una ridondanza: **Nitro non offre alcuna opzione di
dimensione massima del body**, e `readMultipartFormData` bufferizza il file
interamente in memoria prima che il codice applicativo possa guardarlo. Senza un
proxy davanti, l'unico limite è la memoria del pod.

## Variabili d'ambiente

Elenco completo con commenti in [`.env.example`](.env.example).

| Variabile                  | Default                 | A cosa serve                                                              |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`             | —                       | Connessione usata da Drizzle Kit e dagli script                           |
| `NUXT_DATABASE_URL`        | —                       | Stessa connessione, letta dall'applicazione                               |
| `NUXT_BETTER_AUTH_SECRET`  | —                       | Segreto di firma delle sessioni (obbligatorio)                            |
| `NUXT_BETTER_AUTH_URL`     | `http://localhost:3000` | URL pubblica dell'app                                                     |
| `SEED_ADMIN_EMAIL`         | —                       | Email del primo ADMIN creato da `pnpm db:seed`                            |
| `SEED_ADMIN_PASSWORD`      | —                       | Password del primo ADMIN                                                  |
| `SEED_ADMIN_NAME`          | `Admin`                 | Nome del primo ADMIN                                                      |
| `NUXT_AI_DEFAULT_PROVIDER` | `claude-code`           | Provider preselezionato: `claude-code`, `opencode` o `codex`              |
| `NUXT_AI_TIMEOUT_MS`       | `120000`                | Timeout per invocazione AI, attesa in coda inclusa                        |
| `NUXT_AI_MAX_PENDING`      | `8`                     | Richieste in attesa per provider; oltre il limite → `PROVIDER_BUSY`       |
| `NUXT_AI_CLAUDE_BIN`       | `claude`                | Eseguibile di Claude Code                                                 |
| `NUXT_AI_OPENCODE_BIN`     | `opencode`              | Eseguibile di OpenCode                                                    |
| `NUXT_AI_CODEX_BIN`        | `codex`                 | Eseguibile di Codex (modalità locale)                                     |
| `NUXT_AI_CODEX_WORKER_URL` | vuota                   | Se valorizzata, Codex passa dal worker interno invece di girare in locale |
| `CODEX_HOME`               | `/var/lib/codex`        | Directory dell'autenticazione Codex persistente                           |
| `CODEX_BIN`                | `codex`                 | Eseguibile di Codex usato dal worker                                      |
| `CODEX_WORKER_HOST`        | `0.0.0.0`               | Bind del worker                                                           |
| `CODEX_WORKER_PORT`        | `8787`                  | Porta del worker                                                          |
| `CODEX_WORKER_TIMEOUT_MS`  | `120000`                | Timeout per invocazione nel worker                                        |
| `CODEX_WORKER_MAX_PENDING` | `8`                     | Coda interna del worker (concorrenza fissa a 1)                           |

Solo per Docker Compose: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`APP_PORT`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.

### Nota per lo sviluppo su Windows

`codex` e `opencode` installati via npm sono shim `.cmd`, e Node si rifiuta di
eseguirli senza shell — che FantaBro non usa, per scelta di sicurezza. In
sviluppo su Windows quei due provider risultano quindi `NOT_INSTALLED`: usa il
codex-worker (anche in Docker), WSL, o sviluppa la parte AI con Claude Code, che
è un eseguibile nativo e funziona.

## Documentazione

- [`docs/SPEC.md`](docs/SPEC.md) — specifica completa, fonte di verità
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — confini, flussi e decisioni non ovvie
- [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md) — cosa è stato implementato, feature per feature
- [`k8s/README.md`](k8s/README.md) — deploy Kubernetes
- [`AGENTS.md`](AGENTS.md) — istruzioni per i coding agent

## Per i coding agent

Il repository usa [`AGENTS.md`](AGENTS.md) come file di istruzioni **canonico e
obbligatorio** per qualunque coding agent (Claude Code, Codex, OpenCode o altri).
Leggilo prima di iniziare a implementare.

**Non creare `CLAUDE.md`.** La regola vale anche quando lo sviluppo avviene con
Claude Code: il repository resta agent-neutral, così le stesse istruzioni valgono
per tutti gli agent. Se un agent propone di creare `CLAUDE.md`, non farlo — le
istruzioni di progetto vanno in `AGENTS.md`.
