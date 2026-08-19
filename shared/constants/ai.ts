export const AI_PROVIDER_IDS = ['claude-code', 'opencode', 'codex'] as const

export const AI_PROVIDER_STATES = [
  'AVAILABLE',
  'NOT_INSTALLED',
  'NOT_AUTHENTICATED',
  'ERROR',
] as const

export const AI_QUICK_ACTIONS = [
  'ANALYZE_PLAYER',
  'IS_PRICE_WORTH_IT',
  'COMPARE_PLAYERS',
  'RECOMMEND_NEXT_PURCHASE',
  'ANALYZE_MY_ROSTER',
  'WHERE_SHOULD_I_SPEND',
  'FIND_AVAILABLE_VALUE',
] as const

export const AI_RECOMMENDATIONS = ['BUY', 'WAIT', 'PASS'] as const

export const DEFAULT_AI_TIMEOUT_MS = 120_000
