import { importPreviewSchema } from '#shared/schemas'
import { previewImport } from '../../../../services/import'
import { DomainError, defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedUpload } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction } = await requireAuctionAccess(event, auctionId, 'EDITOR')

  const upload = await readValidatedUpload(event, importPreviewSchema)

  // Il listone deve essere della stagione dell'asta: importarne un'altra mescolerebbe
  // stagioni diverse nella stessa asta (spec 12).
  if (upload.data.season !== auction.season) {
    throw new DomainError('VALIDATION_FAILED', [{ path: 'season', code: 'season_mismatch' }])
  }

  return previewImport({
    buffer: upload.buffer,
    mapping: upload.data.mapping,
    sheet: upload.data.sheet,
  })
})
