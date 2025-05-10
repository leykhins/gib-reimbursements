import { defineEventHandler, readBody } from 'h3'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { 
  generateRejectionEmailContent,
  generateClaimSubmissionEmailContent,
  generateAdminVerificationEmailContent,
  generateManagerApprovalEmailContent
} from '~/lib/notifications'

export default defineEventHandler(async (event) => {
  try {
    // Get request body
    const body = await readBody(event)
    const { 
      recipientEmail, 
      recipientName, 
      claimId, 
      claimIds,
      claimDetails, 
      claimsDetails,
      notificationType,
      employeeName,
      rejectedBy, 
      rejectionReason,
      rejectorName,
      htmlContent
    } = body
    
    if (!recipientEmail) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Recipient email is required'
      })
    }

    if (notificationType === 'consolidated_submission') {
      if (!claimIds || !claimsDetails || !htmlContent) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Required fields for consolidated submission are missing'
        })
      }
    } else {
      if (!claimId || !claimDetails) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Required fields for single claim notification are missing'
        })
      }
    }
    
    // Get config
    const config = useRuntimeConfig()
    
    // Initialize Resend
    const resend = new Resend(config.resendApiKey)
    
    // Generate email HTML content based on notification type
    let emailHtmlContent
    let subject
    
    switch (notificationType) {
      case 'submission':
        emailHtmlContent = generateClaimSubmissionEmailContent(
          recipientName,
          claimDetails,
          employeeName
        )
        subject = 'New Reimbursement Claim Submitted'
        break
        
      case 'admin_verification':
        emailHtmlContent = generateAdminVerificationEmailContent(
          recipientName,
          claimDetails,
          employeeName
        )
        subject = 'Reimbursement Claim Verified by Admin'
        break
        
      case 'manager_approval':
        emailHtmlContent = generateManagerApprovalEmailContent(
          recipientName,
          claimDetails,
          employeeName
        )
        subject = 'Reimbursement Claim Approved by Manager'
        break
        
      case 'rejection':
        emailHtmlContent = generateRejectionEmailContent(
          recipientName,
          claimDetails,
          rejectionReason
        )
        subject = 'Your Reimbursement Claim Has Been Rejected'
        break
        
      case 'consolidated_submission':
        emailHtmlContent = body.htmlContent
        subject = 'New Reimbursement Claims Submitted'
        break
        
      default:
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid notification type'
        })
    }
    
    // Send email with sender name
    const { data, error } = await resend.emails.send({
      from: 'Gibraltar Reimbursement <' + config.emailFrom + '>',
      to: recipientEmail,
      subject: subject,
      html: emailHtmlContent,
    })
    
    if (error) throw error
    
    // Log to supabase notifications table for record keeping
    const supabase = createClient(config.public.supabaseUrl, config.public.supabaseKey)
    
    if (notificationType === 'consolidated_submission') {
      await Promise.all(claimIds.map(claimId => 
        supabase
          .from('email_notifications')
          .insert({
            claim_id: claimId,
            recipient_email: recipientEmail,
            notification_type: notificationType,
            sent_at: new Date().toISOString(),
            sent_by: rejectedBy || null,
            status: 'sent'
          })
      ))
    } else {
      await supabase
        .from('email_notifications')
        .insert({
          claim_id: claimId,
          recipient_email: recipientEmail,
          notification_type: notificationType,
          sent_at: new Date().toISOString(),
          sent_by: rejectedBy || null,
          status: 'sent'
        })
    }
    
    return { success: true, messageId: data?.id }
  } catch (error) {
    console.error('Error sending notification:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to send notification'
    })
  }
})
