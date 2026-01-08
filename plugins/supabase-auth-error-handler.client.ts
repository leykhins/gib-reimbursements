export default defineNuxtPlugin(() => {
  if (process.server) return // Only run on client side

  const supabase = useSupabaseClient()
  const router = useRouter()

  // Listen for auth state changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    // Handle token refresh failures - if token refresh fails, session will be null
    if (event === 'TOKEN_REFRESHED' && !session) {
      // Token refresh failed, user will be signed out automatically
      const currentPath = router.currentRoute.value.path
      const isPublicPage = ['/login', '/', '/signup', '/request_password_reset', '/reset_password', '/confirm'].includes(currentPath)
      
      if (!isPublicPage) {
        // Redirect to login if on a protected page
        await router.push('/login')
      }
    }
  })
})

