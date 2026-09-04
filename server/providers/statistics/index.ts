/** Provider di statistiche stagionali: Excel storico e API-Football documentata per il live. */
export { excelStatsProvider, parseStatsWorkbook, type ExcelStatsInput } from './excel'
export { getCurrentSeasonStats } from './api-football'
export {
  extractFantacalcioPlayerLinks,
  findFantacalcioPlayerLink,
  getCachedFantacalcioStats,
  resolveFantacalcioPlayerUrl,
  syncFantacalcioStats,
  type FantacalcioPlayerLink,
} from './fantacalcio'
