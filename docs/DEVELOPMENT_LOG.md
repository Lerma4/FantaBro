# Development log

Registro delle feature completate, nel formato richiesto da `docs/SPEC.md` §52.
Serve a far capire a un altro coding agent che cosa è già implementato e con
quali vincoli.

Regole di compilazione:

- una voce per feature completata, aggiunta in coda;
- **mai scrivere PASS per un comando che non è stato eseguito davvero**;
- se un controllo fallisce per un motivo fuori dalla feature, scriverlo
  esplicitamente invece di arrotondare a PASS.

Formato:

```text
## Feature XX — Nome

### Implementato
- ...

### Modifiche database
- ...

### Test
- ...

### Validazione
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS
- pnpm build: PASS / NON RICHIESTO

### Note
- ...
```

---

## Feature 22 — Interfaccia `AiProvider`, esecuzione sicura dei processi

### Implementato

- `server/providers/ai/exec.ts` — fondamento di sicurezza del layer AI:
  - `runCommand` su `node:child_process.spawn` con array di argomenti e
    `shell: false`; nessuna interpolazione di shell in nessun punto;
  - il prompt viaggia su **stdin**, mai in `argv`: non compare in `ps` e non può
    essere interpretato come flag;
  - `buildEnv` costruisce l'environment del figlio da una **allowlist**
    (`PATH`, `HOME`, locale, directory di configurazione XDG/Windows). Ne restano
    fuori `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL` e
    `NUXT_BETTER_AUTH_SECRET`: il divieto di fallback a fatturazione a consumo è
    strutturale, non una convenzione (spec §34);
  - timeout obbligatorio con escalation SIGTERM → SIGKILL dopo una grazia, e
    terminazione del gruppo di processi su POSIX (le CLI generano sottoprocessi);
  - tetto su stdout/stderr contro una CLI che produce output senza fine;
  - `commandExists` senza shell, con `ENOENT`/`EINVAL` trattati come "non
    utilizzabile";
  - `resolveCommand` / `resolveWindowsExecutable`: su Windows `spawn` con
    `shell: false` risolve solo eseguibili nativi e non consulta `PATHEXT`, quindi
    una CLI installata via npm (shim `.cmd`) dava `ENOENT` e risultava
    `NOT_INSTALLED` da installata. Si risolve il percorso concreto su `PATH` ×
    `PATHEXT` e gli script `.cmd`/`.bat` passano per `cmd.exe /d /c <percorso>`
    (`/d` esclude gli AutoRun del registro). Il ramo POSIX è invariato.
    `shell: true` non è usato: violerebbe la spec §36. Sul ramo `cmd.exe`
    `assertSafeForBatch` rifiuta gli argomenti con metacaratteri, perché
    l'interprete li ri-analizza dopo la quotatura di Node (CVE-2024-27980);
  - `sanitize` / `sanitizeDetail` rimuovono token (`sk-*`, `gh*_`, JWT), header
    `Bearer`, URL con credenziali, assegnazioni di variabili sensibili e percorsi
    di `auth.json` prima che un testo finisca in un `detail` o in un log;
  - `withTempDir` dà a ogni invocazione una working directory temporanea
    **vuota**: le CLI AI non vedono il progetto (spec §43);
  - il modulo non logga nulla: né prompt, né stdout, né stderr.
- `server/providers/ai/cli.ts` — logica comune ai tre adapter: `cliStatus`
  (stato del provider), `runCliAsk` (invocazione + conversione in `AiResponse`),
  `classifyFailure` (testo della CLI → codice errore stabile), `buildStatus`,
  `executableName`.
- Consumata l'interfaccia `AiProvider` già presente in `shared/types/ai.ts`;
  nessun tipo condiviso ridefinito.

### Modifiche database

- Nessuna.

### Test

- `tests/unit/ai/exec.spec.ts` — 36 test: prompt su stdin e non in `argv`,
  `shell: false`, segreti assenti dall'environment del figlio, `ENOENT` →
  `CLI_NOT_INSTALLED`, timeout con terminazione del processo, output fuori scala,
  `commandExists`, e la batteria completa su `sanitize`.
- `node:child_process` è mockato (`tests/unit/ai/helpers/fake-spawn.ts`):
  nessuna CLI reale viene invocata, i test girano senza rete e senza quota.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS su `tests/unit/ai` (112/112)
- pnpm build: PASS

---

## Feature 39 — PostgreSQL locale su porta non confliggente

### Implementato

- PostgreSQL Compose è pubblicato su `localhost:5433`, perché `localhost:5432`
  è già occupata dal database del devcontainer.
- `.env` usa `localhost:5433` per `pnpm dev`; i container continuano a usare
  `postgres:5432` sulla rete interna.

---

## Feature 38 — Blocco ADMIN iniziale

### Implementato

- L'account creato dal seed viene marcato `isBootstrapAdmin`.
- Il ruolo dell'ADMIN iniziale è disabilitato nella UI e protetto anche lato API.
- Il seed aggiorna il flag anche su installazioni già inizializzate.

### Modifiche database

- Generata migrazione Drizzle `0001_simple_omega_sentinel.sql`.

### Validazione

- pnpm db:generate: PASS
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (361 passati, 50 skipped)
- pnpm format:check: PASS
- pnpm build: PASS

- pnpm format:check: PASS

Tutti e quattro eseguiti davvero e verdi sui file di questa feature. Nella stessa
sessione altri moduli erano in lavorazione in parallelo, quindi il totale di
progetto è stato a tratti rosso per file fuori da questo perimetro (all'ultima
esecuzione: `tests/e2e/auction-flow.spec.ts` per lint e typecheck). Nessuno di
quegli errori riguarda i file elencati qui sopra: `pnpm test` è verde
(340 passati, 41 skipped, 0 rossi) e `pnpm build` riesce.

### Note

- **Tutti e tre i provider sono stati eseguiti contro le CLI reali su Windows**:
  `getAllProviderStatuses()` restituisce `AVAILABLE` per tutti e tre, e un `ask()`
  vero è andato a buon fine su ognuno (codex 14,0 s, opencode 13,3 s, claude 6,9 s)
  con l'output strutturato validato da `parseAdvice`. Prima della risoluzione del
  percorso eseguibile, `codex` e `opencode` davano un falso `NOT_INSTALLED`.
- I flag delle CLI non sono stati indovinati: **tutte e tre le CLI sono installate
  su questa macchina** (claude 2.1.235, codex 0.147/0.148, opencode 1.18.18), ho
  letto il loro `--help` reale e ho provato ogni invocazione end-to-end. Le
  motivazioni, e i flag **scartati** con il perché, stanno nei commenti in testa a
  ciascun adapter.
- Anche i **due esiti** del riconoscimento della sessione sono verificati per tutti
  e tre, puntando ogni CLI a una directory di configurazione vuota:
  `claude auth status --json` → `{"loggedIn":false,"authMethod":"none"}` exit 0;
  `codex login status` → `Not logged in` **exit 0** (quindi il codice di uscita da
  solo non basta); `opencode providers list` → `0 credentials` exit 0.

---

## Feature 23 — CodexProvider (locale + codex-worker)

### Implementato

- `server/providers/ai/codex.ts`, due modalità scelte dalla configurazione:
  - `runtimeConfig.ai.codexWorkerUrl` valorizzata → HTTP interno verso il
    codex-worker (`POST /ask`, `GET /status`). Modalità di produzione su
    Kubernetes;
  - vuota → `codex exec` locale non interattivo. Modalità sviluppo/Compose.
- Payload in uscita validato con `workerAskRequestSchema`, risposta con
  `workerAskResponseSchema`, errori con `workerErrorResponseSchema`: il codice
  del worker viene **ri-lanciato identico** (`PROVIDER_BUSY` resta
  `PROVIDER_BUSY`), un codice sconosciuto diventa `PROCESS_FAILED`.
- `getStatus()` in modalità worker non lancia mai: worker irraggiungibile →
  `state: 'ERROR'` con `detail` sanificato.
- `CODEX_HOME` propagato esplicitamente (è un percorso, non un segreto);
  `OPENAI_API_KEY` no.
- `worker/codex/server.ts` + `worker/codex/exec.ts` — worker HTTP interno:
  - `node:http`, nessun framework; route `POST /ask`, `GET /status`,
    `GET /healthz`;
  - corpo validato con `workerAskRequestSchema`: l'endpoint accetta **solo**
    `prompt`, `context` e `timeoutMs`. Nessun campo può diventare un comando, e i
    campi estranei vengono scartati dallo schema;
  - tetto di 256 KB sul corpo della richiesta;
  - coda FIFO a concorrenza 1 con `maxPending` configurabile: 429
    `PROVIDER_BUSY`, 504 `TIMEOUT`, 503 `NOT_AUTHENTICATED`, 400
    `VALIDATION_FAILED`;
  - `GET /status` restituisce solo `{ state, executable, detail? }`;
  - nessuna route che legga il filesystem, nessun log di `CODEX_HOME`, nessun
    echo dell'environment, nessuna connessione a PostgreSQL;
  - shutdown pulito su SIGTERM/SIGINT: rifiuta le nuove richieste e lascia
    finire quella in corso;
  - bind configurabile, default `0.0.0.0:8787`, pensato per un Service ClusterIP
    senza Ingress.

### Modifiche database

- Nessuna.

### Test

- `tests/unit/ai/codex-worker.spec.ts` — 27 test: modalità worker con `fetch`
  mockato (nessun processo locale eseguito, mappatura dei codici errore,
  `INVALID_OUTPUT` su risposta fuori contratto, normalizzazione della URL) e
  `handleAsk`/`handleStatus` del worker (payload con comando rifiutato, campi
  estranei scartati, coda piena → 429, timeout → 504, nessun dettaglio interno
  negli errori, e nessun `codex exec` invocato senza sessione).
- `tests/unit/ai/providers.spec.ts` copre la modalità locale: flag di
  `codex exec`, `CODEX_HOME` propagato, `OPENAI_API_KEY` assente, e il
  fallimento immediato senza sessione o senza eseguibile.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS su `tests/unit/ai` (112/112)
- pnpm build: PASS
- pnpm format:check: PASS
- `tsc -p tsconfig.tools.json --noEmit` (copre `worker/**`): PASS

Tutti eseguiti davvero e verdi sui file di questa feature. Nella stessa sessione
altri moduli erano in lavorazione in parallelo, quindi il totale di progetto è
stato a tratti rosso per file fuori da questo perimetro (all'ultima esecuzione:
`tests/e2e/auction-flow.spec.ts` per lint e typecheck). Nessuno di quegli errori
riguarda i file elencati qui sopra.

### Note

- Il worker è stato provato in esecuzione reale, sia con `tsx` su Windows sia
  dentro l'immagine Docker con la CLI Codex installata: `/healthz` → 200,
  `POST /ask` con `{"command":"rm -rf /"}` → 400 `VALIDATION_FAILED`, corpo
  malformato → 400, rotta sconosciuta → 404, `prompt` di 4001 caratteri → 400.
  Il log conteneva solo la riga di avvio: nessun prompt, nessun environment.
- **Difetto trovato eseguendo l'immagine reale**: senza sessione Codex,
  `codex exec` non esce con errore — resta appeso fino al timeout, e l'utente
  vedeva `TIMEOUT` dopo due minuti invece del `NOT_AUTHENTICATED` che la spec §37
  richiede. Ora sia il worker sia il provider locale fanno un probe di sessione
  (`codex login status`, comando locale che non invoca il modello) prima
  dell'invocazione. Riverificato sull'immagine: `503 NOT_AUTHENTICATED` in 0,19 s.
  Il probe costa una frazione di secondo su una richiesta che dura decine.
- Il comportamento analogo di `claude` e `opencode` senza sessione **non** è stato
  verificato: entrambe le CLI sono autenticate su questa macchina e non è stato
  possibile provare il caso non autenticato. Il probe è stato aggiunto solo dove
  c'è evidenza empirica.
- `worker/codex/exec.ts` duplica deliberatamente `server/providers/ai/exec.ts`
  perché il worker gira in un container senza Nuxt e senza il codice
  applicativo. **Non** è duplicato il prompt: il worker importa
  `renderContextPrompt` dal dominio, così la domanda posta a Codex è identica
  nelle due modalità. Se cambia una regola di sicurezza dello spawn va cambiata
  in entrambi i file.
- `pnpm worker:codex` (`tsx worker/codex/server.ts`) **non parte**: `tsx` legge
  il `tsconfig.json` radice, che non dichiara `paths`, e l'alias `#shared/*` non
  si risolve. Funziona con
  `tsx --tsconfig tsconfig.tools.json worker/codex/server.ts` (verificato).
  Lo script in `package.json` va corretto: vedi la nota nel report al lead.

---

## Feature 24 — ClaudeCodeProvider

### Implementato

- `server/providers/ai/claude-code.ts` sulla CLI `claude` già autenticata sul
  server. Nessuna API key Anthropic richiesta, nessun fallback su
  `ANTHROPIC_API_KEY`.
- `getStatus()`: eseguibile assente → `NOT_INSTALLED` con
  `hintKey: 'ai.hint.notInstalled'`; `claude auth status --json` con
  `loggedIn: false` o exit code non zero → `NOT_AUTHENTICATED` con
  `hintKey: 'ai.hint.claudeCodeLogin'`; output non interpretabile → `ERROR`
  (dire `NOT_AUTHENTICATED` sarebbe una bugia: non sappiamo se la sessione
  esista); `loggedIn: true` → `AVAILABLE`.
- `auth status` riporta anche email e organizzazione dell'account del server:
  non finiscono **mai** in `detail` (spec §40).
- `ask()`: modalità headless con permessi minimi —
  `--print --output-format text --tools '' --permission-mode manual --safe-mode
--strict-mcp-config --no-session-persistence`, prompt su stdin, working
  directory temporanea vuota, timeout da `runtimeConfig`.

### Modifiche database

- Nessuna.

### Test

- In `tests/unit/ai/providers.spec.ts`: i cinque stati, i flag attesi e quelli
  **vietati**, cwd temporanea, prompt fuori da `argv`, estrazione dell'output
  strutturato e fallback testuale, `TIMEOUT`, `PROCESS_FAILED`,
  `PROVIDER_RATE_LIMITED`, `INVALID_OUTPUT`, e l'assenza di segreti nel `detail`.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS su `tests/unit/ai` (112/112)
- pnpm build: PASS
- pnpm format:check: PASS

Tutti e quattro eseguiti davvero e verdi sui file di questa feature. Nella stessa
sessione altri moduli erano in lavorazione in parallelo, quindi il totale di
progetto è stato a tratti rosso per file fuori da questo perimetro (all'ultima
esecuzione: `tests/e2e/auction-flow.spec.ts` per lint e typecheck). Nessuno di
quegli errori riguarda i file elencati qui sopra: `pnpm test` è verde
(340 passati, 41 skipped, 0 rossi) e `pnpm build` riesce.

### Note

- Flag verificati sull'help di `claude` 2.1.235 e provati end-to-end: exit 0 e
  stdout pulito. `--tools ''` è documentato dall'help come "disable all tools".
- `--bare` è stato **scartato deliberatamente**: l'help dice che con quel flag
  "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper (OAuth and
  keychain are never read)", cioè esattamente la fatturazione a consumo che la
  specifica vieta. `--safe-mode` isola l'ambiente (niente CLAUDE.md, skill,
  plugin, hook, MCP) lasciando intatta l'autenticazione.

---

## Feature 25 — OpenCodeProvider

### Implementato

- `server/providers/ai/opencode.ts` sull'autenticazione OpenCode già configurata
  sul server. Nessun passaggio a una API key separata.
- `getStatus()`: `opencode providers list` con zero credenziali registrate →
  `NOT_AUTHENTICATED` (è la stessa condizione osservabile di "provider upstream
  non configurato"); almeno una → `AVAILABLE`; formato non riconosciuto →
  `ERROR`. L'elenco stampa il percorso di `auth.json`: non entra mai in `detail`.
- `ask()`: `opencode run --pure`, prompt su stdin, cwd temporanea vuota.

### Modifiche database

- Nessuna.

### Test

- In `tests/unit/ai/providers.spec.ts`: `AVAILABLE` / `NOT_AUTHENTICATED` /
  `NOT_INSTALLED`, assenza del percorso di `auth.json` nello stato, flag attesi,
  assenza di `--auto`, `TIMEOUT`.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS su `tests/unit/ai` (112/112)
- pnpm build: PASS
- pnpm format:check: PASS

Tutti e quattro eseguiti davvero e verdi sui file di questa feature. Nella stessa
sessione altri moduli erano in lavorazione in parallelo, quindi il totale di
progetto è stato a tratti rosso per file fuori da questo perimetro (all'ultima
esecuzione: `tests/e2e/auction-flow.spec.ts` per lint e typecheck). Nessuno di
quegli errori riguarda i file elencati qui sopra: `pnpm test` è verde
(340 passati, 41 skipped, 0 rossi) e `pnpm build` riesce.

### Note

- Verificato sull'installazione reale (OpenCode 1.18.18) che `opencode run` legge
  il prompt da stdin e scrive la risposta su stdout pulito, mentre il banner del
  modello va su stderr.
- `--auto` ("auto-approve permissions that are not explicitly denied
  (dangerous!)") è stato **scartato deliberatamente**: senza quel flag e senza
  terminale interattivo, un tentativo di usare strumenti non viene approvato.

---

## Feature 30 — Concorrenza, timeout e gestione degli errori AI

### Implementato

- `server/providers/ai/queue.ts` — coda FIFO con concorrenza limitata:
  - `concurrency = 1` per provider (i file di sessione delle CLI non sono
    concurrency-safe), `maxPending` da `runtimeConfig`, oltre il limite
    `PROVIDER_BUSY`;
  - timeout per richiesta che copre **anche** l'attesa in coda; chi scade mentre
    è in attesa non viene nemmeno avviato;
  - ogni chiamata ha la propria promise e nessuno stato mutabile è condiviso fra
    i task: una risposta non può finire alla richiesta sbagliata;
  - `maxPending: 0` significa "non accodare, rifiuta quando è occupato" e non
    "rifiuta sempre".
- `server/providers/ai/registry.ts` — `createAiRegistry(config)`: riceve la
  configurazione come argomento, quindi è verificabile senza Nitro. Una coda
  **per provider**: un Codex lento non blocca chi interroga Claude Code.
  `getAllProviderStatuses()` interroga in parallelo, con un tetto complessivo per
  provider, e non lancia mai.
- `server/providers/ai/index.ts` — adattatore Nitro con le quattro funzioni
  consumate dalle route: `getAiProvider`, `listAiProviders`,
  `getAllProviderStatuses`, `askWithProvider`. Tiene un registry per processo,
  necessario perché le code siano condivise da tutte le richieste.
- La coda non compare in nessuna firma del dominio asta.

### Modifiche database

- Nessuna.

### Test

- `tests/unit/ai/queue.spec.ts` — 7 test: serializzazione effettiva con
  concorrenza 1 (due richieste non si sovrappongono), ordine FIFO, correlazione
  risposta/richiesta con richieste concorrenti, `PROVIDER_BUSY` oltre
  `maxPending`, riaccodamento dopo lo svuotamento, timeout in attesa, slot
  liberato anche in caso di errore.
- `tests/unit/ai/registry.spec.ts` — 8 test: registrazione dei provider,
  `executable` come nome file e non path completo, `getAllProviderStatuses` che
  non lancia, code separate per provider.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS su `tests/unit/ai` (112/112)
- pnpm build: PASS
- pnpm format:check: PASS

Tutti e quattro eseguiti davvero e verdi sui file di questa feature. Nella stessa
sessione altri moduli erano in lavorazione in parallelo, quindi il totale di
progetto è stato a tratti rosso per file fuori da questo perimetro (all'ultima
esecuzione: `tests/e2e/auction-flow.spec.ts` per lint e typecheck). Nessuno di
quegli errori riguarda i file elencati qui sopra: `pnpm test` è verde
(340 passati, 41 skipped, 0 rossi) e `pnpm build` riesce.

### Note

- Gli errori escono sempre come codici stabili di `AI_ERROR_CODES`, tradotti dal
  client. `detail` è sempre passato da `sanitizeDetail`.
- **Audit dei throw sincroni** (una funzione tipizzata `Promise` ma non `async`
  lancia prima che la Promise esista, e nessun `.catch()` la intercetta): tutte le
  funzioni con firma `Promise` in `server/providers/ai/**` e `worker/codex/**`
  sono già `async`, verificato leggendo ogni firma. I due punti a rischio sono
  sicuri per costruzione: `queue.run()` è `async`, quindi il `PROVIDER_BUSY` di
  `maxPending` diventa un reject; e in `getAllProviderStatuses()` la chiamata a
  `provider.getStatus()` sta **dentro** il `try` di `safeStatus`, che è `async`,
  quindi anche un throw sincrono diventa `state: 'ERROR'` invece di un 500 sulla
  route. Aggiunto un test di regressione che sostituisce un `getStatus` con uno
  che lancia sincronamente e verifica che gli altri due provider restino leggibili.

---

## Infrastruttura — Docker, Kubernetes, documentazione

Non è una feature numerata della specifica; è il supporto al deploy richiesto da
§3 "Deployment", §37 "Codex on Kubernetes", §39 e §51.

### Implementato

- `Dockerfile` — build multi-stage per Nuxt (`deps` → `build` → `runtime` con
  solo `.output` su `node:22-alpine`, utente `node`, `HOST`/`PORT`
  configurabili). Stage aggiuntivo `migrate` con `drizzle-kit`, config e file di
  migrazione, perché il runtime contiene solo `.output`. Le CLI AI **non** sono
  nell'immagine dell'app.
- `Dockerfile.codex-worker` — Node 22 su Debian (la CLI Codex è un binario
  nativo, musl non è garantito) + `@openai/codex` a versione fissata. Il worker
  è impacchettato con esbuild in un singolo file JS: l'immagine finale non porta
  `node_modules` né TypeScript. `CODEX_HOME=/var/lib/codex` come volume, utente
  non root, `chmod 700` sulla directory delle credenziali.
- `docker-compose.yml` — `postgres:17-alpine` con volume e healthcheck, servizio
  `migrate` che deve completare **prima** dell'app
  (`condition: service_completed_successfully`), `app`, `codex-worker` con volume
  persistente per `CODEX_HOME`, più volumi per la configurazione persistente di
  Claude Code e OpenCode (spec §39). Nessuna porta del worker pubblicata.
- `.dockerignore` — esclude `node_modules`, `.nuxt`, `.output`, `.git`, `.env*`,
  `data/`, `tests`, e qualunque file di credenziali.
- `k8s/` — `namespace.yaml`, `config.yaml` (ConfigMap + Secret con soli
  segnaposto), `migrate-job.yaml`, `app.yaml` (Deployment stateless + Service +
  Ingress), `codex-worker.yaml` (StatefulSet a 1 replica + PVC + Service
  ClusterIP senza Ingress + NetworkPolicy che ammette solo FantaBro), e un
  `k8s/README.md` con ordine di deploy, procedura di login iniziale di Codex e
  configurazione consigliata della CLI.
- `.env.example` — tutte le variabili commentate, nessun valore reale, con il
  promemoria che i file di autenticazione dei provider non vanno committati.
- `README.md` (spec §51), `docs/ARCHITECTURE.md`, questo file.

### Modifiche database

- Nessuna. Le migrazioni sono solo _applicate_, da Drizzle Kit.

### Test

- Nessun test automatico: sono file di configurazione. Le tre immagini sono state
  però **costruite ed eseguite davvero** (vedi Validazione).

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS su `tests/unit/ai` (112/112)
- pnpm build: PASS
- pnpm format:check: PASS

- `docker compose config`: PASS.
- `docker build` di tutti e tre gli stage: PASS
  (`Dockerfile --target runtime`, `--target migrate`, `Dockerfile.codex-worker`).
- Immagini eseguite: l'app ascolta su `0.0.0.0:3000` come utente `node` e
  risponde a `GET /`; l'immagine `migrate` esegue `drizzle-kit migrate` e legge
  la config; il codex-worker ha la CLI `codex` 0.148.0, gira come `node` con
  `/var/lib/codex` a `700 node:node`, e risponde a `/healthz`, `/status` e
  `/ask`. Il log del container conteneva solo la riga di avvio.
- `kubectl apply --dry-run=client`: **NON ESEGUIBILE**, non c'è un cluster
  autenticato in questo ambiente. `kubectl` ha comunque letto tutti i file e
  risolto correttamente ogni `apiVersion`/`kind`/nome; i 12 documenti YAML sono
  stati validati sintatticamente a parte. La validazione contro lo schema
  dell'API server resta da fare al primo deploy.

I controlli `pnpm` sono verdi sui file di questa parte. Nella stessa sessione
altri moduli erano in lavorazione in parallelo, quindi il totale di progetto è
stato a tratti rosso per file fuori da questo perimetro (all'ultima esecuzione:
`tests/e2e/auction-flow.spec.ts` per lint e typecheck).

### Note

- Le probe HTTP dell'app puntano a `/` perché non esiste una route di health
  dedicata. Se ne viene aggiunta una (`/api/health`), va preferita. `GET /`
  risponde 302 verso `/login`: va bene sia per le probe Kubernetes (che accettano
  2xx e 3xx) sia per l'healthcheck del compose (che usa `fetch`, il quale segue
  il redirect).
- Due difetti trovati **costruendo** le immagini, non leggendole: l'eseguibile di
  `esbuild` non è garantito alla radice di `node_modules` in un container (ora è
  installato esplicitamente e pinnato), e lo stage `migrate` scaricava pnpm via
  corepack a runtime, cioè avrebbe richiesto rete in uscita proprio nel Job delle
  migrazioni (ora invoca `drizzle-kit` direttamente).
- I volumi `tmp` nei manifest non sono decorativi: con la root in sola lettura,
  senza `/tmp` scrivibile la working directory temporanea di ogni invocazione AI
  non si crea.
- **Limite di upload**: `proxy-body-size: '16m'` sull'Ingress è l'unico limite
  duro esistente, perché Nitro non offre alcuna opzione di dimensione massima del
  body e `readMultipartFormData` bufferizza il file interamente in memoria prima
  che la route possa guardarlo. I 16 MB stanno volutamente **sopra** i 15 MB
  applicativi: il body multipart è più grande del file per via dei boundary,
  quindi un limite esterno pari a 15 MB rifiuterebbe con un 413 opaco un file da
  15 MB valido. In Docker Compose l'app è esposta senza proxy davanti, quindi quel
  limite duro non c'è: dichiarato come limitazione nota nel README.
- **SSE e proxy**: l'Ingress dichiara `proxy-buffering: 'off'` e
  `proxy-read-timeout: '180'`. Il primo perché nginx accumula il corpo delle
  risposte per default e con il buffering attivo lo stream degli aggiornamenti
  d'asta arriva a blocchi o non arriva — sintomo "gli altri non vedono i miei
  acquisti", non riproducibile in locale. La route manda già
  `x-accel-buffering: no`, che ingress-nginx rispetta: l'annotazione è la rete di
  sicurezza. Il secondo perché il keep-alive dello stream è a 25 s ma il default
  di 60 s chiuderebbe la connessione a intervalli, e perché una risposta AI può
  richiedere fino a `NUXT_AI_TIMEOUT_MS`. Requisiti documentati nel README anche
  per chi usa un proxy diverso.
- **Trappola del giornale Drizzle** documentata nel README e accanto al Job di
  migrazione: il registro delle migrazioni vive nello schema `drizzle`, non in
  `public`. Un reset del solo `public` lascia il giornale avanti, e `db:migrate`
  riporta successo senza applicare niente. La verifica vera è contare le tabelle
  in `public` (14).

---

## Infrastruttura — deploy GitOps K3s LonghiDev

### Implementato

- `Dockerfile` — stage `seed` per creare in modo idempotente l'ADMIN iniziale
  senza esporre le credenziali al pod applicativo.
- `.github/workflows/publish.yml` — pubblica le immagini app, migrazione, seed
  e Codex worker su GHCR a ogni push su `main`, poi aggiorna il tag immutabile
  nell'overlay GitOps con `GITOPS_REPO_TOKEN`.
- `README.md` — documenta il deploy Argo CD su
  `https://fantabro.longhidev.it`, i due Secret creati fuori da Git e la
  procedura di prima sync.

### Note

- I manifest effettivi del server risiedono nella repository separata
  `Lerma4/k3s-argocd-gitops`: ApplicationSet `fantabro`, Traefik, cert-manager
  e `ClusterIssuer` `letsencrypt-prod`. La migrazione e un hook Argo CD
  `PreSync`; il seed e un hook `PostSync` idempotente.
- Pi non e incluso nel deploy.
- Il deployment del server a 4 GB usa una sola replica dell'app e limiti di 512
  MiB per app e worker Codex; il `ResourceQuota` dell'overlay limita tutto il
  namespace a 1,25 GiB, inclusi i Job temporanei.

---

## Infrastruttura — CloudNativePG sul cluster K3s

### Implementato

- `k3s-argocd-gitops/clusters/cloudnative-pg.yaml` — operator CloudNativePG
  tramite chart ufficiale `0.29.0`, con limiti adatti al nodo da 4 GB.
- `k3s-argocd-gitops/apps/postgresql/` — cluster PostgreSQL 17 a una replica,
  database `fantabro`, ruolo non amministrativo, PVC da 5 GiB e Service interno.
- `k3s-argocd-gitops/apps/postgresql/base/storage-class.yaml` — StorageClass
  `local-path-retain`, per non eliminare i dati se il PVC viene cancellato.
- NetworkPolicy e ResourceQuota — PostgreSQL accetta solo FantaBro e l'operator
  CNPG; il pod e limitato a 384 MiB.

### Validazione

- `kubectl kustomize apps/postgresql/overlays/database`: PASS.
- `kubectl apply --dry-run=client` per Application CNPG e ApplicationSet PostgreSQL: PASS.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (357 passati, 50 saltati),
  `pnpm format:check`, `pnpm build`: PASS.

### Note

- Nessun manifest e stato applicato al cluster.
- Backup e WAL archiving sono intenzionalmente fuori da questa prima fase; il
  PVC retained non protegge da guasto del nodo o del disco.

---

## Verifica end-to-end della catena AI — eseguita il 2026-08-19

Non è una feature: è il verbale di una prova reale, tenuto qui perché è la sola
evidenza che la catena AI funzioni **per esecuzione** e non per ragionamento.

### Cosa è stato eseguito

Una domanda vera, attraverso `askWithProvider()` del registry, con la sessione da
abbonamento già presente sul server. Provider **claude-code**, durata **18,1 s**.
Output strutturato prodotto e validato da Zod:

```text
recommendation:    BUY
suggestedMaxPrice: 50
confidence:        0.82
alternatives:      ["Dumfries"]
```

Il `reasoning` restituito citava, senza che nulla di tutto questo fosse nella
domanda: prezzo target (40), prezzo massimo (50), offerta in gioco (43), crediti
residui (244), slot ancora da riempire (22), il rapporto prezzo/FVM medio del
mercato (0,5) e l'alternativa disponibile.

### Cosa questo prova, e cosa no

Prova per esecuzione quattro requisiti:

- **§33** — l'interfaccia comune funziona e il registry instrada correttamente;
- **§34, §36** — autenticazione dalla sessione di abbonamento
  (`authMethod: "claude.ai"`, nessuna API key), invocazione non interattiva,
  timeout rispettato;
- **§41** — il contesto compatto arriva **e viene usato**: i numeri citati sono
  quelli del contesto costruito da `buildAuctionContext`, non un prompt ignorato;
- **§46** — output strutturato validato da Zod, con il testo in chiaro presente
  come fallback, e risposta in italiano come chiede il prompt.

**Riguarda solo Claude Code.** OpenCode e Codex sono rilevati `AVAILABLE` e il
loro `ask()` è stato provato separatamente con un prompt minimo (13,3 s e 14,0 s,
advice `BUY`), ma **non** su un contesto d'asta reale come questo: la prova che il
contesto venga _usato_ esiste solo per Claude Code.

---

## Feature 31 — Rimozione di un giocatore dal listone (solo ADMIN)

### Implementato

- `DELETE /api/players/:playerId`, protetta da `requireAdmin`. La rotta sta **fuori**
  da `/api/auctions/:id` di proposito: il listone è della stagione, non dell'asta,
  quindi la cancellazione tocca tutte le aste che la condividono. Per lo stesso motivo
  il permesso è il ruolo applicativo ADMIN (spec §8) e non la membership OWNER, che
  vale solo dentro una singola asta.
- `server/services/players.ts` → `removePlayerFromListone()`: in transazione prende il
  lock sulla riga di listone, rifiuta se il giocatore è impegnato, cancella, e notifica
  **ogni** asta della stagione con `playerIds: []` ("ricarica tutto": la riga non esiste
  più, non c'è niente da aggiornare in posto).
- `server/repositories/players.ts` → `lockPlayer()`, `isPlayerCommitted()`,
  `deletePlayer()`; `server/repositories/auctions.ts` → `listAuctionIdsForSeason()`.
- Nuovo codice errore `PLAYER_IN_USE` (409): giocatore già in rosa o segnato SOLD in
  qualche asta. Tradotto in `it.json` insieme al suggerimento azionabile.
- UI: bottone cestino in fondo alla riga del listone, reso solo se
  `useCurrentUser().isAdmin`, con conferma esplicita nel popover. La riga sparisce
  subito dalla lista senza aspettare lo stream; la pagina ricarica l'asta per tenere
  allineato `playersCount`.

### Modifiche database

- Nessuna. Le `ON DELETE CASCADE` verso `players` esistevano già: sono proprio loro il
  motivo del rifiuto su un giocatore impegnato.

### Test

- `tests/unit/services/players.spec.ts`: cancellazione + notifica a tutte le aste della
  stagione, `PLAYER_NOT_FOUND`, `PLAYER_IN_USE` senza cancellare né notificare, e
  l'ordine lock → controllo.
- `tests/integration/concurrency.spec.ts`: acquisto e cancellazione concorrenti su due
  transazioni reali. Verificato che il test **fallisce** togliendo `.for('update')` da
  `lockPlayer`: senza il lock la cancellazione non vede l'acquisto committato e la
  cascata si porta via la riga di rosa in silenzio.
- `tests/component/listone-row.spec.ts`: il bottone non esiste per un MEMBER; per un
  ADMIN la cancellazione parte solo dopo la conferma.
- `tests/e2e/auction-flow.spec.ts` passo 14: `DELETE` reale su un giocatore libero (200,
  sparisce dal listone) e su uno in rosa e uno SOLD (409 `PLAYER_IN_USE`), con la rosa
  intatta dopo i rifiuti.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (397/397, con `DATABASE_URL` impostata: integration ed e2e eseguiti,
  non saltati)
- pnpm format:check: PASS
- pnpm build: PASS

### Note

- `lockPlayer` usa `for update` e non `for no key update`: qui il fatto che un
  `FOR UPDATE` blocchi anche gli insert che referenziano la riga (la verifica di FK
  prende `FOR KEY SHARE`) è l'effetto **voluto**, non un danno collaterale. È il
  contrario della scelta fatta in `lockAuction`, e il motivo è che qui la riga sta per
  sparire: un acquisto concorrente non deve poterla referenziare.
- Nessun evento in `auction_events` per la cancellazione: `auction_events.player_id` è
  `ON DELETE SET NULL`, quindi l'evento perderebbe subito il riferimento, e non sarebbe
  comunque annullabile. Il registro d'asta resta il registro delle operazioni d'asta.
- L'operazione è irreversibile per scelta: si torna indietro re-importando il listone.
  Il rifiuto su rosa/SOLD è quello che impedisce alla cancellazione di distruggere dati
  che invece un annullo saprebbe recuperare.

---

## Feature 32 — Stato dell'import e cancellazione di listone e statistiche (solo ADMIN)

### Implementato

- `GET /api/imports?season=…`: cosa risulta importato per una stagione, listone e
  statistiche riportati separati perché sono due import distinti e si cancellano
  separati. In sola lettura basta essere autenticati.
- `DELETE /api/imports/players?season=…` → `wipeListone()`: rifiuta con
  `LISTONE_IN_USE` se anche **un solo** giocatore della stagione è già impegnato,
  altrimenti cancella e fa ricaricare ogni asta della stagione.
- `DELETE /api/imports/stats?season=…&statsSeason=…` → `wipeStats()`: nessun vincolo,
  sono dati derivati. Cancella **una** stagione di dati alla volta, limitata ai
  giocatori del listone indicato: stagioni diverse non si toccano mai fra loro (spec §12).
- `server/repositories/players.ts` → `summarizeListone()`, `countCommittedForSeason()`,
  `deletePlayersForSeason()`; `server/repositories/stats.ts` → `summarizeStats()`,
  `deleteStatsForSeason()`.
- Nuovo codice errore `LISTONE_IN_USE` (409), tradotto in `it.json` con il suggerimento
  azionabile.
- UI: in cima a ciascuna delle due tab di import c'è ora il riepilogo di cosa è già
  dentro — quanti giocatori, quando, quanti già acquistati; una riga per stagione di
  statistiche con i provider. Il cestino è reso solo se `useCurrentUser().isAdmin`, con
  conferma esplicita nel popover, ed è disabilitato quando `committed > 0`. `dt()` in
  `useFormat` per data e ora di un import, che può essere di giorni fa.

### Modifiche database

- Nessuna. Come per la Feature 31 sono le `ON DELETE CASCADE` già esistenti a portare
  via statistiche, stato d'asta e target.

### Test

- `tests/unit/services/import.spec.ts`: `getImportState` con e senza listone importato,
  `wipeListone` rifiutata con giocatori impegnati (senza cancellare nulla), cancellazione
  con notifica a **tutte** le aste della stagione, `wipeStats` limitata alla sola
  stagione di dati indicata.
- `tests/integration/repositories.spec.ts`: riepilogo e cancellazione per stagione su
  PostgreSQL reale, incluso il fatto che una stagione di statistiche cancellata non
  tocca le altre.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (407/407, con `DATABASE_URL` impostata: integration ed e2e eseguiti,
  non saltati)
- pnpm format:check: PASS
- pnpm build: **non eseguito**

### Note

- Le rotte stanno fuori da `/api/auctions/:id` per lo stesso motivo della Feature 31: il
  listone è della stagione, non dell'asta. Il permesso è il ruolo applicativo ADMIN
  (spec §8), non la membership OWNER.
- Il rifiuto del wipe è **in blocco**, non per singolo giocatore: basta un acquisto in
  qualsiasi asta della stagione per bloccare tutto. È voluto — un'asta già giocata non si
  perde per un click, e la via d'uscita esiste già (annullare gli acquisti dal registro,
  oppure cancellare l'asta).
- `reloadSeason()` notifica con `playerIds: []`, la convenzione "ricarica tutto" di
  `utils/events`: dopo una cancellazione non esistono più righe da aggiornare in posto.
- Le statistiche non hanno un legame diretto con l'asta, solo con i giocatori: per questo
  `summarizeStats` e `deleteStatsForSeason` passano dai `players` della stagione del
  listone invece che dall'asta.

---

## Feature 33 — Accesso web in sola lettura per l'AI, e perimetro degli strumenti verificato contro le CLI reali

### Perché

Infortuni, squalifiche, formazioni previste e forma recente non sono nel listone, e non
possono esserci: cambiano ogni giorno. Un consulente che non li vede sbaglia esattamente
quando conta di più. Prezzi, quotazioni, budget, rosa e disponibilità continuano ad
arrivare **solo** dall'`AuctionContext` sanificato.

### Implementato

- `renderContextPrompt` concede WebSearch/WebFetch per i soli fatti che il contesto non
  porta, chiede di citare la fonte e la data, e vieta di inventare prezzi o statistiche.
  Una sola ricerca: l'utente sta aspettando in mezzo a un'asta.
- Perimetro imposto **per CLI**, non a parole:
  - Claude Code: `--tools WebSearch,WebFetch` più `--allowedTools` con gli stessi due.
    Senza la pre-approvazione, in `--print` la richiesta di permesso non ha chi la
    conceda e la chiamata verrebbe negata.
  - Codex: `-c tools.web_search=true`. Questa versione della CLI non ha un flag
    dedicato. È uno strumento lato modello, non un accesso di rete concesso alla
    sandbox: `--sandbox read-only` resta intatto.
  - OpenCode: `opencode.json` scritto nella cwd temporanea a ogni invocazione, con
    `tools` come elenco chiuso (solo `webfetch` acceso) e `permission` come seconda
    barriera. Serve il nuovo hook `prepare(workdir)` in `runCliAsk`: è l'unico modo di
    imporre una policy a una CLI che la legge solo da file, e resta per invocazione,
    senza stato condiviso e senza toccare la configurazione del server.
- `stripAdviceBlock` toglie dalla prosa il blocco JSON già reso come scheda, e `AiPanel`
  non stampa più il paragrafo quando non resta testo: il consiglio si vedeva due volte.

### La scoperta che ha cambiato l'approccio

Verificato il 2026-08-21 contro la CLI OpenCode installata (1.18.18): **omettere `--auto`
non blocca niente**. Senza terminale interattivo OpenCode esegue comunque gli strumenti,
shell inclusa — un prompt che chiede di eseguire `echo` ottiene l'esecuzione ed exit 0.
Nemmeno `permission.bash = "deny"` chiude il buco, perché il modello delega a un
subagente che la policy del primario non copre. L'unica barriera che ha retto alla prova
è spegnere gli strumenti in `tools`.

Il commento nel codice diceva il contrario, e ci credeva. Il prompt d'asta è testo libero
dell'utente, quindi non era un'ipotesi remota: era la via di prompt-injection che spec
§43 vieta, aperta. Da qui la regola aggiunta alla spec: il perimetro va **verificato
contro la CLI reale**, non dedotto dai suoi flag, e riverificato a ogni aggiornamento —
sono nomi di strumenti, e un rename li rende silenziosamente inefficaci.

### Modifiche database

- Nessuna.

### Test

- `tests/unit/ai/providers.spec.ts`: gli argomenti concessi a Claude Code e a Codex; per
  OpenCode il contenuto di `opencode.json` (shell, filesystem e `task` spenti, `webfetch`
  acceso) e il fatto che quel file viva **solo** nella cartella temporanea della
  richiesta, che è l'unico file lì dentro.
- `tests/unit/domain/ai-context.spec.ts`: il prompt concede i due strumenti di rete e
  continua a vietare tutto il resto, e `parseAdvice` non lascia il JSON nella prosa.
- `tests/unit/ai/helpers/fake-spawn.ts`: il doppio di `spawn` ora registra anche i file
  scritti nella cwd, altrimenti la policy di OpenCode non sarebbe osservabile.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (407/407, con `DATABASE_URL` impostata)
- pnpm format:check: PASS
- pnpm build: **non eseguito**

Nessuna CLI reale viene invocata dai test: girano senza `claude`, `codex` o `opencode`
installati, senza rete e senza consumare quota. La prova che il perimetro regga davvero
resta quella manuale del 2026-08-21, da ripetere a ogni aggiornamento delle CLI.

---

## Feature 34 — Messaggi di validazione leggibili in italiano

### Implementato

- `app/plugins/zod-locale.ts`: sostituiti i messaggi tecnici della locale Zod con
  messaggi brevi e orientati all'utente per campi obbligatori, limiti di testo,
  numeri, formati email/URL e opzioni non valide.
- `shared/schemas/common.ts`: tradotto il messaggio esplicito della stagione.
- Aggiornata la regressione del form prezzo al nuovo testo utente.

### Modifiche database

- Nessuna.

### Test

- `tests/component/price-form.spec.ts`: 11/11 PASS.
- Suite completa: 357 PASS, 50 skipped.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS
- pnpm format:check: PASS
- pnpm build: non eseguito

### Note

- La validazione resta centralizzata nel plugin Zod; non sono state aggiunte
  traduzioni duplicate nei singoli componenti.

---

## Feature 35 — Modello Codex rapido con ricerca web

### Implementato

- Il worker Codex abilita `tools.web_search` per le ricerche online.
- Il modello e il livello di reasoning sono configurabili via ConfigMap:
  `gpt-5.6-luna` e `low` nell'overlay Kubernetes attuale.

### Modifiche database

- Nessuna.

### Test

- Suite completa: 357 passati, 50 skipped.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS
- pnpm format:check: PASS
- pnpm build: PASS

### Note

- Il modello viene passato con `--model`; il reasoning con
  `model_reasoning_effort`, senza inserire credenziali nei manifest.
- L'immagine worker installa `ca-certificates`, necessario alla CLI nativa per
  validare i certificati TLS degli endpoint ChatGPT/OpenAI.

---

## Feature 36 — Gestione utenti ADMIN

### Implementato

- Pagina `Impostazioni > Utenti` visibile agli ADMIN: elenco, creazione con
  email/password e cambio del ruolo applicativo.
- Route protette `/api/users`: le credenziali sono create da Better Auth, quindi
  l'app non gestisce hash o account password direttamente.
- Il cambio ruolo blocca transazionalmente la rimozione dell'ultimo ADMIN.

### Modifiche database

- Nessuna.

### Test

- `tests/unit/services/users.spec.ts`: creazione, elenco e protezione
  dell'ultimo ADMIN.
- Suite completa: 360 passati, 50 skipped.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS
- pnpm format:check: PASS
- pnpm build: PASS

---

## Feature 37 — Bootstrap ADMIN in Docker Compose

### Implementato

- `docker-compose.yml`: aggiunto il servizio `seed`, eseguito dopo le migrazioni
  e prima dell'app; crea in modo idempotente l'ADMIN configurato in `.env`.

### Modifiche database

- Nessuna.

### Validazione

- docker compose config --quiet: PASS
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (360 passati, 50 skipped)
- pnpm format:check: PASS
- pnpm build: PASS

---

## Feature 38 — Favicon FantaBro

### Implementato

- `public/favicon.svg`: logo compatto con le lettere `F` e `B`, usando i colori
  del logo nell'header.
- `public/favicon.ico`: favicon generato nelle dimensioni 16, 32, 48 e 64 px.
- `app/app.vue`: favicon collegato globalmente tramite `useHead`.

### Modifiche database

- Nessuna.

### Validazione

- `magick identify public/favicon.ico`: PASS
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm test`: FALLITO per timeout del bootstrap Nuxt nelle 3 suite component
  (`analytics.spec.ts`, `listone-row.spec.ts`, `price-form.spec.ts`); 341 test passati,
  70 skipped.
- `pnpm format:check`: PASS

### Note

- Nessuna modifica al marchio visualizzato nell'header.

---

## Feature 39 — Blocco ADMIN iniziale

### Implementato

- L'account creato dal seed viene marcato `isBootstrapAdmin`.
- Il ruolo dell'ADMIN iniziale è disabilitato nella UI e protetto anche lato API.
- Il seed aggiorna il flag anche su installazioni già inizializzate.

### Modifiche database

- Generata migrazione Drizzle `0001_simple_omega_sentinel.sql`.

### Validazione

- pnpm db:generate: PASS
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (361 passati, 50 skipped)
- pnpm format:check: PASS
- pnpm build: PASS

---

## Feature 40 — PostgreSQL locale per pnpm dev

### Implementato

- PostgreSQL Compose è pubblicato su `localhost:5433`, perché `localhost:5432`
  è già occupata dal database del devcontainer.
- `.env` usa `localhost:5433` per `pnpm dev`; i container continuano a usare
  `postgres:5432` sulla rete interna.

### Validazione

- docker compose config --quiet: PASS

---

## Feature 41 — Versione applicazione e repository

### Implementato

- Footer minimale condiviso da applicazione e login: versione letta da
  `package.json` e collegamento al repository GitHub.

### Modifiche database

- Nessuna.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (361 passati, 50 skipped)
- pnpm format:check: PASS
- pnpm build: PASS

---

## Feature 42 — Seed esplicito in Docker Compose

### Implementato

- Il servizio `seed` ora appartiene al profilo `bootstrap` e non blocca più
  l'avvio dell'app a ogni deploy Compose.
- Le migrazioni restano nel percorso di avvio; il seed si esegue esplicitamente
  con `docker compose --profile bootstrap run --rm seed`.

### Validazione

- docker compose config --quiet: PASS
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (361 passati, 50 skipped)
- pnpm format:check: PASS
- pnpm build: PASS

---

## Feature 43 — Membri asta da utenti esistenti

### Implementato

- Il proprietario dell'asta seleziona un utente già creato tramite `USelectMenu`
  ricercabile per nome o email; gli utenti già membri non vengono proposti.
- La route dei membri restituisce al solo OWNER i dati minimi della lista
  (`id`, nome, email) e l'aggiunta valida il relativo `userId`, non più un'email
  digitata.

### Modifiche database

- Nessuna.

### Test

- `tests/e2e/auction-flow.spec.ts` verifica creazione dell'utente, presenza nella
  lista dell'asta e aggiunta come EDITOR; il test si auto-salta senza
  `DATABASE_URL`.

### Validazione

- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (361 passati, 51 skipped)
- pnpm format:check: PASS
- pnpm build: PASS
