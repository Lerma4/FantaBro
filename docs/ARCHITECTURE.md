# Architettura

Nota breve sui confini reali del sistema e sulle decisioni che non si capiscono
leggendo il codice. La specifica completa è in [`SPEC.md`](SPEC.md).

## Struttura a strati

```text
app/                    Vue: components, composables, pages, stores
  |
server/api/             route Nitro: validano l'input, non contengono logica
  |
server/services/        orchestrazione transazionale (usa domain + repositories)
  |
  +-- server/domain/         logica pura, senza I/O, interamente testabile
  +-- server/repositories/   accesso dati (Drizzle)
  +-- server/providers/      confini di integrazione
```

La logica di business non vive nei componenti Vue. Lo stato derivato — budget
residuo, slot liberi, massima offerta corrente — si **ricalcola** dagli acquisti
in `server/domain`, non si duplica in colonne mutabili.

## I tre confini di integrazione

Le interfacce esistono solo dove c'è un vero confine verso l'esterno. Niente
astrazioni speculative: nessuna interfaccia con una sola implementazione creata
"per il futuro".

| Confine                  | Dove                           | Perché è un confine                                 |
| ------------------------ | ------------------------------ | --------------------------------------------------- |
| Accesso dati             | `server/repositories/`         | Isola Drizzle e le transazioni dal resto            |
| Dati giocatori (listone) | `server/providers/players/`    | Oggi Excel; il formato del listone cambia ogni anno |
| Statistiche storiche     | `server/providers/statistics/` | Stessa ragione, file e stagione diversi             |
| Provider AI              | `server/providers/ai/`         | Tre CLI di terze parti, ognuna con i propri flag    |

Nessuna logica specifica di un vendor esiste fuori dal suo adapter.

## Flusso di una richiesta AI

```text
PostgreSQL
    |  repositories
    v
server/services/ai.ts            carica asta, rosa, budget, target, analytics
    |
    v
server/domain/ai-context.ts      costruisce un AuctionContext compatto e
    |                            sanificato + rende il prompt finale
    v
server/providers/ai/             coda per provider -> spawn senza shell
    |                            prompt su stdin, cwd temporanea vuota,
    |                            environment da allowlist
    v
CLI AI (claude | opencode | codex)
    |
    v
parseAdvice()                    testo + JSON validato con Zod
    |
    v
AiResponse { text, advice? }     l'API restituisce solo questo
```

Il contesto è **costruito**, non è un dump del database: giocatore in gioco,
rosa, budget, slot, target e un numero limitato di alternative. Non contiene
credenziali, non contiene identificatori interni inutili, e l'AI non ha alcun
accesso al database.

L'AI non scrive niente. Una risposta AI non può cambiare lo stato d'asta: ogni
mutazione passa dai normali servizi applicativi e dai loro controlli di
autorizzazione.

## Decisioni non ovvie

### Lo stato d'asta è derivato, non memorizzato

Budget residuo, slot occupati e massima offerta possibile si ricalcolano dagli
acquisti a ogni lettura. Una colonna `remaining_budget` aggiornata a mano è
destinata a divergere dalla realtà: basta un annullo gestito male, o due utenti
che comprano insieme, e il numero mostrato durante l'asta diventa falso. Il costo
è qualche calcolo in più per richiesta; il beneficio è che un annullo è solo la
cancellazione di un evento e tutto torna coerente da sé.

### Codici errore stabili invece di messaggi

Il server restituisce solo codici da `shared/constants/errors.ts`
(`BUDGET_EXCEEDED`, `NOT_AUTHENTICATED`, `PROVIDER_BUSY`, …) e il client li
traduce con `t('errors.<CODE>')`. Nessuna stringa destinata all'utente vive nel
server.

Due motivi: il multilingua resta possibile senza toccare il backend, e un codice
è testabile mentre un messaggio no — un test può asserire `PROVIDER_BUSY` senza
rompersi quando si riscrive la frase mostrata a schermo. Vale anche verso il
codex-worker: il worker risponde con lo stesso vocabolario di codici, e il
provider li ri-lancia identici invece di tradurli in un generico errore HTTP.

### Un solo worker Codex, con coda a concorrenza 1

Lo stato di autenticazione delle CLI AI è un **file scrivibile** (`auth.json`, le
credenziali di Claude Code, la config di OpenCode). Due invocazioni in parallelo
che lo rinfrescano insieme possono corromperlo, e il sintomo sarebbe un
`NOT_AUTHENTICATED` durante un'asta dal vivo — il momento peggiore.

Da qui due scelte collegate:

- su Kubernetes Codex vive in un `StatefulSet` a **una replica** con `CODEX_HOME`
  su PersistentVolume, invece di girare dentro ogni replica dell'app. Un solo
  proprietario del file; FantaBro resta stateless e scalabile;
- la coda dei provider ha **concorrenza 1**, per provider. Le richieste si
  serializzano in FIFO; oltre `maxPending` in attesa la risposta è
  `PROVIDER_BUSY`, e ogni richiesta ha un timeout che copre anche l'attesa.

È sufficiente per il carico di un'asta e molto più semplice da mantenere di un
lock distribuito. La scelta è rivedibile senza toccare il dominio: l'app parla col
worker solo via HTTP.

La coda è un dettaglio del layer AI. Non compare in nessuna firma del dominio
asta, che non sa nulla di attese o di slot occupati.

### Nessuna API key: l'allowlist di environment

I provider usano le sessioni CLI già autenticate sul server. Il divieto di
fallback alla fatturazione a consumo non è affidato alla disciplina di chi scrive
il codice: l'environment dei processi AI è **costruito da zero** a partire da una
allowlist (`PATH`, `HOME`, locale, directory di configurazione). `ANTHROPIC_API_KEY`
e `OPENAI_API_KEY` non ne fanno parte, quindi le CLI non le vedono affatto.

Lo stesso meccanismo tiene fuori `DATABASE_URL` e `NUXT_BETTER_AUTH_SECRET`: un
coding agent eseguito dall'applicazione non ha modo di leggere i segreti
dell'applicazione.

### Prompt su stdin, mai in `argv`

Il prompt utente è passato sullo standard input del processo. In `argv` sarebbe
visibile in `ps` a chiunque sia sulla macchina e, se iniziasse con `-`, potrebbe
essere interpretato come un flag della CLI. Insieme a `shell: false` e agli array
di argomenti, questo chiude la strada all'iniezione di comandi.

### Duplicazione deliberata nel codex-worker

`worker/codex/exec.ts` è una copia ridotta di `server/providers/ai/exec.ts`. Il
worker è un processo separato che gira in un container senza Nuxt e senza il
codice applicativo: importare il modulo dell'app trascinerebbe il layer provider
attraverso un confine di processo.

Ciò che invece **non** è duplicato è il prompt: il worker importa
`renderContextPrompt` dal dominio, così la domanda posta a Codex è identica in
modalità locale e in modalità worker. Un secondo template divergerebbe alla prima
modifica.

Se cambia una regola di sicurezza dello spawn, va cambiata in entrambi i file: è
il prezzo consapevole di questa scelta.

### Perché lo strato AI ha una `registry` separata da `index`

`registry.ts` riceve la configurazione come argomento e non conosce Nitro: è
verificabile con un test normale. `index.ts` è l'adattatore che legge
`runtimeConfig` e tiene un'istanza per processo — necessaria, perché le code di
concorrenza devono essere condivise da tutte le richieste: ricostruirle a ogni
chiamata renderebbe il limite di concorrenza inutile.
