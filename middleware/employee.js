import { toast } from '@/components/ui/toast'

export default defineNuxtRouteMiddleware(async (to) => {
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
  
  // All authenticated users can access employee routes
  return
}) 