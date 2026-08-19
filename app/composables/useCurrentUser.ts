import type { AppRole } from '#shared/types'

export interface CurrentUser {
  id: string
  email: string
  name: string
  role: AppRole
}

/**
 * `/api/me` e la fonte di verita per identita e ruolo applicativo: la sessione
 * Better Auth non porta il ruolo ADMIN, che serve a nascondere la pagina AI.
 */
export function useCurrentUser() {
  const user = useState<CurrentUser | null>('current-user', () => null)
  const loaded = useState<boolean>('current-user-loaded', () => false)
  const requestFetch = useRequestFetch()

  async function load(force = false) {
    if (loaded.value && !force) return user.value
    try {
      const res = await requestFetch<{ user: CurrentUser }>('/api/me')
      user.value = res.user
    } catch {
      user.value = null
    }
    loaded.value = true
    return user.value
  }

  function clear() {
    user.value = null
    loaded.value = true
  }

  return {
    user,
    isAdmin: computed(() => user.value?.role === 'ADMIN'),
    load,
    clear,
  }
}
