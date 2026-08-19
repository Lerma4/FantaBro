# AGENTS.md

File di istruzioni **canonico e obbligatorio** per qualunque coding agent che lavori su FantaBro
(Claude Code, Codex, OpenCode o altri). Leggilo **prima** di iniziare a implementare.

> Non creare `CLAUDE.md`. Il repository resta agent-neutral: tutte le istruzioni di progetto
> vivono qui, anche quando lo sviluppo avviene con Claude Code.

## Cosa è FantaBro

Assistente personale per l'asta del Fantacalcio, self-hosted. **Non** è una piattaforma di gestione
lega. Serve a supportare la propria squadra durante un'asta dal vivo: listone aggiornato, quotazioni,
FVM, statistiche stagione precedente, ricerca rapida, rosa, budget, slot, giocatori venduti ad altri,
target/tier/prezzi massimi, analytics di mercato, consigli AI.

Il requisito di prodotto più importante: **l'app deve restare veloce e affidabile durante un'asta reale**.

La specifica completa è in [`docs/SPEC.md`](docs/SPEC.md) ed è la fonte di verità.

## Stack

- Nuxt 4 + Vue 3 + TypeScript strict + Nuxt UI 4 (Tailwind v4)
- Nitro server routes, Pinia solo dove serve stato condiviso lato client
- Zod per la validazione a runtime
- PostgreSQL + Drizzle ORM, migrazioni con **Drizzle Kit**
- Better Auth (email/password, nessuna registrazione pubblica)
- ExcelJS dietro un provider astratto
- Vitest (+ Vue Test Utils per i component test)
- ESLint, Prettier, `nuxt typecheck`
- Docker / Docker Compose / Kubernetes
- `@nuxtjs/i18n` — **predisposto al multilingua, per ora solo `it`**

Resta un **singolo progetto full-stack Nuxt**. L'unica eccezione è `worker/codex`, richiesta dalla
specifica per isolare la sessione Codex autenticata.

## Struttura

```text
app/            Vue: components, composables, pages, stores, layouts, middleware
server/
  api/          route Nitro
  database/     schema Drizzle + migrations generate da Drizzle Kit
  services/     orchestrazione transazionale (usa domain + repositories)
  repositories/ accesso dati
  domain/       logica pura, senza I/O, interamente testabile
  providers/    players/ statistics/ ai/  (confini di integrazione)
shared/         types, schemas (zod), constants — condivisi client/server/worker
worker/codex/   worker HTTP interno per Codex
tests/          unit/ integration/ component/
i18n/locales/   file di traduzione
k8s/            manifest Kubernetes
docs/           SPEC.md, DEVELOPMENT_LOG.md, ADR
```

## Regole di implementazione

1. Segui architettura e convenzioni esistenti; non introdurre pattern nuovi senza leggere prima
   quello che c'è.
2. La logica di business **non** vive nei componenti Vue: sta in `server/domain` (pura) e
   `server/services` (transazionale).
3. Lo stato derivato (budget, slot, max offerta) si **ricalcola** dagli acquisti, non si duplica in
   colonne mutabili.
4. Usa le interfacce solo sui confini reali di integrazione: repositories, provider giocatori,
   provider statistiche, provider AI. Niente astrazioni speculative.
5. Ogni operazione che cambia stato d'asta è **transazionale** e regge la concorrenza fra utenti.
6. Errori: il server restituisce **codici stabili** da `shared/constants/errors.ts`, il client li
   traduce con `t('errors.<CODE>')`. Mai stringhe utente hardcoded nel server.
7. Ogni testo mostrato all'utente passa da i18n (`i18n/locales/it.json`). Niente stringhe italiane
   dentro i componenti.
8. Non committare mai credenziali. I file di auth dei provider AI (`auth.json`, credenziali Claude,
   config OpenCode) stanno solo su volumi persistenti, mai in Git, mai nei log, mai in una risposta HTTP.
9. Migrazioni **solo** con Drizzle Kit (`pnpm db:generate`); i file generati vanno committati insieme
   alla feature che ha cambiato lo schema.
10. Nessun requisito di `docs/SPEC.md` va ignorato in silenzio.

## Quality gate obbligatorio dopo OGNI feature

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm build     # quando la feature lo richiede o prima di una release
```

Una feature **non** è completa se un controllo fallisce. Non disabilitare regole, test o type check
per far passare la verifica. `eslint-disable`, `@ts-ignore`, `@ts-nocheck` solo se strettamente
necessari, con scope minimo e un commento che spiega perché.

Dopo ogni feature completata aggiorna [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md).
Non scrivere PASS per un comando che non hai eseguito davvero.

## Test

Le regole di business critiche devono avere test automatici: budget, budget residuo, slot per ruolo,
massima offerta corrente, acquisto valido, acquisto oltre budget, acquisto senza slot, acquisto di
giocatore non disponibile, annullo acquisto, marcatura SOLD, annullo SOLD, parsing Excel, Excel non
valido, analytics d'asta, costruzione del contesto AI, fallimenti dei provider AI.

- `tests/unit` — logica pura, nessun database. È qui che sta la maggior parte del valore.
- `tests/integration` — repository su PostgreSQL reale, incluse le garanzie di concorrenza; si
  auto-salta se `DATABASE_URL` non è impostata (`pnpm test:integration`).
- `tests/component` — componenti Vue con `@nuxt/test-utils`.
- `tests/e2e` — server Nitro **buildato** + PostgreSQL reale (`pnpm test:e2e`).

### Perché `tests/e2e` esiste, e va tenuto verde

Vitest risolve i moduli CommonJS in modo più permissivo del runtime reale. Un
`import { Workbook } from 'exceljs'` passa tutti i test unitari e poi **fallisce nel server
buildato**, dove Node rifiuta l'export nominato: le tre route di import rispondevano 500 in
produzione con 291 test unitari verdi e `pnpm build` che riusciva senza lamentarsi.

Quindi: un test verde su un confine con una libreria esterna **non** dimostra che quel confine
funzioni in produzione, e nemmeno un build riuscito lo dimostra — il build compila, non esegue.
Per una dipendenza CommonJS usa l'import di default e destruttura (`import Pkg from 'x'; const
{ Thing } = Pkg`), a meno che il pacchetto dichiari un wrapper ESM in `exports.import`.

Ogni bug trovato durante lo sviluppo riceve un test di regressione quando è ragionevolmente possibile.

## Sicurezza AI

I provider AI sono CLI di coding agent. FantaBro non ha bisogno delle loro capacità di tool/filesystem.

- esecuzione solo server-side, con array di argomenti (mai interpolazione di shell);
- timeout su ogni invocazione, concorrenza controllata, nessuna perdita di contesto fra richieste;
- nessun accesso al filesystem di progetto, nessun comando shell da prompt utente, nessuna
  credenziale di database nel contesto;
- l'AI **non** scrive su PostgreSQL e **non** modifica lo stato d'asta: risponde solo testo/JSON;
- autenticazione tramite le sessioni CLI già presenti sul server. Nessun fallback silenzioso su
  API key a consumo: se la sessione manca, lo stato è `NOT_AUTHENTICATED`.

## Comandi utili

```bash
pnpm dev            # sviluppo
pnpm db:generate    # genera una migrazione dopo aver cambiato lo schema
pnpm db:migrate     # applica le migrazioni pendenti
pnpm db:seed        # crea il primo utente ADMIN
pnpm worker:codex   # avvia il worker Codex in locale
pnpm verify         # lint + typecheck + test
```
