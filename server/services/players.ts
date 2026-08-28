import { listAuctionIdsForSeason } from '../repositories/auctions'
import { deletePlayer, isPlayerCommitted, lockPlayer } from '../repositories/players'
import { withTransaction } from '../utils/db'
import { DomainError } from '../utils/errors'
import { publishAuctionChange } from '../utils/events'

export interface RemovePlayerResult {
  playerId: string
  season: string
}

/**
 * Cancella un giocatore dal listone. È un'operazione **globale sulla stagione**, non
 * sull'asta da cui parte la richiesta: tutte le FK verso `players` sono in cascade,
 * quindi spariscono anche statistiche, stato d'asta e target di ogni asta di quella
 * stagione. Per questo la route la riserva al ruolo applicativo ADMIN (spec §8), e per
 * questo un giocatore già impegnato viene rifiutato invece che cancellato in silenzio.
 *
 * Non è reversibile: si torna indietro solo re-importando il listone.
 */
export function removePlayerFromListone(playerId: string): Promise<RemovePlayerResult> {
  return withTransaction(async (tx) => {
    // Il lock viene prima del controllo: fra i due un acquisto concorrente non deve
    // riuscire a infilarsi (spec §48).
    const player = await lockPlayer(tx, playerId)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND')

    if (await isPlayerCommitted(tx, playerId)) throw new DomainError('PLAYER_IN_USE')

    await deletePlayer(tx, playerId)

    // `playerIds: []` è la convenzione "ricarica tutto" (vedi `utils/events`), l'unica
    // corretta per una cancellazione: non esiste più una riga da aggiornare in posto.
    for (const auctionId of await listAuctionIdsForSeason(tx, player.season)) {
      await publishAuctionChange(tx, auctionId, { playerIds: [] })
    }

    return { playerId, season: player.season }
  })
}
