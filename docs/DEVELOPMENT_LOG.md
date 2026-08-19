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
