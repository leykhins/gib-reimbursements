import { defineEventHandler, readBody } from 'h3'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { generateRejectionEmailContent } from '~/lib/notifications'

export default defineEventHandler(async (event) => {
  try {
    // Get request body
    const body = await readBody(event)
    const { 
      recipientEmail, 
      recipientName, 
      claimId, 
      claimDetails, 
      rejectedBy, 
      rejectionReason,
      rejectorName
    } = body
    
    if (!recipientEmail || !claimId || !claimDetails) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Required fields are missing'
      })
    }
    
    // Get config
    const config = useRuntimeConfig()
    
    // Initialize Resend
    const resend = new Resend(config.resendApiKey)
    
    // Generate email HTML content
    const htmlContent = generateRejectionEmailContent(
      recipientName,
      claimDetails,
      rejectionReason
    )
    
    // Send email
    const { data, error } = await resend.emails.send({
      from: config.emailFrom,
      to: recipientEmail,
      subject: 'Your Reimbursement Claim Has Been Rejected',
      html: htmlContent,
    })
    
    if (error) throw error
    
    // Log to supabase notifications table for record keeping
    const supabase = createClient(config.public.supabaseUrl, config.public.supabaseKey)
    
    await supabase
      .from('email_notifications')
      .insert({
        claim_id: claimId,
        recipient_email: recipientEmail,
        notification_type: 'rejection',
        sent_at: new Date().toISOString(),
        sent_by: rejectedBy,
        status: 'sent'
      })
    
    return { success: true, messageId: data?.id }
  } catch (error) {
    console.error('Error sending notification:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to send notification: ${error.message}`
    })
  }
})
