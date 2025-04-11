import { createServerClient } from '@supabase/ssr'
import { parse } from 'cookie'

// This is a workaround for the missing export issue
export { parse }

export default defineNuxtRouteMiddleware((to, from) => {
  // Your middleware logic here if needed
})
