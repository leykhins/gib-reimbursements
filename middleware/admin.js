import { toast } from '@/components/ui/toast'

export default defineNuxtRouteMiddleware(async (to) => {
  const client = useSupabaseClient()
  const user = useSupabaseUser()
  
  // If no user, redirect to login
  if (!user.value) {
    toast({
      title: 'Authentication Required',
      description: 'Please log in to access this page',
      variant: 'destructive'
    })
    return navigateTo('/')
  }
  
  try {
    // Check if user is admin
    const { data, error } = await client
      .from('users')
      .select('role')
      .eq('id', user.value.id)
      .single()
    
    if (error) throw error
    
    // If admin, allow access to all routes temporarily
    // This means admin middleware won't block any access
    if (data.role === 'admin') {
      return
    }
    
    // For non-admin users, redirect to appropriate dashboard based on role
    toast({
      title: 'Access Denied',
      description: 'You do not have admin privileges to access this page',
      variant: 'destructive'
    })
    
    switch (data.role) {
      case 'manager':
        return navigateTo('/m/')
      case 'accountant':
        return navigateTo('/f/')
      default:
        return navigateTo('/e/')
    }
  } catch (error) {
    console.error('Error checking admin status:', error)
    toast({
      title: 'Authentication Error',
      description: 'There was a problem verifying your access rights',
      variant: 'destructive'
    })
    return navigateTo('/e/')
  }
}) 