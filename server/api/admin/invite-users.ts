import { defineEventHandler, readBody } from 'h3'
import { createClient } from '@supabase/supabase-js'
import { emailRateLimiter } from '../../lib/rateLimiter'

export default defineEventHandler(async (event) => {
  try {
    // Get request body
    const body = await readBody(event)
    const { users } = body
    
    if (!users || !Array.isArray(users) || users.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid users data'
      })
    }
    
    // Get config
    const config = useRuntimeConfig()
    
    // Create a Supabase client with service role key (admin privileges)
    const supabase = createClient(
      config.public.supabaseUrl,
      config.supabaseServiceKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
    
    // Process each invitation with rate limiting
    const results = await Promise.all(
      users.map(async (user) => {
        return emailRateLimiter.addToQueue(async () => {
          try {
            const { email } = user
            
            if (!email || !email.includes('@')) {
              return { email, success: false, error: 'Invalid email' }
            }
            
            // Get the site URL from headers if not in config
            let siteUrl = config.public.siteUrl
            
            // If siteUrl is not available, construct from request origin
            if (!siteUrl) {
              const origin = event.node.req.headers.origin || event.node.req.headers.host
              if (origin) {
                // Check if it's already a URL
                if (!origin.startsWith('http')) {
                  siteUrl = `https://${origin}`
                } else {
                  siteUrl = origin
                }
              } else {
                // Default fallback
                siteUrl = 'https://claims.gibraltar.ca'
              }
            }
            
            // Construct the redirect URL safely as a string
            const redirectUrl = `${siteUrl}/signup`
            
            // Send invitation email
            const { data, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
              redirectTo: redirectUrl
            })
            
            if (inviteError) {
              return { email, success: false, error: inviteError.message }
            }
            
            // Add a users row even if empty fields so the user can update them later
            const { error: insertError } = await supabase
              .from('users')
              .upsert({
                email,
                created_at: new Date(),
                updated_at: new Date()
              })
            
            if (insertError) {
              console.error('Error inserting user record:', insertError)
              // Don't fail completely if just the insert fails
            }
            
            return { 
              email, 
              success: true, 
              message: 'Invitation sent successfully'
            }
          } catch (error) {
            console.error('Error inviting user:', error)
            return { 
              email: user.email, 
              success: false, 
              error: error.message || 'Unknown error during invitation'
            }
          }
        })
      })
    )
    
    const successCount = results.filter(r => r.success).length
    
    return { 
      success: successCount > 0,
      results,
      message: `Successfully sent ${successCount} of ${users.length} invitations`
    }
  } catch (error) {
    console.error('Error sending invitations:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to send invitations: ${error.message}`
    })
  }
}) 