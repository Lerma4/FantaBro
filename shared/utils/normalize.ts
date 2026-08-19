/**
 * Normalizzazione canonica di un nome di giocatore. **Unica** in tutto il progetto.
 *
 * Serve a tre cose che devono concordare per forza:
 *  - `players.search_name`, scritta dallo import (ricerca testo del listone);
 *  - il filtro `q` in lettura;
 *  - il match `nome del foglio statistiche -> playerId`.
 *
 * Se queste tre usassero normalizzazioni diverse, la ricerca troverebbe giocatori che
 * lo import delle statistiche non riesce ad agganciare, e viceversa: un bug silenzioso
 * che si manifesta come "statistiche mancanti" su nomi con apostrofo o accento.
 *
 * Fa quattro cose, in questo ordine:
 *  1. NFD + rimozione dei segni combinanti: `Vlahović` -> `vlahovic`;
 *  2. unificazione degli apostrofi tipografici: `D’Ambrosio` e `D'Ambrosio` collidono;
 *  3. minuscolo;
 *  4. spazi compattati e trim.
 *
 * Non dipende dalla estensione PostgreSQL `unaccent`, che su un database pulito non
 * esiste e farebbe esplodere la query in produzione.
 */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’ʼ'`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
