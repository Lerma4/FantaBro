import {
  type SQL,
  and,
  asc,
  count,
  eq,
  exists,
  gte,
  inArray,
  like,
  lte,
  max,
  or,
  sql,
} from 'drizzle-orm'
import type { PlayerListFilter } from '#shared/schemas'
import type { AuctionPlayerStatus, ParsedPlayer, Player, PlayerRow } from '#shared/types'
import { normalizeName } from '#shared/utils/normalize'
import {
  auctionPlayers,
  auctions,
  playerSeasonStats,
  playerTargets,
  players,
  rosterPlayers,
  rosters,
} from '../database/schema'
import type { DbOrTx } from '../utils/db'

/**
 * Importa/aggiorna il listone di una stagione.
 *
 * La chiave di dedup è `(season, name, team)` (spec §11: gli id esterni non sono
 * stabili). Il flag `xmax = 0` è il modo standard in PostgreSQL per capire, in
 * un `INSERT ... ON CONFLICT`, quali righe sono state inserite e quali aggiornate.
 */
export async function upsertPlayers(
  db: DbOrTx,
  season: string,
  input: ParsedPlayer[]
): Promise<{ inserted: number; updated: number; playerIds: string[] }> {
  if (input.length === 0) return { inserted: 0, updated: 0, playerIds: [] }

  // `ON CONFLICT DO UPDATE` non può colpire due volte la stessa riga nella
  // stessa istruzione: teniamo l'ultima occorrenza di ogni chiave naturale.
  const byKey = new Map<string, ParsedPlayer>()
  for (const player of input) byKey.set(`${player.name}\u0000${player.team}`, player)

  const now = new Date()
  const rows = await db
    .insert(players)
    .values(
      [...byKey.values()].map((player) => ({
        externalId: player.externalId,
        name: player.name,
        searchName: normalizeName(player.name),
        team: player.team,
        role: player.role,
        mantraRole: player.mantraRole,
        quotation: Math.round(player.quotation),
        fvm: Math.round(player.fvm),
        season,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [players.season, players.name, players.team],
      set: {
        externalId: sql`excluded.external_id`,
        searchName: sql`excluded.search_name`,
        role: sql`excluded.role`,
        mantraRole: sql`excluded.mantra_role`,
        quotation: sql`excluded.quotation`,
        fvm: sql`excluded.fvm`,
        updatedAt: now,
      },
    })
    .returning({ id: players.id, inserted: sql<boolean>`xmax = 0` })

  const inserted = rows.filter((row) => row.inserted).length
  return { inserted, updated: rows.length - inserted, playerIds: rows.map((row) => row.id) }
}

export async function findPlayerById(db: DbOrTx, playerId: string): Promise<Player | null> {
  const [row] = await db.select().from(players).where(eq(players.id, playerId)).limit(1)
  return row ?? null
}

/**
 * Lock esclusivo sulla riga di listone, per la cancellazione (spec §48).
 *
 * `for update` e non `for no key update`: qui il fatto che un `FOR UPDATE` blocchi
 * anche gli insert che referenziano la riga (la verifica di FK prende `FOR KEY SHARE`,
 * in conflitto con `FOR UPDATE`) e' esattamente l'effetto voluto. Senza, un acquisto
 * concorrente potrebbe committare fra il controllo di `isPlayerCommitted` e la
 * `DELETE`, e la cascata si porterebbe via la riga di rosa appena creata, in silenzio.
 *
 * Va chiamata dentro una transazione, altrimenti il lock e' rilasciato subito.
 */
export async function lockPlayer(db: DbOrTx, playerId: string): Promise<Player | null> {
  const [row] = await db
    .select()
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1)
    .for('update')
  return row ?? null
}

/**
 * Il giocatore e' impegnato da almeno un'asta: comprato in rosa, oppure segnato
 * venduto ad altri. Le FK verso `players` sono tutte in cascade, quindi cancellarlo
 * dal listone cancellerebbe anche quell'acquisto o quel SOLD senza lasciare traccia,
 * falsando budget e analytics di mercato. Meglio rifiutare: l'annullo dell'operazione
 * d'asta esiste gia' ed e' reversibile, la cancellazione dal listone no.
 */
export async function isPlayerCommitted(db: DbOrTx, playerId: string): Promise<boolean> {
  const [inRoster] = await db
    .select({ playerId: rosterPlayers.playerId })
    .from(rosterPlayers)
    .where(eq(rosterPlayers.playerId, playerId))
    .limit(1)
  if (inRoster) return true

  const [sold] = await db
    .select({ playerId: auctionPlayers.playerId })
    .from(auctionPlayers)
    .where(and(eq(auctionPlayers.playerId, playerId), eq(auctionPlayers.status, 'SOLD')))
    .limit(1)
  return sold !== undefined
}

/** Cancella una riga di listone. `false` se non c'era piu' nulla da cancellare. */
export async function deletePlayer(db: DbOrTx, playerId: string): Promise<boolean> {
  const rows = await db
    .delete(players)
    .where(eq(players.id, playerId))
    .returning({ id: players.id })
  return rows.length > 0
}

/**
 * Riepilogo del listone di una stagione: quanti giocatori e quando sono stati
 * scritti l'ultima volta. Serve alla pagina di import per dire cosa c'e gia dentro.
 */
export async function summarizeListone(
  db: DbOrTx,
  season: string
): Promise<{ total: number; updatedAt: string | null }> {
  const [row] = await db
    .select({ total: count(), updatedAt: max(players.updatedAt) })
    .from(players)
    .where(eq(players.season, season))

  return { total: row?.total ?? 0, updatedAt: row?.updatedAt?.toISOString() ?? null }
}

/**
 * Quanti giocatori della stagione sono impegnati in una qualsiasi asta. Stesse due
 * condizioni di `isPlayerCommitted`, applicate all'intera stagione: e il controllo che
 * blocca la cancellazione in blocco del listone.
 */
export async function countCommittedForSeason(db: DbOrTx, season: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(players)
    .where(
      and(
        eq(players.season, season),
        or(
          exists(
            db
              .select({ one: sql`1` })
              .from(rosterPlayers)
              .where(eq(rosterPlayers.playerId, players.id))
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(auctionPlayers)
              .where(
                and(eq(auctionPlayers.playerId, players.id), eq(auctionPlayers.status, 'SOLD'))
              )
          )
        )
      )
    )

  return row?.total ?? 0
}

/** Cancella l'intero listone di una stagione. Ritorna quante righe sono sparite. */
export async function deletePlayersForSeason(db: DbOrTx, season: string): Promise<number> {
  const rows = await db
    .delete(players)
    .where(eq(players.season, season))
    .returning({ id: players.id })
  return rows.length
}

export async function countPlayersForSeason(db: DbOrTx, season: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(players).where(eq(players.season, season))
  return row?.total ?? 0
}

export async function listTeams(db: DbOrTx, season: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ team: players.team })
    .from(players)
    .where(eq(players.season, season))
    .orderBy(asc(players.team))
  return rows.map((row) => row.team)
}

/** `%` e `_` digitati dall'utente non devono diventare wildcard. */
function likePattern(term: string): string {
  return `%${normalizeName(term).replace(/[\\%_]/g, '\\$&')}%`
}

/**
 * Query del listone: `players` + statistiche della stagione richiesta + stato
 * d'asta + target + rosa. `count(*) over ()` restituisce il totale prima della
 * paginazione senza una seconda query.
 */
function playerRowsQuery(db: DbOrTx, auctionId: string, statsSeason: string | null) {
  return db
    .select({
      playerId: players.id,
      name: players.name,
      team: players.team,
      role: players.role,
      mantraRole: players.mantraRole,
      quotation: players.quotation,
      fvm: players.fvm,
      status: sql<AuctionPlayerStatus>`coalesce(${auctionPlayers.status}, 'AVAILABLE')`,
      soldPrice: auctionPlayers.soldPrice,
      otherTeamName: auctionPlayers.otherTeamName,
      purchasePrice: rosterPlayers.purchasePrice,
      statsSeason: playerSeasonStats.season,
      appearances: playerSeasonStats.appearances,
      averageRating: playerSeasonStats.averageRating,
      fantasyAverage: playerSeasonStats.fantasyAverage,
      goals: playerSeasonStats.goals,
      assists: playerSeasonStats.assists,
      tier: playerTargets.tier,
      targetPrice: playerTargets.targetPrice,
      maxPrice: playerTargets.maxPrice,
      priority: playerTargets.priority,
      isTarget: sql<boolean>`coalesce(${playerTargets.isTarget}, false)`,
      notes: playerTargets.notes,
      // `mapWith(Number)`: PostgreSQL restituisce i bigint come stringa.
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(players)
    .leftJoin(
      playerSeasonStats,
      statsSeason
        ? and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, statsSeason))
        : sql`false`
    )
    .leftJoin(
      auctionPlayers,
      and(eq(auctionPlayers.playerId, players.id), eq(auctionPlayers.auctionId, auctionId))
    )
    .leftJoin(
      playerTargets,
      and(eq(playerTargets.playerId, players.id), eq(playerTargets.auctionId, auctionId))
    )
    .leftJoin(rosters, eq(rosters.auctionId, auctionId))
    .leftJoin(
      rosterPlayers,
      and(eq(rosterPlayers.rosterId, rosters.id), eq(rosterPlayers.playerId, players.id))
    )
}

/** L'asta lavora sempre e solo sui giocatori della propria stagione. */
function auctionSeasonCondition(db: DbOrTx, auctionId: string): SQL {
  return inArray(
    players.season,
    db.select({ season: auctions.season }).from(auctions).where(eq(auctions.id, auctionId))
  )
}

function filterConditions(filter: PlayerListFilter): SQL[] {
  const conditions: SQL[] = []
  if (filter.q) conditions.push(like(players.searchName, likePattern(filter.q)))
  // `ALL` significa nessun filtro di stato; senza riga in auction_players il
  // giocatore è AVAILABLE.
  if (filter.status !== 'ALL') {
    conditions.push(sql`coalesce(${auctionPlayers.status}, 'AVAILABLE') = ${filter.status}`)
  }
  if (filter.role?.length) conditions.push(inArray(players.role, filter.role))
  if (filter.team?.length) conditions.push(inArray(players.team, filter.team))
  if (filter.tier?.length) conditions.push(inArray(playerTargets.tier, filter.tier))
  if (filter.onlyTargets) conditions.push(eq(playerTargets.isTarget, true))
  if (filter.quotationMin !== undefined) {
    conditions.push(gte(players.quotation, filter.quotationMin))
  }
  if (filter.quotationMax !== undefined) {
    conditions.push(lte(players.quotation, filter.quotationMax))
  }
  if (filter.fvmMin !== undefined) conditions.push(gte(players.fvm, filter.fvmMin))
  if (filter.fvmMax !== undefined) conditions.push(lte(players.fvm, filter.fvmMax))
  if (filter.averageRatingMin !== undefined) {
    conditions.push(gte(playerSeasonStats.averageRating, filter.averageRatingMin))
  }
  if (filter.averageRatingMax !== undefined) {
    conditions.push(lte(playerSeasonStats.averageRating, filter.averageRatingMax))
  }
  if (filter.fantasyAverageMin !== undefined) {
    conditions.push(gte(playerSeasonStats.fantasyAverage, filter.fantasyAverageMin))
  }
  if (filter.fantasyAverageMax !== undefined) {
    conditions.push(lte(playerSeasonStats.fantasyAverage, filter.fantasyAverageMax))
  }
  if (filter.appearancesMin !== undefined) {
    conditions.push(gte(playerSeasonStats.appearances, filter.appearancesMin))
  }
  return conditions
}

/** `nulls last`: chi non ha statistiche non deve occupare la testa della lista. */
function orderExpression(filter: PlayerListFilter): SQL {
  const column = {
    name: players.name,
    quotation: players.quotation,
    fvm: players.fvm,
    averageRating: playerSeasonStats.averageRating,
    fantasyAverage: playerSeasonStats.fantasyAverage,
    appearances: playerSeasonStats.appearances,
    priority: playerTargets.priority,
  }[filter.sort]
  return filter.dir === 'asc' ? sql`${column} asc nulls last` : sql`${column} desc nulls last`
}

function stripTotal({ total: _total, ...row }: PlayerRow & { total: number }): PlayerRow {
  return row
}

export async function listPlayerRows(
  db: DbOrTx,
  auctionId: string,
  filter: PlayerListFilter,
  statsSeason: string | null
): Promise<{ rows: PlayerRow[]; total: number }> {
  const conditions = [auctionSeasonCondition(db, auctionId), ...filterConditions(filter)]
  const filtered = () =>
    playerRowsQuery(db, auctionId, statsSeason)
      .where(and(...conditions))
      .orderBy(orderExpression(filter), asc(players.name))

  const rows = await filtered().limit(filter.limit).offset(filter.offset)
  let total = rows[0]?.total ?? 0
  if (rows.length === 0 && filter.offset > 0) {
    // Offset oltre la fine: `count(*) over ()` non torna su zero righe.
    const [probe] = await filtered().limit(1)
    total = probe?.total ?? 0
  }
  return { rows: rows.map(stripTotal), total }
}

export async function findPlayerRows(
  db: DbOrTx,
  auctionId: string,
  playerIds: string[],
  statsSeason: string | null
): Promise<PlayerRow[]> {
  if (playerIds.length === 0) return []
  const rows = await playerRowsQuery(db, auctionId, statsSeason)
    .where(and(auctionSeasonCondition(db, auctionId), inArray(players.id, playerIds)))
    .orderBy(asc(players.name))
  return rows.map(stripTotal)
}
