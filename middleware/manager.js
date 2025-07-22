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
    // Check if user is manager or admin
    const { data, error } = await client
      .from('users')
      .select('role')
      .eq('id', user.value.id)
      .single()
    
    if (error) throw error
    
    // If admin, always allow access without redirection
    if (data.role === 'admin') {
      return
    }
    
    // If manager, allow access
    if (data.role === 'manager') {
      return
    }
    
    // If not manager or admin, redirect to appropriate dashboard based on role
    toast({
      title: 'Access Denied',
      description: 'You do not have manager privileges to access this page',
      variant: 'destructive'
    })
    
    switch (data.role) {
      case 'accountant':
        return navigateTo('/f/')
      default:
        return navigateTo('/e/')
    }
  } catch (error) {
    console.error('Error checking manager status:', error)
    toast({
      title: 'Authentication Error',
      description: 'There was a problem verifying your access rights',
      variant: 'destructive'
    })
    return navigateTo('/e/')
  }
}) 