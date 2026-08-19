import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importPreviewSchema } from '#shared/schemas'
import { MAX_UPLOAD_BYTES, readValidatedUpload } from '../../../server/utils/validate'

/**
 * `readValidatedUpload` e l'unico punto in cui le tre route di import leggono il body,
 * quindi e l'unica protezione applicativa sulla dimensione: Nitro 2 non ha un limite
 * globale. Se questi test passano, nessuna route puo bufferizzare un body senza limite.
 */
const headers = new Map<string, string>()
const readMultipart = vi.fn()

function xlsxPart(bytes = 64) {
  return [
    { name: 'file', filename: 'listone.xlsx', data: Buffer.alloc(bytes, 1) },
    { name: 'season', data: Buffer.from('2026/27') },
  ]
}

beforeEach(() => {
  headers.clear()
  readMultipart.mockReset()
  readMultipart.mockResolvedValue(xlsxPart())
  vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => headers.get(name))
  vi.stubGlobal('readMultipartFormData', readMultipart)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const event = {} as Parameters<typeof readValidatedUpload>[0]

describe('readValidatedUpload', () => {
  it('accetta un upload dichiarato entro il limite', async () => {
    headers.set('content-length', '2048')

    const upload = await readValidatedUpload(event, importPreviewSchema)

    expect(upload.filename).toBe('listone.xlsx')
    expect(upload.data.season).toBe('2026/27')
  })

  it.each([
    ['assente', undefined],
    ['non numerico', 'abc'],
    ['zero', '0'],
    ['oltre il limite', String(MAX_UPLOAD_BYTES + 1)],
  ])('rifiuta senza bufferizzare quando content-length e %s', async (_case, value) => {
    if (value !== undefined) headers.set('content-length', value)

    await expect(readValidatedUpload(event, importPreviewSchema)).rejects.toMatchObject({
      name: 'DomainError',
      code: 'IMPORT_INVALID_FILE',
    })

    // Il punto del controllo: il body non viene mai letto.
    expect(readMultipart).not.toHaveBeenCalled()
  })

  it('rifiuta un file che supera il limite anche se il body dichiarava meno', async () => {
    headers.set('content-length', '2048')
    readMultipart.mockResolvedValue(xlsxPart(MAX_UPLOAD_BYTES + 1))

    await expect(readValidatedUpload(event, importPreviewSchema)).rejects.toMatchObject({
      code: 'IMPORT_INVALID_FILE',
    })
  })

  it('accetta solo .xlsx', async () => {
    headers.set('content-length', '2048')
    readMultipart.mockResolvedValue([
      { name: 'file', filename: 'listone.csv', data: Buffer.alloc(8) },
    ])

    await expect(readValidatedUpload(event, importPreviewSchema)).rejects.toMatchObject({
      code: 'IMPORT_INVALID_FILE',
    })
  })
})
