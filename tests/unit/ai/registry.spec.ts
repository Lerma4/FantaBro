import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_PROVIDER_IDS } from '#shared/constants/ai'
import { createAiRegistry } from '../../../server/providers/ai/registry'
import type { AiRuntimeConfig } from '../../../server/providers/ai/registry'
import { auctionContext } from './helpers/context'
import { fakeSpawn } from './helpers/fake-spawn'

// Nessuna CLI reale: `vi.mock` viene comunque issato sopra gli import da Vitest.
vi.mock('node:child_process', async () => {
  const { fakeSpawn } = await import('./helpers/fake-spawn')
  return { spawn: fakeSpawn.spawn }
})

const context = auctionContext()

function config(overrides: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    timeoutMs: 2000,
    maxPending: 8,
    claudeBin: 'claude',
    opencodeBin: 'opencode',
    codexBin: 'codex',
    codexWorkerUrl: '',
    ...overrides,
  }
}

beforeEach(() => {
  fakeSpawn.reset()
})

describe('createAiRegistry', () => {
  it('registra esattamente i provider dichiarati nel contratto condiviso', () => {
    const registry = createAiRegistry(config())

    expect(registry.listAiProviders().map((p) => p.id)).toEqual([...AI_PROVIDER_IDS])
  })

  it('restituisce il provider richiesto', () => {
    const registry = createAiRegistry(config())

    for (const id of AI_PROVIDER_IDS) {
      expect(registry.getAiProvider(id).id).toBe(id)
    }
  })

  it('usa il nome del file come `executable`, mai il path completo', async () => {
    // Spec §40: la pagina impostazioni non deve rivelare il layout del server.
    const registry = createAiRegistry(config({ claudeBin: '/opt/tools/bin/claude' }))
    fakeSpawn.queue({ errorCode: 'ENOENT' }, { errorCode: 'ENOENT' }, { errorCode: 'ENOENT' })

    const statuses = await registry.getAllProviderStatuses()

    expect(statuses.find((s) => s.id === 'claude-code')?.executable).toBe('claude')
  })

  it('getAllProviderStatuses non lancia e copre tutti i provider', async () => {
    const registry = createAiRegistry(config())
    fakeSpawn.queue({ errorCode: 'ENOENT' }, { errorCode: 'ENOENT' }, { errorCode: 'ENOENT' })

    const statuses = await registry.getAllProviderStatuses()

    expect(statuses.map((s) => s.id).sort()).toEqual([...AI_PROVIDER_IDS].sort())
    expect(statuses.every((s) => s.state === 'NOT_INSTALLED')).toBe(true)
    expect(statuses.every((s) => typeof s.checkedAt === 'string')).toBe(true)
  })

  it('un provider che lancia in modo sincrono non rompe getAllProviderStatuses', async () => {
    // Un `getStatus()` non-`async` che valida e lancia, lancia *prima* di
    // restituire una Promise: dentro un `.map()` farebbe esplodere l'intera
    // route AI con un 500 invece di mostrare tre righe di stato.
    const registry = createAiRegistry(config())
    const claude = registry.listAiProviders().find((p) => p.id === 'claude-code')
    if (!claude) throw new Error('provider claude-code assente dal registry')
    claude.getStatus = () => {
      throw new Error('boom sincrono prima di qualunque await')
    }
    fakeSpawn.queue({ errorCode: 'ENOENT' }, { errorCode: 'ENOENT' })

    const statuses = await registry.getAllProviderStatuses()

    expect(statuses).toHaveLength(3)
    expect(statuses.find((s) => s.id === 'claude-code')).toMatchObject({
      state: 'ERROR',
      executable: 'claude',
    })
    // Gli altri due restano interrogabili: un provider rotto non li trascina giù.
    expect(statuses.filter((s) => s.state === 'NOT_INSTALLED')).toHaveLength(2)
  })

  it('askWithProvider passa dalla coda del provider', async () => {
    // `maxPending: 0` significa "non accodare": la seconda richiesta simultanea
    // deve essere rifiutata con PROVIDER_BUSY invece di aspettare (spec §44).
    const registry = createAiRegistry(config({ maxPending: 0 }))
    fakeSpawn.queue({ stdout: 'Passa.', code: 0, delayMs: 40 })

    const first = registry.askWithProvider('claude-code', context, 'Conviene?')
    const second = registry
      .askWithProvider('claude-code', context, 'E lui?')
      .catch((error: unknown) => error)

    await expect(first).resolves.toMatchObject({ providerId: 'claude-code', text: 'Passa.' })
    expect(await second).toMatchObject({ code: 'PROVIDER_BUSY' })
  })

  it('le code sono per provider: uno occupato non blocca gli altri', async () => {
    const registry = createAiRegistry(config({ maxPending: 0 }))
    fakeSpawn.queue(
      { stdout: 'Claude dice passa.', code: 0, delayMs: 40 },
      { stdout: 'OpenCode dice compra.', code: 0 }
    )

    const claudeAnswer = registry.askWithProvider('claude-code', context, 'Conviene?')
    const opencodeAnswer = registry.askWithProvider('opencode', context, 'Conviene?')

    expect(await opencodeAnswer).toMatchObject({ providerId: 'opencode' })
    expect(await claudeAnswer).toMatchObject({ providerId: 'claude-code' })
  })

  it('accoda di nuovo dopo che la richiesta precedente è finita', async () => {
    const registry = createAiRegistry(config({ maxPending: 0 }))
    fakeSpawn.queue({ stdout: 'prima', code: 0 }, { stdout: 'seconda', code: 0 })

    await expect(registry.askWithProvider('claude-code', context, 'A?')).resolves.toMatchObject({
      text: 'prima',
    })
    await expect(registry.askWithProvider('claude-code', context, 'B?')).resolves.toMatchObject({
      text: 'seconda',
    })
  })
})
