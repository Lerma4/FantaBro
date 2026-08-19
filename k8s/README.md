# Deploy Kubernetes di FantaBro

Manifest YAML semplici, senza Helm. Namespace: `fantabro`.

| File                | Contenuto                                                   |
| ------------------- | ----------------------------------------------------------- |
| `namespace.yaml`    | Namespace `fantabro`                                        |
| `config.yaml`       | ConfigMap dell'app e del worker + Secret di esempio         |
| `migrate-job.yaml`  | Job che applica le migrazioni Drizzle                       |
| `app.yaml`          | Deployment stateless + Service + Ingress                    |
| `codex-worker.yaml` | StatefulSet (1 replica) + Service ClusterIP + NetworkPolicy |

Prima di applicare, sostituisci i segnaposto:

- `REGISTRY/...` con il tuo registry e il tag della release;
- `fantabro.example.com` con il tuo host (Ingress e `NUXT_BETTER_AUTH_URL`);
- i valori `REPLACE_ME` del Secret — **non** committandoli.

PostgreSQL non è incluso: usa un servizio gestito o un operator, e metti la sua
stringa di connessione nel Secret.

## Ordine di deploy

Le migrazioni devono essere applicate **prima** che la nuova versione dell'app
serva traffico (spec §3). Non invertire i passi 3 e 4.

```bash
kubectl apply -f namespace.yaml
kubectl -n fantabro apply -f config.yaml

# Migrazioni: un Job per release (il suffisso del nome contiene la versione).
kubectl -n fantabro apply -f migrate-job.yaml
kubectl -n fantabro wait --for=condition=complete job/fantabro-migrate-0-1-0 --timeout=300s

kubectl -n fantabro apply -f codex-worker.yaml
kubectl -n fantabro apply -f app.yaml
```

Se il `wait` non riesce, fermati e guarda i log del Job: proseguire farebbe
girare il codice nuovo su uno schema vecchio.

```bash
kubectl -n fantabro logs job/fantabro-migrate-0-1-0
```

**Un Job completato non basta come prova.** Drizzle tiene il giornale delle
migrazioni nello schema `drizzle`, separato da `public`: se il giornale è avanti
rispetto allo schema reale — tipicamente dopo un ripristino da backup del solo
`public` — il Job non applica niente e **riporta successo** con lo schema
incompleto. Dopo un restore, conta le tabelle prima di promuovere l'app (devono
essere 14):

```bash
kubectl -n fantabro exec -it deploy/fantabro -- node -e "1" # sostituire con il proprio client psql
# select count(*) from information_schema.tables where table_schema = 'public';
```

Il dettaglio, con il reset corretto, è nel [README principale](../README.md#database-e-migrazioni).

## Login iniziale di Codex

Gli utenti di FantaBro **non** devono fare questo login. È un'operazione
amministrativa, una volta sola per volume, contro il pod del worker.

```bash
# 1. Configurazione della politica di autenticazione (vedi sotto il perché).
kubectl -n fantabro exec -it codex-worker-0 -- sh -c 'cat > "$CODEX_HOME/config.toml" <<EOF
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
EOF'

# 2. Login con device auth: stampa un codice e una URL da aprire nel browser.
kubectl -n fantabro exec -it codex-worker-0 -- codex login --device-auth

# 3. Verifica.
kubectl -n fantabro exec -it codex-worker-0 -- codex login status
# Atteso: "Logged in using ChatGPT"
```

Dopo il login, `GET /status` del worker passa a `AVAILABLE` e la pagina
_Impostazioni → AI_ di FantaBro mostra Codex come connesso.

Verifica dall'interno del cluster senza esporre nulla:

```bash
kubectl -n fantabro run curl --rm -it --image=curlimages/curl --restart=Never \
  --labels=app.kubernetes.io/name=fantabro -- \
  curl -s http://codex-worker:8787/status
```

(La NetworkPolicy accetta solo pod con l'etichetta `app.kubernetes.io/name=fantabro`:
senza `--labels` la connessione viene rifiutata, che è esattamente il
comportamento atteso.)

### Perché quella configurazione Codex

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

- `cli_auth_credentials_store = "file"` tiene le credenziali in un file dentro
  `CODEX_HOME`, che è il PersistentVolume. Un keyring di sistema non
  sopravvivrebbe alla ricreazione del pod, e il login andrebbe rifatto a ogni
  rollout.
- `forced_login_method = "chatgpt"` impedisce che un deploy passi **per sbaglio**
  alla fatturazione a consumo con una API key. Se la sessione ChatGPT scade,
  l'errore diventa esplicito (`NOT_AUTHENTICATED`) invece di trasformarsi in
  addebiti silenziosi (spec §34, §37).

Il worker non riceve comunque `OPENAI_API_KEY`: l'allowlist di environment con
cui esegue `codex` non la propaga. Questa configurazione è la seconda barriera,
non l'unica.

## Cosa sopravvive a cosa

| Evento                    | La sessione Codex sopravvive? |
| ------------------------- | ----------------------------- |
| Riavvio del pod           | Sì                            |
| Ricreazione del pod       | Sì                            |
| Rollout dell'app FantaBro | Sì                            |
| Nuova immagine del worker | Sì                            |
| Riavvio del nodo          | Sì                            |
| Cancellazione del PVC     | **No** — serve un nuovo login |

Il PVC `codex-home-codex-worker-0` è l'unico stato da preservare (e da includere
nei backup). Non contiene dati d'asta: solo l'autenticazione Codex.

## Perché una sola replica del worker

Lo stato di autenticazione Codex è un file scrivibile. Montarlo in più pod e
dare per scontato che sia concurrency-safe è il modo di corrompere `auth.json`.
V1 usa quindi `replicas: 1` e una coda a concorrenza 1 nel worker: sufficiente
per il carico di un'asta, e molto più semplice da mantenere.

L'architettura resta aperta a rivedere la scelta se in futuro l'isolamento delle
sessioni permetterà di scalare orizzontalmente: l'app parla col worker solo via
HTTP, quindi cambierebbe solo il worker.

## Note sui manifest

- **Nessun Ingress per il worker**, per scelta. Se ne aggiungi uno, la sessione
  Codex autenticata diventa raggiungibile da fuori.
- L'annotazione `proxy-body-size: '16m'` sull'Ingress dell'app è **l'unico limite
  duro** sulla dimensione degli upload: Nitro non ne ha uno, e il file viene
  bufferizzato in memoria prima che la route lo veda. Con un ingress controller
  diverso da ingress-nginx serve l'annotazione equivalente, altrimenti il limite
  scompare. Il margine sui 15 MB applicativi è spiegato nel manifest.
- Root filesystem in sola lettura in tutti i pod. I volumi `tmp` non sono
  decorativi: il layer AI crea una working directory temporanea vuota per ogni
  invocazione, e senza `/tmp` scrivibile `mkdtemp` fallisce.
- La NetworkPolicy limita solo l'ingresso. Aggiungere `Egress` a `policyTypes`
  bloccherebbe DNS e l'accesso a ChatGPT/Codex, cioè il lavoro del worker.
- L'app non monta volumi per Claude Code e OpenCode: su Kubernetes non sono
  installati nell'immagine. Per usarli servirebbe un'immagine derivata con le
  CLI e volumi persistenti per la loro configurazione, come fa
  `docker-compose.yml`.
