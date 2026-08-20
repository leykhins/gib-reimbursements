import { toast } from '@/components/ui/toast'

export default defineNuxtRouteMiddleware(async (to) => {
  const client = useSupabaseClient()
  const user = useSupabaseUser()

  if (!user.value) {
    toast({
      title: 'Authentication Required',
      description: 'Please log in to access this page',
      variant: 'destructive'
    })
    return navigateTo('/')
  }

  try {
    const { data, error } = await client
      .from('users')
      .select('role')
      .eq('id', user.value.id)
      .single()

    if (error) throw error

    if (data.role === 'admin' || data.role === 'reviewer') {
      return
    }

    toast({
      title: 'Access Denied',
      description: 'You do not have reviewer privileges to access this page',
      variant: 'destructive'
    })

    switch (data.role) {
      case 'manager':
        return navigateTo('/m/')
      case 'accounting':
        return navigateTo('/f/')
      default:
        return navigateTo('/e/')
    }
  } catch (error) {
    console.error('Error checking reviewer status:', error)
    toast({
      title: 'Authentication Error',
      description: 'There was a problem verifying your access rights',
      variant: 'destructive'
    })
    return navigateTo('/e/')
  }
})
