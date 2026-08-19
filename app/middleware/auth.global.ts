export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const { user, load } = useCurrentUser()
  if (user.value ?? (await load())) return

  return navigateTo({
    path: '/login',
    query: to.fullPath === '/' ? undefined : { redirect: to.fullPath },
  })
})
