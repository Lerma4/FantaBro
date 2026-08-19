/** Arrotondamento a 1 decimale: formato dei valori derivati mostrati in UI. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 2 decimali: serve ai rapporti, dove 1.25 e 1.3 si leggono in modo diverso. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
