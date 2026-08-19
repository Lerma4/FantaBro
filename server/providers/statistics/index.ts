/**
 * Provider di statistiche stagionali (spec 14). Solo Excel: nessun endpoint di terze
 * parti non documentato, l'import manuale resta la strada garantita.
 */
export { excelStatsProvider, parseStatsWorkbook, type ExcelStatsInput } from './excel'
