import type { PlayerDataProvider } from '#shared/types'
import { excelPlayerProvider } from './excel'

/**
 * Punto di estensione per i provider di dati giocatori (spec 14).
 * L'import manuale da Excel resta sempre disponibile; nessun provider verso endpoint
 * di terze parti non documentati.
 */
const providers: Record<string, PlayerDataProvider> = {
  [excelPlayerProvider.id]: excelPlayerProvider,
}

export const DEFAULT_PLAYER_DATA_PROVIDER_ID = 'excel'

export function getPlayerDataProvider(id = DEFAULT_PLAYER_DATA_PROVIDER_ID): PlayerDataProvider {
  const provider = providers[id]
  if (!provider) throw new Error(`unknown player data provider: ${id}`)
  return provider
}

export { excelPlayerProvider }
export { ImportFileError } from './worksheet'
