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
    return navigateTo('/login')
  }
  
  try {
    // Check if user is accountant or admin
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
    
    // If accountant, allow access
    if (data.role === 'accounting') {
      return
    }
    
    // If not accountant or admin, redirect to appropriate dashboard based on role
    toast({
      title: 'Access Denied',
      description: 'You do not have accounting privileges to access this page',
      variant: 'destructive'
    })
    
    switch (data.role) {
      case 'manager':
        return navigateTo('/m/')
      default:
        return navigateTo('/e/')
    }
  } catch (error) {
    console.error('Error checking accountant status:', error)
    toast({
      title: 'Authentication Error',
      description: 'There was a problem verifying your access rights',
      variant: 'destructive'
    })
    return navigateTo('/e/')
  }
}) 