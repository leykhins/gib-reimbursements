import { defineEventHandler, readBody } from 'h3'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { 
  generateRejectionEmailContent,
  generateClaimSubmissionEmailContent,
  generateAdminVerificationEmailContent,
  generateManagerApprovalEmailContent,
  generateClaimProcessedEmailContent,
  generateEmployeeVerificationEmailContent,
  generateEmployeeApprovalEmailContent,
  generateEmployeeSubmissionConfirmationContent,
  formatDate,
  formatCurrency
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

    // Enhanced validation logic for different notification types
    if (notificationType === 'consolidated_submission' || 
        notificationType === 'employee_consolidated_submission_confirmation' ||
        notificationType === 'consolidated_admin_verification' ||
        notificationType === 'consolidated_employee_verification' ||
        notificationType === 'consolidated_manager_approval' ||
        notificationType === 'consolidated_employee_approval' ||
        notificationType === 'consolidated_processing_complete' ||
        notificationType === 'consolidated_rejection') {
      if (!claimIds || !claimsDetails || !htmlContent) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Required fields for consolidated notification are missing'
        })
      }
    } else if (notificationType !== 'admin_rejection_notice' && 
               notificationType !== 'manager_rejection_notice' && 
               notificationType !== 'accounting_rejection_notice') {
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
        
      case 'employee_submission_confirmation':
        emailHtmlContent = generateEmployeeSubmissionConfirmationContent(
          recipientName,
          claimDetails
        )
        subject = 'Claim Submitted Successfully'
        break
        
      case 'employee_consolidated_submission_confirmation':
        emailHtmlContent = body.htmlContent
        subject = 'Claims Submitted Successfully'
        break
        
      case 'admin_verification':
        emailHtmlContent = generateAdminVerificationEmailContent(
          recipientName,
          claimDetails,
          employeeName
        )
        subject = 'Reimbursement Claim Verified by Admin'
        break
        
      case 'employee_verification':
        emailHtmlContent = generateEmployeeVerificationEmailContent(
          recipientName,
          claimDetails
        )
        subject = 'Your Reimbursement Claim Has Been Verified'
        break
        
      case 'manager_approval':
        emailHtmlContent = generateManagerApprovalEmailContent(
          recipientName,
          claimDetails,
          employeeName
        )
        subject = 'Reimbursement Claim Approved by Manager'
        break
        
      case 'employee_approval':
        emailHtmlContent = generateEmployeeApprovalEmailContent(
          recipientName,
          claimDetails
        )
        subject = 'Your Reimbursement Claim Has Been Approved'
        break
        
      case 'rejection':
        emailHtmlContent = generateRejectionEmailContent(
          recipientName,
          claimDetails,
          rejectionReason
        )
        subject = 'Your Reimbursement Claim Has Been Rejected'
        break
        
      case 'admin_rejection_notice':
      case 'manager_rejection_notice':
      case 'accounting_rejection_notice':
        emailHtmlContent = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #e11d48;">Claim Rejection Notice</h2>
            <p>Hello ${recipientName || 'there'},</p>
            <p>A reimbursement claim from ${employeeName} has been rejected by ${rejectorName}.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Claim Details</h3>
              <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
              <p><strong>Description:</strong> ${claimDetails.description}</p>
              <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
              <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
              ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
            </div>
            
            <div style="background-color: #fee2e2; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #e11d48;">
              <h3 style="margin-top: 0; color: #e11d48;">Rejection Reason</h3>
              <p>${rejectionReason || 'No specific reason provided.'}</p>
            </div>
            
            <p>This is for your information. The employee has been notified of the rejection.</p>
            
            <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
              <p>This is an automated notification from the GibClaim System.</p>
            </div>
          </div>
        `
        subject = `Claim Rejection Notice - ${employeeName}`
        break
        
      case 'consolidated_submission':
        emailHtmlContent = body.htmlContent
        subject = 'New Reimbursement Claims Submitted'
        break
        
      case 'processed':
        emailHtmlContent = generateClaimProcessedEmailContent(
          recipientName,
          claimDetails
        )
        subject = 'Your Reimbursement Claim Has Been Processed'
        break
        
      case 'consolidated_admin_verification':
      case 'consolidated_employee_verification':
      case 'consolidated_manager_approval':
      case 'consolidated_employee_approval':
      case 'consolidated_processing_complete':
      case 'consolidated_rejection':
        emailHtmlContent = body.htmlContent
        subject = getConsolidatedSubject(notificationType, claimsDetails?.length || 0)
        break
        
      default:
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid notification type: ${notificationType}`
        })
    }
    
    // Send email with sender name
    const { data, error } = await resend.emails.send({
      from: `GibClaim <${config.emailFrom}>`,
      to: recipientEmail,
      subject: subject,
      html: emailHtmlContent,
    })
    
    if (error) {
      // Log failed email to database
      const supabase = createClient(config.public.supabaseUrl, config.public.supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      })
      
      if (notificationType === 'consolidated_submission' || 
          notificationType === 'employee_consolidated_submission_confirmation' ||
          notificationType === 'consolidated_admin_verification' ||
          notificationType === 'consolidated_employee_verification' ||
          notificationType === 'consolidated_manager_approval' ||
          notificationType === 'consolidated_employee_approval' ||
          notificationType === 'consolidated_processing_complete' ||
          notificationType === 'consolidated_rejection') {
        await Promise.all(claimIds.map(claimId => 
          supabase
            .from('email_notifications')
            .insert({
              claim_id: claimId,
              recipient_email: recipientEmail,
              notification_type: notificationType,
              sent_at: new Date().toISOString(),
              sent_by: rejectedBy || null,
              status: 'failed',
              error_message: error.message || 'Email service error'
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
            status: 'failed',
            error_message: error.message || 'Email service error'
          })
      }
      
      throw error
    }
    
    // Log successful email to database
    const supabase = createClient(config.public.supabaseUrl, config.public.supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
    
    if (notificationType === 'consolidated_submission' || 
        notificationType === 'employee_consolidated_submission_confirmation' ||
        notificationType === 'consolidated_admin_verification' ||
        notificationType === 'consolidated_employee_verification' ||
        notificationType === 'consolidated_manager_approval' ||
        notificationType === 'consolidated_employee_approval' ||
        notificationType === 'consolidated_processing_complete' ||
        notificationType === 'consolidated_rejection') {
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
    
    // Return detailed error information
    return {
      success: false,
      error: error.message || 'Failed to send notification',
      statusCode: error.statusCode || 500
    }
  }
})

function getConsolidatedSubject(notificationType: string, claimCount: number): string {
  const claimText = claimCount === 1 ? 'Claim' : 'Claims'
  
  switch (notificationType) {
    case 'consolidated_admin_verification':
      return `${claimCount} Reimbursement ${claimText} Verified by Admin`
    case 'consolidated_employee_verification':
      return `Your ${claimCount} Reimbursement ${claimText} Have Been Verified`
    case 'consolidated_manager_approval':
      return `${claimCount} Reimbursement ${claimText} Approved by Manager`
    case 'consolidated_employee_approval':
      return `Your ${claimCount} Reimbursement ${claimText} Have Been Approved`
    case 'consolidated_processing_complete':
      return `Your ${claimCount} Reimbursement ${claimText} Have Been Processed`
    case 'consolidated_rejection':
      return `Your ${claimCount} Reimbursement ${claimText} Have Been Rejected`
    default:
      return `${claimCount} Reimbursement ${claimText} Update`
  }
}
