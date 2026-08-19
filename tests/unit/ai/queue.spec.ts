import { describe, expect, it } from 'vitest'
import { AiProviderError } from '#shared/types/ai'
import { TaskQueue } from '../../../server/providers/ai/queue'

/** Task che resta appeso finché non lo si apre: serve a occupare uno slot. */
function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = () => r()
  })
  return { promise, resolve }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('TaskQueue', () => {
  it('serializza davvero con concurrency 1', async () => {
    // I file di sessione delle CLI non sono concurrency-safe: due invocazioni
    // non devono mai sovrapporsi (spec §37, §44).
    const queue = new TaskQueue({ concurrency: 1, maxPending: 10, timeoutMs: 5000 })
    let running = 0
    let maxRunning = 0

    const task = async (): Promise<void> => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await sleep(20)
      running -= 1
    }

    await Promise.all([queue.run(task), queue.run(task), queue.run(task)])

    expect(maxRunning).toBe(1)
  })

  it('rispetta l’ordine di arrivo', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 10, timeoutMs: 5000 })
    const order: number[] = []

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        queue.run(async () => {
          await sleep(5)
          order.push(n)
        })
      )
    )

    expect(order).toEqual([1, 2, 3, 4])
  })

  it('correla ogni risposta alla propria richiesta', async () => {
    // Spec §44: il prompt/contesto di un utente non deve finire nella risposta
    // di un altro. Con richieste concorrenti ognuna deve riavere il proprio.
    const queue = new TaskQueue({ concurrency: 1, maxPending: 10, timeoutMs: 5000 })
    const prompts = ['Lautaro', 'Maignan', 'Bastoni', 'Pulisic']

    const results = await Promise.all(
      prompts.map((prompt) =>
        queue.run(async () => {
          await sleep(Math.random() * 10)
          return `risposta per ${prompt}`
        })
      )
    )

    expect(results).toEqual(prompts.map((p) => `risposta per ${p}`))
  })

  it('risponde PROVIDER_BUSY oltre maxPending', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 2, timeoutMs: 5000 })
    const slot = gate()

    // 1 in esecuzione + 2 in attesa = limite raggiunto.
    const inFlight = [
      queue.run(() => slot.promise),
      queue.run(() => slot.promise),
      queue.run(() => slot.promise),
    ]
    expect(queue.stats).toEqual({ active: 1, pending: 2 })

    const error = await queue.run(async () => 'quarta').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiProviderError)
    expect((error as AiProviderError).code).toBe('PROVIDER_BUSY')

    slot.resolve()
    await Promise.all(inFlight)
  })

  it('accoda di nuovo dopo che la coda si è svuotata', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 1, timeoutMs: 5000 })
    const slot = gate()

    const first = queue.run(() => slot.promise)
    const second = queue.run(async () => 'seconda')
    await expect(queue.run(async () => 'terza')).rejects.toMatchObject({ code: 'PROVIDER_BUSY' })

    slot.resolve()
    await Promise.all([first, second])

    await expect(queue.run(async () => 'ora si può')).resolves.toBe('ora si può')
  })

  it('applica il timeout anche a chi è ancora in attesa in coda', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 10, timeoutMs: 40 })
    const slot = gate()
    let secondStarted = false

    // Il primo occupa l'unico slot e non finisce; il secondo resta in attesa.
    // I gestori di rifiuto vanno attaccati subito: entrambi scadono allo stesso
    // istante e una promise rifiutata senza handler risulterebbe non gestita.
    const blocking = queue.run(() => slot.promise).catch((error: unknown) => error)
    const waiting = queue
      .run(async () => {
        secondStarted = true
        return 'mai'
      })
      .catch((error: unknown) => error)

    expect(await waiting).toMatchObject({ code: 'TIMEOUT' })
    // Scaduto mentre era in coda: non deve nemmeno partire.
    expect(secondStarted).toBe(false)

    // Il timeout copre attesa *e* esecuzione: anche chi era in esecuzione scade.
    expect(await blocking).toMatchObject({ code: 'TIMEOUT' })

    slot.resolve()
  })

  it('propaga l’errore del task senza inquinare gli altri', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 10, timeoutMs: 5000 })

    const results = await Promise.allSettled([
      queue.run(async () => {
        throw new AiProviderError('PROCESS_FAILED', 'boom')
      }),
      queue.run(async () => 'ok'),
    ])

    expect(results[0]).toMatchObject({ status: 'rejected' })
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: 'ok' })
    // Uno slot liberato correttamente anche in caso di errore.
    expect(queue.stats).toEqual({ active: 0, pending: 0 })
  })
})
