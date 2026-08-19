/**
 * Punto di ingresso del layer AI: è l'unica superficie che le route Nitro usano.
 *
 * Tutta la logica vive in `registry.ts` (verificabile senza Nitro); qui si legge
 * `runtimeConfig` e si tiene un registry per processo, perché le code di
 * concorrenza devono essere condivise da tutte le richieste (spec §44): un
 * registry nuovo a ogni chiamata renderebbe il limite di concorrenza inutile.
 */
import { useRuntimeConfig } from '#imports'
import type {
  AiProvider,
  AiProviderId,
  AiProviderStatus,
  AiResponse,
  AuctionContext,
} from '#shared/types/ai'
import { createAiRegistry } from './registry'
import type { AiRegistry, AiRuntimeConfig } from './registry'

let registry: AiRegistry | undefined

function useAiRegistry(): AiRegistry {
  if (!registry) {
    const ai = useRuntimeConfig().ai as AiRuntimeConfig
    registry = createAiRegistry(ai)
  }
  return registry
}

export function getAiProvider(id: AiProviderId): AiProvider {
  return useAiRegistry().getAiProvider(id)
}

export function listAiProviders(): AiProvider[] {
  return useAiRegistry().listAiProviders()
}

/** Non lancia mai: un provider guasto compare con `state: 'ERROR'` e `detail` sanificato. */
export async function getAllProviderStatuses(): Promise<AiProviderStatus[]> {
  return await useAiRegistry().getAllProviderStatuses()
}

/** Passa dalla coda del provider: applica concorrenza, `maxPending` e timeout. */
export async function askWithProvider(
  id: AiProviderId,
  context: AuctionContext,
  prompt: string
): Promise<AiResponse> {
  return await useAiRegistry().askWithProvider(id, context, prompt)
}

export type { AiRegistry, AiRuntimeConfig } from './registry'
