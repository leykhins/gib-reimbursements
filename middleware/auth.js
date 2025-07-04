import { createServerClient } from '@supabase/ssr'
import { parse } from 'cookie'
import { toast } from '@/components/ui/toast'

export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  
  // If no user and not on login page, redirect to login
  if (!user.value && to.path !== '/login') {
    toast({
      title: 'Authentication Required',
      description: 'Please log in to access this page',
      variant: 'destructive'
    })
    return navigateTo('/')
  }
  
  // If user and on login page, redirect to employee dashboard
  // if (user.value && to.path === '/login') {
  //   return navigateTo('/e/')
  // }
}) 