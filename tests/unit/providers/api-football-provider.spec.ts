import { describe, expect, it } from 'vitest'
import { selectTeamStats } from '../../../server/providers/statistics/api-football'

describe('apiFootballStatsProvider', () => {
  it('seleziona le statistiche della squadra del listone anche con nomi equivalenti', () => {
    const stats = selectTeamStats(
      [
        {
          statistics: [
            {
              team: { id: 505, name: 'Inter Milan' },
              games: { appearences: 3, minutes: 220, rating: '7.1' },
              goals: { total: 1, assists: 2 },
            },
          ],
        },
      ],
      'Inter'
    )

    expect(stats?.team.id).toBe(505)
  })
})
