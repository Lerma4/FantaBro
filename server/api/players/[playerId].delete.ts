import { removePlayerFromListone } from '../../services/players'
import { requireAdmin } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { getUuidParam } from '../../utils/validate'

/**
 * Rimuove un giocatore dal listone.
 *
 * La rotta sta fuori da `/api/auctions/:id` di proposito: il listone è della stagione,
 * non dell'asta, quindi la cancellazione tocca tutte le aste che la condividono. Per
 * questo il permesso è il ruolo applicativo ADMIN (spec §8) e non la membership OWNER,
 * che vale solo dentro una singola asta.
 */
export default defineApiHandler(async (event) => {
  await requireAdmin(event)
  const playerId = getUuidParam(event, 'playerId')

  return removePlayerFromListone(playerId)
})
