import { defineEventHandler, readBody } from 'h3'
import { createClient } from '@supabase/supabase-js'

// Rate limiter implementation
class RateLimiter {
  private queue: Array<() => Promise<any>> = []
  private processing = false
  private lastRequestTime = 0
  private readonly minInterval: number

  constructor(requestsPerSecond: number) {
    this.minInterval = 1000 / requestsPerSecond
  }

  async addToQueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })
      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0) {
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime
      
      if (timeSinceLastRequest < this.minInterval) {
        await new Promise(resolve => 
          setTimeout(resolve, this.minInterval - timeSinceLastRequest)
        )
      }

      const task = this.queue.shift()
      if (task) {
        this.lastRequestTime = Date.now()
        await task()
      }
    }

    this.processing = false
  }
}

// Create rate limiter instance
const emailRateLimiter = new RateLimiter(2)

export default defineEventHandler(async (event) => {
  try {
    // Get request body
    const body = await readBody(event)
    const { users } = body
    
    if (!Array.isArray(users)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Users must be an array'
      })
    }
    
    const config = useRuntimeConfig()
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

    // Process invitations with rate limiting
    const results = await Promise.all(
      users.map(user => 
        emailRateLimiter.addToQueue(async () => {
          try {
            const { email } = user
            
            if (!email || !email.includes('@')) {
              return { email, success: false, error: 'Invalid email' }
            }

            // Get the site URL from headers if not in config
            let siteUrl = config.public.siteUrl
            
            if (!siteUrl) {
              const origin = event.node.req.headers.origin || event.node.req.headers.host
              if (origin) {
                siteUrl = origin.startsWith('http') ? origin : `https://${origin}`
              } else {
                siteUrl = 'https://claims.gibraltar.ca'
              }
            }
            
            const redirectUrl = `${siteUrl}/signup`
            
            // Send invitation email
            const { data, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
              redirectTo: redirectUrl
            })
            
            if (inviteError) {
              return { email, success: false, error: inviteError.message }
            }
            
            // Add a users row
            const { error: insertError } = await supabase
              .from('users')
              .upsert({
                email,
                created_at: new Date(),
                updated_at: new Date()
              })
            
            if (insertError) {
              console.error('Error inserting user record')
            }
            
            return { 
              email, 
              success: true, 
              message: 'Invitation sent successfully'
            }
          } catch (error) {
            console.error('Error inviting user')
            return { 
              email: user.email, 
              success: false, 
              error: 'Unknown error during invitation'
            }
          }
        })
      )
    )
    
    const successCount = results.filter(r => r.success).length
    
    return { 
      success: successCount > 0,
      results,
      message: `Successfully sent ${successCount} of ${users.length} invitations`
    }
  } catch (error) {
    console.error('Error sending invitations')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to send invitations'
    })
  }
}) 