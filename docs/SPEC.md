# FantAsta Assistant — Product & Development Specification

## 1. Goal

Build a self-hosted web application that acts as a **personal assistant during a Fantacalcio auction**.

This is **not** a complete auction-management platform for an entire league.

The application is intended to support the user's own fantasy team during a live auction by providing:

- an updated player list;
- current quotation/FVM data;
- previous-season statistics;
- fast player search and filtering;
- current roster;
- budget and role-slot tracking;
- marking players as sold to other teams;
- personal targets, tiers and maximum prices;
- auction price analytics;
- AI-assisted recommendations using locally/server-installed AI coding agents.

The application must be optimized for **speed during a live auction**. The most common operations must require as few clicks as possible.

---

# 2. Core Product Principles

1. **Live-auction first**  
   The main screen must be usable continuously during the auction.

2. **Fast interactions**  
   Buying a player or marking a player as sold must be possible directly from the player list.

3. **Available players first**  
   Players already bought by the user or sold to other teams must disappear from the default player list.

4. **Reliable calculations**  
   Budget, remaining slots and maximum bid are critical business logic and must be tested.

5. **Multi-user**  
   Multiple authenticated users can access the same auction.

6. **Self-hosted**  
   The entire application must be deployable on a private server with Docker.

7. **Provider-independent AI**  
   Claude Code, OpenCode and Codex must be interchangeable behind a common interface.

8. **Subscription/session-based AI authentication**  
   The primary AI integrations must use the authenticated CLI sessions of Claude Code, OpenCode and Codex installed on the server.  
   Direct pay-per-token APIs are NOT the primary integration path.

---

# 3. Technology Stack

Use the following stack unless there is a strong technical reason to change it.

## Application

- Nuxt 4
- Vue 3
- TypeScript
- Nuxt UI
- Nitro server routes
- Pinia only where shared client-side state is useful
- Zod for runtime validation

The application should remain a **single full-stack Nuxt project**.

Do not create a separate Java, Go, Python or standalone Node backend unless a future requirement clearly justifies it.

## Database

- PostgreSQL
- Drizzle ORM
- **Drizzle Kit for schema management and migrations**

PostgreSQL is required because the application is multi-user and multiple users may modify the same auction concurrently.

### Database migration rules

All database schema changes MUST be managed through **Drizzle Kit**.

The project must configure `drizzle.config.ts` and expose clear package scripts, for example:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  }
}
```

Rules:

- define the database schema through Drizzle ORM;
- generate migrations with Drizzle Kit;
- commit generated migration files to the repository;
- never apply undocumented manual production schema changes;
- never use ad-hoc `ALTER TABLE` commands as the normal migration workflow;
- every feature that changes the schema must include its Drizzle migration;
- migrations must be reviewed together with the feature that generated them;
- local/dev/prod environments must use the same migration history;
- deployment must apply pending migrations in a controlled manner before the new application version begins serving incompatible traffic.

Do not use Prisma migrations, Liquibase, Flyway or another migration framework unless the architecture is explicitly changed later.

## Authentication

Use Better Auth or another well-supported Nuxt-compatible authentication solution.

Initial requirements:

- email/password login;
- authenticated app;
- no mandatory public registration;
- support multiple users;
- support users sharing the same auction;
- admin/member authorization.

The application's authentication is completely separate from AI-provider authentication.

## Excel

Use a maintained XLSX parser such as:

- ExcelJS

The Excel parsing logic must be isolated behind a service/provider abstraction.

## Testing

Prefer:

- Vitest
- Vue Test Utils where component tests are useful

## Code quality

Use:

- ESLint
- TypeScript strict type checking
- Nuxt typecheck
- Prettier or another consistent formatter

## Deployment

The application must support:

- Docker for local/containerized execution;
- Docker Compose for simple local/self-hosted development;
- Kubernetes for the target production deployment;
- PostgreSQL persistent storage;
- persistent volumes for AI CLI authentication/configuration where required.

Kubernetes manifests or Helm configuration should keep the main FantAsta application stateless wherever practical.

---

# 4. Repository Structure

Prefer a clear structure similar to:

```text
app/
  components/
  composables/
  pages/
  stores/

server/
  api/
  database/
    schema/
    migrations/
  services/
  repositories/
  providers/
    players/
    statistics/
    ai/

shared/
  types/
  schemas/
  constants/

tests/

docs/
```

Business logic must not live directly inside Vue components.

Use reusable domain/services functions.

---

# 5. Mandatory Development Workflow

Development must be divided into **small, coherent features**.

Examples:

```text
Feature 01 — Project bootstrap
Feature 02 — Authentication
Feature 03 — Auction creation
Feature 04 — Player import
Feature 05 — Player browser
Feature 06 — Roster and purchases
Feature 07 — Sold-player management
Feature 08 — Budget calculations
Feature 09 — Targets and tiers
Feature 10 — Historical statistics
Feature 11 — AI providers
...
```

Do not implement unrelated features in one uncontrolled batch.

---

# 6. STRICT QUALITY GATE AFTER EVERY FEATURE

This is a mandatory project rule.

After implementing **EVERY feature**, the coding agent MUST run the configured validation commands before considering the feature finished.

At minimum:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

If formatting verification is configured:

```bash
pnpm format:check
```

When appropriate also run:

```bash
pnpm build
```

The package manager should preferably be `pnpm`.

Expose equivalent scripts in `package.json`, for example:

```json
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "nuxt typecheck",
    "test": "vitest run",
    "format:check": "prettier --check .",
    "build": "nuxt build"
  }
}
```

## Definition of Done

A feature is NOT complete if any required check fails.

The agent must:

1. implement the feature;
2. add/update tests;
3. run lint;
4. run typecheck;
5. run tests;
6. fix every failure;
7. rerun the checks;
8. only then mark the feature as completed.

Never leave lint/type/test failures for a future feature.

Do not disable rules globally just to make validation pass.

Avoid:

```text
eslint-disable
@ts-ignore
@ts-nocheck
```

unless strictly necessary, narrowly scoped and documented.

---

# 7. Regression Testing

Important business rules must have automated tests.

At minimum test:

- budget calculation;
- remaining budget;
- role-slot calculation;
- maximum current bid;
- successful purchase;
- purchase exceeding available budget;
- purchase exceeding role slots;
- purchase of an unavailable player;
- undo purchase;
- mark player as SOLD;
- undo SOLD;
- Excel parsing;
- invalid Excel input;
- auction analytics;
- AI context generation;
- AI-provider failures.

All bugs discovered during development should receive a regression test where practical.

---

# 8. User

Suggested domain:

```text
User
- id
- email
- name
- role
- createdAt
- updatedAt
```

Application roles:

```text
ADMIN
MEMBER
```

Authentication-library-specific tables may be handled separately.

---

# 9. Auction

An auction represents one Fantacalcio auction/session.

Suggested fields:

```text
Auction
- id
- name
- season
- mode
- initialBudget
- minimumPlayerCost
- createdBy
- createdAt
- updatedAt
```

Example:

```text
name: Fantacalcio 2026/27
season: 2026/27
mode: CLASSIC
initialBudget: 500
minimumPlayerCost: 1
```

Initially support:

```text
CLASSIC
```

The design should not prevent future support for:

```text
MANTRA
```

---

# 10. Multi-user Auction Membership

Do not directly couple an auction to a single user.

Use membership:

```text
User
  |
AuctionMember
  |
Auction
```

Suggested fields:

```text
AuctionMember
- auctionId
- userId
- role
- createdAt
```

Suggested roles:

```text
OWNER
EDITOR
VIEWER
```

V1 may use only:

```text
OWNER
EDITOR
```

Multiple users can collaborate on the same fantasy team and auction state.

---

# 11. Player

Suggested canonical player model:

```text
Player
- id
- externalId
- name
- team
- role
- mantraRole
- quotation
- fvm
- season
- createdAt
- updatedAt
```

Classic roles:

```text
P
D
C
A
```

Do not assume that IDs from every external Excel/provider are permanently stable.

---

# 12. Player Historical Statistics

Use a separate season-aware model.

```text
PlayerSeasonStats
- playerId
- season
- appearances
- starts
- minutes
- averageRating
- fantasyAverage
- goals
- assists
- yellowCards
- redCards
- penaltiesScored
- penaltiesMissed
- goalsConceded
- penaltiesSaved
- provider
- updatedAt
```

Fields may be nullable if unavailable from the current provider.

Never silently mix statistics from different seasons.

The UI must always indicate the reference season.

---

# 13. Player Data Import

Manual Excel upload is mandatory.

The app must work even if no external API is available.

Flow:

```text
Auction
  -> Import players
  -> Upload XLSX
  -> Detect/map columns
  -> Preview
  -> Validate
  -> Confirm
```

Attempt to recognize fields such as:

```text
player id
name
team
classic role
mantra role
quotation
FVM
```

Validation must identify:

- required missing columns;
- duplicates;
- invalid roles;
- invalid numeric values;
- malformed rows.

Do not silently import malformed rows.

Show an import preview before confirmation.

---

# 14. Provider Architecture for Player Data

External data must be abstracted.

Example:

```ts
interface PlayerDataProvider {
  loadPlayers(input: unknown): Promise<PlayerImportResult>
}

interface PlayerStatsProvider {
  loadSeasonStats(season: string): Promise<PlayerSeasonStats[]>
}
```

Possible providers:

```text
ExcelPlayerProvider
FantacalcioProvider
ApiFootballStatsProvider
Other future providers
```

Manual Excel must remain available regardless of provider availability.

Do not make the core application depend on an undocumented third-party endpoint.

---

# 15. Auction Player State

Player availability is specific to an auction.

Suggested model:

```text
AuctionPlayer
- auctionId
- playerId
- status
- soldPrice
- otherTeamName
- updatedBy
- updatedAt
```

Valid statuses:

```text
AVAILABLE
MY_PLAYER
SOLD
```

## AVAILABLE

The player can still be purchased.

## MY_PLAYER

The player has been purchased for the user's fantasy team.

## SOLD

The player was purchased by another fantasy team and is no longer available.

---

# 16. SOLD Is a First-class Feature

The user must be able to mark any available player as:

```text
SOLD
```

directly from the main player table.

Optional metadata:

```text
soldPrice
otherTeamName
```

`soldPrice` should be encouraged because it is useful for auction analytics.

When a player becomes SOLD:

- remove them from the default available-player view;
- do not reduce the user's budget;
- do not occupy any roster slot;
- record the operation;
- make it reversible.

The user must not be forced to enter the team that bought the player.

---

# 17. Main Player List

The default player list must show:

```text
AVAILABLE
```

only.

Available status filters:

```text
Available
My players
Sold
All
```

Expected columns:

```text
Name
Role
Team
Quotation
FVM
Previous-season average rating
Previous-season fantasy average
Tier
Target
Actions
```

Primary row actions:

```text
BUY
SOLD
TARGET
DETAILS
```

Buying or marking SOLD must not require opening the player details page.

---

# 18. Search and Filters

Implement fast text search by player name.

Useful filters:

```text
role
team
status
tier
target/watchlist
quotation range
FVM range
average rating range
fantasy average range
minimum appearances
```

Filtering should feel instant with a Serie A-sized dataset.

---

# 19. Roster

The current fantasy roster must be available from the auction.

Suggested model:

```text
Roster
- id
- auctionId
```

```text
RosterPlayer
- rosterId
- playerId
- purchasePrice
- purchasedAt
```

If multiple app users collaborate on the same fantasy team, the roster belongs to the auction/team, NOT to an individual application user.

---

# 20. Role Slots

Each auction must configure player slots.

Example:

```text
P: 3
D: 8
C: 8
A: 6
```

Display occupancy clearly:

```text
P 3/3
D 5/8
C 4/8
A 2/6
```

Show:

- occupied slots;
- free slots by role;
- total remaining slots.

Prevent a normal purchase when no slot remains for the player's role.

---

# 21. Budget

Always display prominently:

```text
Initial budget
Spent
Remaining
Remaining slots
Average budget per remaining slot
Maximum current bid
```

Budget values should be derived consistently from purchases rather than duplicated in multiple mutable locations unless there is a documented reason.

---

# 22. Maximum Current Bid

Critical formula:

```text
maxBid =
  remainingBudget
  - ((remainingSlots - 1) * minimumPlayerCost)
```

Example:

```text
remainingBudget = 100
remainingSlots = 5
minimumPlayerCost = 1

maxBid = 96
```

This requires unit tests.

---

# 23. Planned Budget by Role

Allow optional budget targets:

```text
P: 30
D: 70
C: 150
A: 250
```

Display for each role:

```text
planned
spent
planned remaining
percentage used
```

These values are advisory.

Do not block purchases because a planned role budget has been exceeded.

---

# 24. Player Purchase

Purchase flow must be fast.

Example:

```text
Dimarco
Price: [43]

[PURCHASE]
```

On confirmation:

1. ensure player is AVAILABLE;
2. ensure role slot is available;
3. ensure budget is sufficient;
4. ensure bid does not make remaining mandatory slots impossible to fill;
5. add player to roster;
6. store purchase price;
7. change auction-player status to MY_PLAYER;
8. record event;
9. return updated auction state.

The operation must be transactional.

Concurrency must be handled correctly.

---

# 25. Undo

Undo is mandatory.

At minimum allow reverting:

- purchase;
- mark as SOLD.

Purchase undo must:

- remove the roster player;
- restore their status to AVAILABLE;
- restore effective budget;
- free the role slot;
- record the reversal.

SOLD undo must:

- restore player to AVAILABLE;
- record the reversal.

Do not destroy event history merely to implement undo.

---

# 26. Event/Audit Log

Suggested model:

```text
AuctionEvent
- id
- auctionId
- actorUserId
- playerId
- type
- payload
- createdAt
- revertedAt
```

Potential events:

```text
PLAYER_PURCHASED
PLAYER_PURCHASE_REVERTED
PLAYER_SOLD
PLAYER_SOLD_REVERTED
PLAYER_TARGET_UPDATED
PLAYER_TIER_UPDATED
IMPORT_COMPLETED
```

Example UI:

```text
14:32 Dimarco   PURCHASED   43
14:29 Bastoni   SOLD        35
14:24 Sommer    PURCHASED   25
```

---

# 27. Target / Watchlist

Users need pre-auction preparation tools.

For each player allow:

```text
tier
targetPrice
maxPrice
priority
notes
isTarget
```

Suggested tiers:

```text
A
B
C
D
GAMBLE
AVOID
```

Design the model so custom tiers can be added later.

---

# 28. Target and Maximum Price

Allow:

```text
Target price
Maximum price
```

During auction entry, visually warn when a live/current bid is:

- near the maximum;
- equal to maximum;
- above maximum.

Never automatically purchase a player.

Purchases must always be explicitly confirmed.

---

# 29. Player Detail

Show at least:

```text
name
team
role
quotation
FVM

previous-season:
- appearances
- average rating
- fantasy average
- goals
- assists

personal:
- tier
- target price
- max price
- notes
```

Actions:

```text
BUY
SOLD
COMPARE
ASK AI
```

---

# 30. Player Comparison

Allow comparison of multiple players.

Compare at least:

```text
role
team
quotation
FVM
appearances
average rating
fantasy average
goals
assists
target price
max price
status
```

Provide:

```text
ASK AI TO COMPARE
```

---

# 31. Auction Market Analytics

When prices of SOLD players are entered, calculate actual auction-market trends.

Possible metrics:

```text
average sold price
average FVM
price/FVM ratio
average sold price by role
average sold price by tier
premium/discount versus FVM
```

Example:

```text
Attackers

Average FVM: 65
Average sold price: 78
Premium vs FVM: +20%
```

Only use actual recorded auction prices.

Never invent missing sale prices.

---

# 32. Main Auction Dashboard

This is the most important screen.

Example header:

```text
Fantacalcio 2026/27

Budget:    287 / 500
Spent:     213
Slots:     P 3/3 | D 5/8 | C 4/8 | A 2/6
Max bid:   278
```

The main player table should occupy most of the page.

Critical information and actions must be visible without unnecessary navigation.

---

# 33. AI Assistant — General Architecture

The AI integration is an important feature but must remain isolated from the auction domain.

Define a common interface such as:

```ts
interface AiProvider {
  id: string
  getStatus(): Promise<AiProviderStatus>
  ask(context: AuctionContext, prompt: string): Promise<AiResponse>
}
```

Implement separate adapters:

```text
ClaudeCodeProvider
OpenCodeProvider
CodexProvider
```

Application code must not contain vendor-specific logic outside these adapters.

---

# 34. IMPORTANT — AI Authentication Strategy

The application must use **existing authenticated CLI sessions**.

The goal is to use the subscription/login already configured for the installed CLI rather than making normal requests through separately billed API keys.

Primary supported flow:

```text
FantAsta
   |
   +--> Claude Code CLI --> existing Claude Code login/session
   |
   +--> OpenCode CLI -----> existing OpenCode provider login/session
   |
   +--> Codex CLI --------> existing ChatGPT/Codex login/session
```

Do NOT make direct API-key billing the default implementation.

Do NOT silently switch to a separately billed API if CLI/session authentication fails.

If an authenticated CLI session is unavailable, return a clear provider state such as:

```text
NOT_INSTALLED
NOT_AUTHENTICATED
AVAILABLE
ERROR
```

---

# 35. AI Authentication Is Server-side

FantAsta login and AI login are different systems.

Example:

```text
Lorenzo ----\
             \
Socio --------> FantAsta ---> AI provider CLI ---> server AI login
             /
User N ------/
```

FantAsta users authenticate individually to FantAsta.

The AI provider uses a server-side authenticated profile.

V1 uses **one configured AI identity per provider on the server**, shared by the FantAsta application.

Do not require every FantAsta user to perform an AI login.

---

# 36. Claude Code Integration

Claude Code must be installed on the application host or in the relevant runtime container.

The provider must use the authenticated Claude Code CLI profile/session.

Expected behavior:

```text
ClaudeCodeProvider
    |
    +--> detect `claude`
    |
    +--> verify authenticated state
    |
    +--> execute non-interactively
```

Use Claude Code's non-interactive invocation mode.

The implementation must:

- execute server-side only;
- use argument arrays instead of unsafe shell interpolation;
- apply a configurable timeout;
- capture stdout;
- capture stderr;
- detect missing executable;
- detect authentication failure;
- provide useful application-level errors;
- avoid granting unnecessary filesystem/tool permissions;
- never expose Claude credentials to the frontend.

The implementation should not require an Anthropic API key for normal operation.

---

# 37. Codex Integration

Codex CLI must be installed on the server.

The preferred authentication method is the existing **ChatGPT/Codex login** associated with the CLI.

The server administrator should be able to authenticate Codex interactively or through its supported device-login flow before FantAsta uses it.

Conceptually:

```text
Server administrator
       |
       +--> codex login
              |
              +--> ChatGPT account/session
```

FantAsta then uses:

```text
CodexProvider
    |
    +--> codex exec ...
```

Requirements:

- no OpenAI API key required for the normal V1 flow;
- authenticated CLI state must survive application/container restarts;
- authentication data must live in a persistent volume/config location;
- missing/expired authentication must produce `NOT_AUTHENTICATED`;
- do not silently fall back to `OPENAI_API_KEY`;
- use safe process execution;
- timeout every invocation;
- limit filesystem/tool access to what FantAsta actually requires.

Codex should receive auction context from FantAsta rather than being given uncontrolled access to the application database.

## Codex on Kubernetes

In Kubernetes, do NOT run Codex independently inside every Nuxt/FantAsta replica.

Use a dedicated internal **Codex worker**.

Target architecture:

```text
                         Kubernetes
┌────────────────────────────────────────────────────────┐
│                                                        │
│                    Ingress                             │
│                       |                                │
│                       v                                │
│              +------------------+                      │
│              | FantAsta / Nuxt  |                      │
│              | replicas: 1..N   |                      │
│              +--------+---------+                      │
│                       |                                │
│                       | internal HTTP                  │
│                       v                                │
│              +------------------+                      │
│              |   codex-worker   |                      │
│              |   replicas: 1    |                      │
│              +--------+---------+                      │
│                       |                                │
│                  CODEX_HOME                            │
│                       |                                │
│                       v                                │
│                 PersistentVolume                      │
│                                                        │
└───────────────────────+────────────────────────────────┘
                        |
                        v
                 ChatGPT / Codex
```

### Codex worker responsibilities

The worker must:

- be a separate server-side service;
- expose only an internal API to FantAsta;
- use a Kubernetes `ClusterIP` Service;
- have **no public Ingress**;
- run with **one replica in V1**;
- serialize or explicitly control Codex invocations;
- maintain the authenticated Codex session;
- enforce request timeouts;
- sanitize inputs;
- return only the AI result/status to FantAsta;
- never expose `auth.json`, tokens or provider credentials;
- never connect directly to PostgreSQL unless explicitly introduced by a future architecture decision.

Prefer a small Node/TypeScript worker so it can share types and conventions with the rest of the project.

The worker may use the official Codex SDK when appropriate, or invoke Codex non-interactively through a safe process wrapper. In either case, the authentication source must remain the existing Codex/ChatGPT login rather than a silently substituted API key.

### Persistent Codex authentication

Set a persistent `CODEX_HOME`, for example:

```text
/var/lib/codex
```

Back it with a Kubernetes PersistentVolumeClaim.

Expected persisted files may include:

```text
/var/lib/codex/auth.json
/var/lib/codex/config.toml
```

The authentication directory is sensitive and must:

- never be committed to Git;
- never be exposed by HTTP endpoints;
- never be printed in logs;
- be mounted only into the Codex worker;
- use restrictive filesystem permissions where practical.

The Codex login must survive:

```text
pod restart
pod recreation
application rollout
node restart
FantAsta deployment update
```

### Initial Codex login

The server administrator performs the Codex authentication against the running worker.

Expected administrative flow:

```bash
kubectl exec -it <codex-worker-pod> -- codex login --device-auth
```

Then verify:

```bash
kubectl exec -it <codex-worker-pod> -- codex login status
```

The user completes the device authentication from their browser.

FantAsta application users must NOT perform this login.

### Codex authentication policy

Configure Codex so that the intended authentication mode is explicit.

Where supported/configured, prefer settings equivalent to:

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

The purpose is to ensure that:

- Codex uses the persisted ChatGPT/Codex login;
- a deployment does not accidentally switch to API-key billing;
- failure of the authenticated session becomes an explicit application error.

Do NOT silently fall back to `OPENAI_API_KEY`.

### Why only one Codex worker replica

Do not mount the same writable Codex authentication state into multiple worker replicas and assume it is concurrency-safe.

V1 must use:

```text
codex-worker replicas = 1
```

and a request queue/concurrency limit such as:

```text
concurrency = 1
```

This is sufficient for the expected FantAsta workload and greatly simplifies authenticated-session management.

The application architecture must allow this worker strategy to be revisited later if supported authentication/session isolation permits horizontal scaling.

### Suggested Kubernetes resources

Use:

```text
StatefulSet/codex-worker
Service/codex-worker (ClusterIP)
PersistentVolumeClaim/CODEX_HOME
```

A `StatefulSet` is preferred for the Codex worker because the pod has persistent identity/storage concerns.

FantAsta itself may remain a normal stateless `Deployment`.

Example communication:

```text
FantAsta
   |
   +--> http://codex-worker:<internal-port>/ask
```

The internal endpoint must not accept arbitrary shell commands.

It should accept an application-level request such as:

```json
{
  "prompt": "Should I buy this player at this price?",
  "context": {
    "auctionId": "...",
    "currentPlayer": {},
    "budget": {},
    "roster": {}
  }
}
```

The worker then converts this into a Codex request.

### Codex worker queue

Multiple FantAsta users may request advice at almost the same time.

V1 should serialize requests:

```text
User A ----\
            +--> FantAsta --> Codex queue --> Codex worker
User B ----/
```

Queue requirements:

- FIFO is sufficient initially;
- configurable timeout;
- configurable maximum pending requests;
- clear `PROVIDER_BUSY` response if limits are exceeded;
- no cross-request prompt/context leakage;
- each response must be correlated with its originating request.

This queue is an implementation detail of the Codex provider/worker and must not leak into auction-domain logic.

---

# 38. OpenCode Integration

OpenCode must be installed on the server.

FantAsta should use the provider authentication already configured in OpenCode.

Conceptually:

```text
Server administrator
       |
       +--> opencode auth login / provider connection
                       |
                       +--> persistent OpenCode auth/config
```

FantAsta then invokes OpenCode through its supported non-interactive/server interface.

Requirements:

- use existing OpenCode authentication/configuration;
- persist OpenCode auth/config between container restarts;
- detect provider not configured;
- detect authentication errors;
- do not require FantAsta users to reauthenticate;
- do not expose OpenCode credentials/configuration to the browser;
- do not silently switch to separately configured API billing.

OpenCode may itself support different upstream providers. FantAsta should treat this as an implementation detail of `OpenCodeProvider`.

---

# 39. AI Credentials and Persistent Storage

AI authentication files must NOT be committed to Git.

Provide persistent storage such as:

```text
/data/ai/claude
/data/ai/codex
/data/ai/opencode
```

or provider-native configuration locations mapped to Docker volumes.

Docker architecture may conceptually use:

```text
fantasta
  |
  +-- persistent Claude auth/config
  +-- persistent Codex auth/config
  +-- persistent OpenCode auth/config
```

Secrets and auth files must be:

- excluded from Git;
- never returned by API routes;
- never logged;
- readable only by the relevant server process where possible.

---

# 40. AI Provider Settings Page

Admin-only settings page:

```text
Settings
  -> AI
```

Example:

```text
Claude Code
Status: Connected
Executable: claude

[Test connection]

OpenCode
Status: Connected
Executable: opencode

[Test connection]

Codex
Status: Connected
Executable: codex

[Test connection]
```

Allow selecting:

```text
Default provider:
- Claude Code
- OpenCode
- Codex
```

Never display authentication tokens.

The page should tell the administrator what server-side login command/action is required when a provider is not authenticated.

---

# 41. AI Context

The AI must receive useful auction context automatically.

The user should be able to ask:

```text
How much should I spend on this player?
```

without manually describing the entire roster.

Define a structured `AuctionContext`.

Example:

```ts
interface AuctionContext {
  auction: {
    season: string
    initialBudget: number
    remainingBudget: number
    maxBid: number
  }

  roster: {
    players: RosterPlayerContext[]
    slots: RoleSlotContext[]
  }

  currentPlayer?: PlayerContext

  targets: TargetContext[]

  availableAlternatives: PlayerContext[]

  marketAnalytics: AuctionMarketContext
}
```

Do not simply dump the entire database into the prompt.

Construct compact, relevant context.

---

# 42. AI Quick Actions

Provide useful actions in addition to free chat.

Examples:

```text
ANALYZE PLAYER
IS THIS PRICE WORTH IT?
COMPARE PLAYERS
RECOMMEND NEXT PURCHASE
ANALYZE MY ROSTER
WHERE SHOULD I SPEND?
FIND AVAILABLE VALUE
```

Every quick action must use the current auction state.

---

# 43. AI Safety / Permissions

Claude Code, OpenCode and Codex are coding agents that can potentially access tools/files.

FantAsta does NOT need those capabilities for normal auction advice.

Therefore:

- do not give unrestricted project filesystem access;
- do not allow arbitrary shell commands from user prompts;
- do not expose database credentials to the AI;
- do not let the AI write directly to PostgreSQL;
- do not let an AI answer mutate auction state automatically.

Flow:

```text
PostgreSQL
    |
FantAsta domain/services
    |
build sanitized AuctionContext
    |
AI CLI
    |
text/structured recommendation
```

State changes must continue to go through FantAsta's normal application services and authorization checks.

---

# 44. AI Invocation Concurrency

Multiple FantAsta users may ask AI questions simultaneously.

The AI provider layer must:

- handle concurrent requests intentionally;
- avoid corrupting shared CLI session files;
- enforce sensible concurrency limits;
- queue requests if a CLI/provider cannot safely handle parallel invocations;
- apply per-request timeout;
- prevent one user's prompt/context from leaking into another request.

Do not depend on an interactive shared terminal session.

Use stateless/non-interactive invocations where possible.

---

# 45. AI Failure Handling

Handle gracefully:

```text
CLI_NOT_INSTALLED
NOT_AUTHENTICATED
SESSION_EXPIRED
TIMEOUT
PROVIDER_RATE_LIMITED
PROVIDER_BUSY
INVALID_OUTPUT
PROCESS_FAILED
```

The UI should show actionable errors.

Example:

```text
Codex is installed but not authenticated.
Ask an administrator to run the Codex login on the server.
```

Do not expose raw secrets or full environment dumps in error messages.

---

# 46. AI Structured Output

Where useful, ask providers for predictable structured results.

Example internal result:

```ts
interface PlayerAdvice {
  recommendation: 'BUY' | 'WAIT' | 'PASS'
  suggestedMaxPrice?: number
  confidence?: number
  reasoning: string
  alternatives: string[]
}
```

Validate structured outputs with Zod.

If parsing fails, preserve a plain-text fallback response.

---

# 47. Realtime Collaboration

V1 does not need an unnecessarily complex realtime architecture.

However, because multiple users can share the same auction, state changes should become visible reasonably quickly.

Initial implementation options:

- SSE;
- WebSocket;
- lightweight polling.

Prefer the simplest reliable option.

Target eventual behavior:

```text
User A marks Lautaro SOLD
          |
          v
User B sees Lautaro disappear from available players
```

without a manual full-page refresh.

---

# 48. Concurrency and Transactions

Operations such as player purchase and SOLD state transitions can be executed by multiple users at nearly the same time.

Use PostgreSQL transactions and constraints so that:

- a player cannot be purchased twice;
- SOLD cannot overwrite a simultaneous valid purchase silently;
- roster state and player status stay consistent;
- event records correspond to completed operations.

Do not rely only on frontend checks.

---

# 49. UX Priorities

Desktop is the primary live-auction target, but responsive layouts are required.

Prioritize:

1. search;
2. player table;
3. budget;
4. max bid;
5. remaining slots;
6. BUY;
7. SOLD;
8. target/tier;
9. AI quick advice.

Avoid unnecessary animations and heavy page transitions.

The application should feel like a fast operational dashboard.

---

# 50. Out of Scope for V1

Do NOT build unless specifically requested later:

- complete league management;
- automatic auctioneer;
- bid timer;
- bidding between FantAsta users;
- opponent roster management;
- weekly formation management;
- matchday scoring;
- league standings;
- public user registration;
- payments;
- subscription billing;
- mobile native application;
- unrestricted AI agent access to the server.

---

# 51. Documentation

Create:

```text
README.md
AGENTS.md
docs/
```

## README.md

Must include:

- project purpose;
- stack;
- local setup;
- database setup;
- migrations;
- test commands;
- lint commands;
- Docker deployment;
- environment variables;
- AI CLI prerequisites;
- AI login persistence architecture.

## AGENTS.md

`AGENTS.md` is the **canonical and mandatory repository instruction file for coding agents**.

Create:

```text
AGENTS.md
```

Do **NOT** create:

```text
CLAUDE.md
```

This rule applies even when development is being performed with Claude Code.

The repository must remain agent-neutral so that the same development instructions are used consistently by:

- Claude Code;
- Codex;
- OpenCode;
- other compatible coding agents.

If an agent automatically suggests creating `CLAUDE.md`, it must not do so. Put project-wide agent instructions in `AGENTS.md` instead.

`AGENTS.md` must contain coding-agent rules, including:

- follow existing architecture;
- read `AGENTS.md` before starting implementation work;
- develop one feature at a time;
- add/update automated tests;
- run lint after every feature;
- run typecheck after every feature;
- run tests after every feature;
- run the build when required by the feature or release workflow;
- fix failures before proceeding;
- never commit credentials;
- use Drizzle Kit for database migrations;
- include migration files with schema-changing features;
- update documentation for architectural changes;
- update `docs/DEVELOPMENT_LOG.md` after each completed feature;
- never create `CLAUDE.md`; use `AGENTS.md` for repository instructions regardless of the active coding agent.

---

# 52. Feature Development Log

Maintain:

```text
docs/DEVELOPMENT_LOG.md
```

After each completed feature append:

```text
## Feature XX — Name

### Implemented
- ...

### Database changes
- ...

### Tests
- ...

### Validation
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS
- pnpm build: PASS / NOT REQUIRED

### Notes
- ...
```

Do not claim PASS unless the command was actually executed successfully.

This log should allow another coding agent to understand what was already implemented.

---

# 53. Suggested Implementation Order

## Phase 1 — Foundation

### Feature 01
Project bootstrap

- Nuxt
- TypeScript
- Nuxt UI
- ESLint
- formatting
- Vitest
- Docker

### Feature 02
PostgreSQL + Drizzle

### Feature 03
Authentication

### Feature 04
Auction creation and membership

---

## Phase 2 — Player Data

### Feature 05
Player domain

### Feature 06
Excel importer

### Feature 07
Player list/search/filter

### Feature 08
Player detail

---

## Phase 3 — Live Auction

### Feature 09
Roster slots

### Feature 10
Budget engine

### Feature 11
Purchase flow

### Feature 12
SOLD flow

### Feature 13
Undo/event history

### Feature 14
Multi-user synchronization

---

## Phase 4 — Preparation

### Feature 15
Targets/watchlist

### Feature 16
Tiers

### Feature 17
Target/max prices

### Feature 18
Player comparison

---

## Phase 5 — Statistics

### Feature 19
Historical stats model/import

### Feature 20
Statistics UI

### Feature 21
Auction market analytics

---

## Phase 6 — AI

### Feature 22
Generic `AiProvider` interface

### Feature 23
CodexProvider using existing Codex/ChatGPT CLI login

### Feature 24
ClaudeCodeProvider using existing Claude Code CLI login

### Feature 25
OpenCodeProvider using existing OpenCode authentication

### Feature 26
AI provider admin settings/status

### Feature 27
AuctionContext builder

### Feature 28
AI chat

### Feature 29
AI quick actions

### Feature 30
AI concurrency, timeout and error handling

Every feature in every phase must satisfy the mandatory quality gate before the next feature begins.

---

# 54. Final Engineering Requirements

The implementation must favor:

- clarity over cleverness;
- explicit domain models;
- transactional state changes;
- strong TypeScript typing;
- reusable services;
- testable business logic;
- small components;
- secure server-side AI integration;
- Kubernetes-safe AI worker isolation;
- Drizzle Kit-managed database migrations;
- one canonical `AGENTS.md` for all coding agents;
- low operational complexity.

Avoid premature microservices.

Avoid unnecessary abstractions, but use interfaces at real integration boundaries:

```text
database repositories
player data providers
statistics providers
AI providers
```

The most important product requirement is that the application remains **fast and trustworthy during an actual live Fantacalcio auction**.
