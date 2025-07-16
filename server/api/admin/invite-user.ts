import { defineEventHandler, readBody } from 'h3'
import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  try {
    // Get request body
    const body = await readBody(event)
    const { email, firstName, lastName, role } = body
    
    if (!email || !role) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Email and role are required'
      })
    }
    
    // Get config
    const config = useRuntimeConfig()
    
    // Initialize Supabase admin client with service role key
    // This requires the SUPABASE_SERVICE_KEY environment variable to be set
    const supabase = createClient(
      config.public.supabaseUrl,
      config.supabaseServiceKey, // Admin/service role key
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
    
    // Generate a secure URL with the email embedded
    const signupUrl = new URL(`${config.public.appUrl}/signup`)
    signupUrl.searchParams.append('email', encodeURIComponent(email))
    
    // Send invite email via Supabase Auth API
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: signupUrl.toString()
    })
    
    if (error) throw error
    
    // Insert a record into the users table
    const { error: insertError } = await supabase
      .from('users')
      .insert({
        email,
        first_name: firstName || '',
        last_name: lastName || '',
        role
      })
    
    if (insertError) {
      // If user table insert fails, log but don't fail the entire operation
      console.error('Error inserting user record')
    }
    
    return { success: true, message: 'Invitation sent successfully' }
  } catch (error) {
    console.error('Error sending invitation')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to send invitation'
    })
  }
}) 