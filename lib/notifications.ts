import { createClient } from '@supabase/supabase-js'
import { emailRateLimiter } from './rateLimiter'

/**
 * Formats a currency amount to CAD format
 */
export const formatCurrency = (amount: number | string | null | undefined): string => {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD'
  }).format(Number(amount) || 0)
}

/**
 * Formats a date to a readable format
 */
export const formatDate = (dateString: string | Date): string => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

/**
 * Generates the HTML content for claim rejection email
 */
export const generateRejectionEmailContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  },
  rejectionReason: string
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #e11d48;">Claim Rejection Notification</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>We regret to inform you that your reimbursement claim has been rejected.</p>
      
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
      
      <p>If you have any questions about this decision, please contact your manager or the finance department.</p>
      <p>You can view the detailed status of your claims on your employee dashboard.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

/**
 * Fetches claim details from Supabase for email notification
 */
export const getClaimDetailsForEmail = async (
  client: any,
  claimId: string
) => {
  const { data, error } = await client
    .from('claims')
    .select(`
      id, 
      employee_id,
      description,
      amount,
      gst_amount,
      pst_amount,
      date,
      job_number,
      claim_categories:category_id(category_name),
      category_subcategory_mapping:subcategory_mapping_id(
        id,
        claim_subcategories:subcategory_id(subcategory_name)
      ),
      users!claims_employee_id_fkey(first_name, last_name, email)
    `)
    .eq('id', claimId)
    .single()
  
  if (error) throw error
  
  return {
    claimData: {
      id: data.id,
      description: data.description,
      amount: data.amount,
      date: data.date,
      job_number: data.job_number,
      category_name: data.claim_categories?.category_name || 'N/A',
      subcategory_name: data.category_subcategory_mapping?.claim_subcategories?.subcategory_name || 'N/A'
    },
    userData: {
      employeeId: data.employee_id,
      email: data.users.email,
      firstName: data.users.first_name,
      lastName: data.users.last_name,
      fullName: `${data.users.first_name} ${data.users.last_name}`
    }
  }
}

/**
 * Gets user name by ID
 */
export const getUserNameById = async (
  client: any,
  userId: string
): Promise<string> => {
  const { data } = await client
    .from('users')
    .select('first_name, last_name')
    .eq('id', userId)
    .single()
  
  return data ? `${data.first_name} ${data.last_name}` : 'Unknown User'
}

/**
 * Sends a claim rejection email notification
 */
export const sendClaimRejectionEmail = async (
  claimId: string,
  rejectedBy: string,
  rejectionReason: string
) => {
  try {
    // Get claim and user details
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    const rejectorName = await getUserNameById(client, rejectedBy)
    
    // Send email notification
    await $fetch('/api/send-notification', {
      method: 'POST',
      body: {
        recipientEmail: userData.email,
        recipientName: userData.fullName,
        claimId: claimId,
        claimDetails: claimData,
        notificationType: 'rejection',
        rejectedBy: rejectedBy,
        rejectionReason: rejectionReason,
        rejectorName: rejectorName
      }
    })
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send email notification:', error)
    return { success: false, error }
  }
}

/**
 * Generates the HTML content for claim submission email to admin
 */
export const generateClaimSubmissionEmailContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  },
  employeeName: string
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">New Claim Submission</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>A new reimbursement claim has been submitted by ${employeeName} that requires your verification.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Claim Details</h3>
        <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
        <p><strong>Description:</strong> ${claimDetails.description}</p>
        <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
        <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
        ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
      </div>
      
      <p>Please review this claim in the admin dashboard.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

/**
 * Generates the HTML content for admin verification email to manager
 */
export const generateAdminVerificationEmailContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  },
  employeeName: string
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Claim Verified by Admin</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>A reimbursement claim from ${employeeName} has been verified by the admin and requires your approval.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Claim Details</h3>
        <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
        <p><strong>Description:</strong> ${claimDetails.description}</p>
        <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
        <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
        ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
      </div>
      
      <p>Please review and approve this claim in the manager dashboard.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

/**
 * Generates the HTML content for manager approval email to accountant
 */
export const generateManagerApprovalEmailContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  },
  employeeName: string
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Claim Approved by Manager</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>A reimbursement claim from ${employeeName} has been approved by the manager and requires your processing.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Claim Details</h3>
        <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
        <p><strong>Description:</strong> ${claimDetails.description}</p>
        <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
        <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
        ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
      </div>
      
      <p>Please process this claim in the accountant dashboard.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

/**
 * Gets all admin emails and names
 */
export const getAllAdminDetails = async (client: any) => {
  const { data, error } = await client
    .from('users')
    .select('email, first_name, last_name')
    .eq('role', 'admin')
  
  if (error) throw error
  
  return data.map(admin => ({
    email: admin.email,
    name: `${admin.first_name} ${admin.last_name}`
  }))
}

// Update the sendClaimSubmissionEmail function to handle multiple admins
export const sendClaimSubmissionEmail = async (
  claimId: string
) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    const adminDetails = await getAllAdminDetails(client)
    
    // Send email to all admins with rate limiting
    const emailPromises = adminDetails.map(admin => 
      emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: admin.email,
            recipientName: admin.name,
            claimId: claimId,
            claimDetails: claimData,
            notificationType: 'submission',
            employeeName: userData.fullName
          }
        })
      )
    )
    
    await Promise.all(emailPromises)
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send submission email notification:', error)
    return { success: false, error }
  }
}

export const sendAdminVerificationEmail = async (
  claimId: string,
  managerEmail: string,
  managerName: string
) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    
    await emailRateLimiter.addToQueue(() => 
      $fetch('/api/send-notification', {
        method: 'POST',
        body: {
          recipientEmail: managerEmail,
          recipientName: managerName,
          claimId: claimId,
          claimDetails: claimData,
          notificationType: 'admin_verification',
          employeeName: userData.fullName
        }
      })
    )
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send admin verification email notification:', error)
    return { success: false, error }
  }
}

export const sendManagerApprovalEmail = async (
  claimId: string,
  accountantEmail: string,
  accountantName: string
) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    
    await $fetch('/api/send-notification', {
      method: 'POST',
      body: {
        recipientEmail: accountantEmail,
        recipientName: accountantName,
        claimId: claimId,
        claimDetails: claimData,
        notificationType: 'manager_approval',
        employeeName: userData.fullName
      }
    })
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send manager approval email notification:', error)
    return { success: false, error }
  }
}

/**
 * Gets admin email and name
 */
export const getAdminDetails = async (client: any) => {
  const { data, error } = await client
    .from('users')
    .select('email, first_name, last_name')
    .eq('role', 'admin')
    .single()
  
  if (error) throw error
  
  return {
    email: data.email,
    name: `${data.first_name} ${data.last_name}`
  }
}

/**
 * Gets manager email and name for a department
 */
export const getManagerDetails = async (client: any, department: string) => {
  const { data, error } = await client
    .from('users')
    .select('email, first_name, last_name')
    .eq('role', 'manager')
    .eq('department', department)
    .single()
  
  if (error) throw error
  
  return {
    email: data.email,
    name: `${data.first_name} ${data.last_name}`
  }
}

/**
 * Gets accountant email and name (FIXED: using correct role name)
 */
export const getAccountantDetails = async (client: any) => {
  const { data, error } = await client
    .from('users')
    .select('email, first_name, last_name')
    .eq('role', 'accounting')
    .single()
  
  if (error) throw error
  
  return {
    email: data.email,
    name: `${data.first_name} ${data.last_name}`
  }
}

// Update the sendConsolidatedClaimSubmissionEmail function
export const sendConsolidatedClaimSubmissionEmail = async (
  claimIds: string[]
) => {
  try {
    const client = useSupabaseClient()
    
    // Get details for all claims
    const claimsPromises = claimIds.map(claimId => getClaimDetailsForEmail(client, claimId))
    const claimsDetails = await Promise.all(claimsPromises)
    
    // Get all admin details
    const adminDetails = await getAllAdminDetails(client)
    
    // Calculate total amount
    const totalAmount = claimsDetails.reduce((sum, { claimData }) => sum + claimData.amount, 0)
    
    // Send email to all admins with rate limiting
    const emailPromises = adminDetails.map(admin => {
      // Generate email content for each admin
      const consolidatedContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">New Claims Submission</h2>
          <p>Hello ${admin.name},</p>
          <p>New reimbursement claims have been submitted by ${claimsDetails[0].userData.fullName} that require your verification.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claims Summary</h3>
            <p><strong>Total Claims:</strong> ${claimIds.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claimsDetails.map(({ claimData }) => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claimData.date)}</p>
                <p><strong>Description:</strong> ${claimData.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claimData.amount)}</p>
                <p><strong>Category:</strong> ${claimData.category_name} - ${claimData.subcategory_name}</p>
                ${claimData.job_number ? `<p><strong>Job Number:</strong> ${claimData.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <p>Please review these claims in the admin dashboard.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `

      return emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: admin.email,
            recipientName: admin.name,
            claimIds: claimIds,
            claimsDetails: claimsDetails.map(({ claimData }) => claimData),
            notificationType: 'consolidated_submission',
            employeeName: claimsDetails[0].userData.fullName,
            totalAmount: totalAmount,
            htmlContent: consolidatedContent
          }
        })
      )
    })
    
    await Promise.all(emailPromises)
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send consolidated submission email notification:', error)
    return { success: false, error }
  }
}

// Add this new function to generate processed claim email content
export const generateClaimProcessedEmailContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  }
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #16a34a;">Claim Processing Complete</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>Your reimbursement claim has been processed and approved for payment.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Claim Details</h3>
        <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
        <p><strong>Description:</strong> ${claimDetails.description}</p>
        <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
        <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
        ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
      </div>
      
      <p>The approved amount will be included in your next payroll cycle.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

// Add this new function to send processed claim email
export const sendClaimProcessedEmail = async (claimId: string) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    
    await $fetch('/api/send-notification', {
      method: 'POST',
      body: {
        recipientEmail: userData.email,
        recipientName: userData.fullName,
        claimId: claimId,
        claimDetails: claimData,
        notificationType: 'processed'
      }
    })
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send processed email notification:', error)
    return { success: false, error }
  }
}

/**
 * Gets all manager emails and names for a specific department
 */
export const getAllManagerDetails = async (client: any, department: string) => {
  const { data, error } = await client
    .from('users')
    .select('email, first_name, last_name')
    .eq('role', 'manager')
    .eq('department', department)
  
  if (error) throw error
  
  return data.map(manager => ({
    email: manager.email,
    name: `${manager.first_name} ${manager.last_name}`
  }))
}

/**
 * Gets all accountant emails and names
 */
export const getAllAccountantDetails = async (client: any) => {
  const { data, error } = await client
    .from('users')
    .select('email, first_name, last_name')
    .eq('role', 'accounting')
  
  if (error) throw error
  
  return data.map(accountant => ({
    email: accountant.email,
    name: `${accountant.first_name} ${accountant.last_name}`
  }))
}

/**
 * Enhanced function to get claim details including employee department
 */
export const getClaimDetailsWithDepartment = async (
  client: any,
  claimId: string
) => {
  const { data, error } = await client
    .from('claims')
    .select(`
      id, 
      employee_id,
      description,
      amount,
      gst_amount,
      pst_amount,
      date,
      job_number,
      claim_categories:category_id(category_name),
      category_subcategory_mapping:subcategory_mapping_id(
        id,
        claim_subcategories:subcategory_id(subcategory_name)
      ),
      users!claims_employee_id_fkey(first_name, last_name, email, department)
    `)
    .eq('id', claimId)
    .single()
  
  if (error) throw error
  
  return {
    claimData: {
      id: data.id,
      description: data.description,
      amount: data.amount,
      date: data.date,
      job_number: data.job_number,
      category_name: data.claim_categories?.category_name || 'N/A',
      subcategory_name: data.category_subcategory_mapping?.claim_subcategories?.subcategory_name || 'N/A'
    },
    userData: {
      employeeId: data.employee_id,
      email: data.users.email,
      firstName: data.users.first_name,
      lastName: data.users.last_name,
      fullName: `${data.users.first_name} ${data.users.last_name}`,
      department: data.users.department
    }
  }
}

/**
 * Generates the HTML content for admin verification notification to employee
 */
export const generateEmployeeVerificationEmailContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  }
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Claim Verified by Admin</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>Your reimbursement claim has been verified by an admin and is now awaiting manager approval.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Claim Details</h3>
        <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
        <p><strong>Description:</strong> ${claimDetails.description}</p>
        <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
        <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
        ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
      </div>
      
      <div style="background-color: #dbeafe; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2563eb;">
        <p><strong>Status:</strong> Verified - Awaiting Manager Approval</p>
      </div>
      
      <p>Your claim is progressing through the approval process. You'll be notified once it's approved by your manager.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

/**
 * Generates the HTML content for manager approval notification to employee
 */
export const generateEmployeeApprovalEmailContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  }
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #16a34a;">Claim Approved by Manager</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>Great news! Your reimbursement claim has been approved by your manager and is now being processed by accounting.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Claim Details</h3>
        <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
        <p><strong>Description:</strong> ${claimDetails.description}</p>
        <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
        <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
        ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
      </div>
      
      <div style="background-color: #dcfce7; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #16a34a;">
        <p><strong>Status:</strong> Approved - Being Processed for Payment</p>
      </div>
      
      <p>Your claim is now in the final processing stage. You'll receive another notification once payment has been completed.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

/**
 * Enhanced function to send admin verification emails to ALL managers in department AND notify employee
 */
export const sendEnhancedAdminVerificationEmail = async (claimId: string) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsWithDepartment(client, claimId)
    
    // Check if department exists
    if (!userData.department) {
      console.warn('Employee department not found, using original method')
      // Fallback to the original method for backwards compatibility
      const { getManagerDetails, sendAdminVerificationEmail } = await import('~/lib/notifications')
      return await sendAdminVerificationEmail(claimId, '', '')
    }
    
    // Get ALL managers in the department
    const managerDetails = await getAllManagerDetails(client, userData.department)
    
    // Send notifications to ALL managers in the department
    const managerPromises = managerDetails.map(manager => 
      emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: manager.email,
            recipientName: manager.name,
            claimId: claimId,
            claimDetails: claimData,
            notificationType: 'admin_verification',
            employeeName: userData.fullName
          }
        })
      )
    )
    
    // Send notification to employee about verification
    const employeePromise = emailRateLimiter.addToQueue(() => 
      $fetch('/api/send-notification', {
        method: 'POST',
        body: {
          recipientEmail: userData.email,
          recipientName: userData.fullName,
          claimId: claimId,
          claimDetails: claimData,
          notificationType: 'employee_verification'
        }
      })
    )
    
    await Promise.all([...managerPromises, employeePromise])
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send enhanced admin verification email notification:', error)
    return { success: false, error }
  }
}

/**
 * Enhanced function to send manager approval emails to ALL accountants AND notify employee
 */
export const sendEnhancedManagerApprovalEmail = async (claimId: string) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsWithDepartment(client, claimId)
    
    // Get ALL accountants
    const accountantDetails = await getAllAccountantDetails(client)
    
    // Send notifications to ALL accountants
    const accountantPromises = accountantDetails.map(accountant => 
      emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: accountant.email,
            recipientName: accountant.name,
            claimId: claimId,
            claimDetails: claimData,
            notificationType: 'manager_approval',
            employeeName: userData.fullName
          }
        })
      )
    )
    
    // Send notification to employee about approval
    const employeePromise = emailRateLimiter.addToQueue(() => 
      $fetch('/api/send-notification', {
        method: 'POST',
        body: {
          recipientEmail: userData.email,
          recipientName: userData.fullName,
          claimId: claimId,
          claimDetails: claimData,
          notificationType: 'employee_approval'
        }
      })
    )
    
    await Promise.all([...accountantPromises, employeePromise])
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send enhanced manager approval email notification:', error)
    return { success: false, error }
  }
}

/**
 * Enhanced rejection email function that notifies ALL relevant administrators
 */
export const sendEnhancedClaimRejectionEmail = async (
  claimId: string,
  rejectedBy: string,
  rejectionReason: string,
  rejectedAtStage: 'admin' | 'manager' | 'accounting'
) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    const rejectorName = await getUserNameById(client, rejectedBy)
    
    // Always send rejection email to the employee
    const employeePromise = $fetch('/api/send-notification', {
      method: 'POST',
      body: {
        recipientEmail: userData.email,
        recipientName: userData.fullName,
        claimId: claimId,
        claimDetails: claimData,
        rejectedBy: rejectedBy,
        rejectionReason: rejectionReason,
        rejectorName: rejectorName,
        notificationType: 'rejection'
      }
    })
    
    // Also notify appropriate administrators based on rejection stage
    let adminPromises = []
    
    if (rejectedAtStage === 'admin') {
      // If rejected by admin, notify all admins
      const adminDetails = await getAllAdminDetails(client)
      adminPromises = adminDetails.filter(admin => admin.email !== userData.email).map(admin => 
        emailRateLimiter.addToQueue(() => 
          $fetch('/api/send-notification', {
            method: 'POST',
            body: {
              recipientEmail: admin.email,
              recipientName: admin.name,
              claimId: claimId,
              claimDetails: claimData,
              notificationType: 'admin_rejection_notice',
              employeeName: userData.fullName,
              rejectorName: rejectorName,
              rejectionReason: rejectionReason
            }
          })
        )
      )
    } else if (rejectedAtStage === 'manager') {
      // If rejected by manager, notify admins and other managers in department
      const employeeData = await client
        .from('users')
        .select('department')
        .eq('id', userData.employeeId)
        .single()
      
      const [adminDetails, managerDetails] = await Promise.all([
        getAllAdminDetails(client),
        getAllManagerDetails(client, employeeData.data.department)
      ])
      
      const allNotifiees = [...adminDetails, ...managerDetails].filter(person => person.email !== userData.email)
      adminPromises = allNotifiees.map(person => 
        emailRateLimiter.addToQueue(() => 
          $fetch('/api/send-notification', {
            method: 'POST',
            body: {
              recipientEmail: person.email,
              recipientName: person.name,
              claimId: claimId,
              claimDetails: claimData,
              notificationType: 'manager_rejection_notice',
              employeeName: userData.fullName,
              rejectorName: rejectorName,
              rejectionReason: rejectionReason
            }
          })
        )
      )
    } else if (rejectedAtStage === 'accounting') {
      // If rejected by accounting, notify admins, managers, and other accountants
      const employeeData = await client
        .from('users')
        .select('department')
        .eq('id', userData.employeeId)
        .single()
      
      const [adminDetails, managerDetails, accountantDetails] = await Promise.all([
        getAllAdminDetails(client),
        getAllManagerDetails(client, employeeData.data.department),
        getAllAccountantDetails(client)
      ])
      
      const allNotifiees = [...adminDetails, ...managerDetails, ...accountantDetails].filter(person => person.email !== userData.email)
      adminPromises = allNotifiees.map(person => 
        emailRateLimiter.addToQueue(() => 
          $fetch('/api/send-notification', {
            method: 'POST',
            body: {
              recipientEmail: person.email,
              recipientName: person.name,
              claimId: claimId,
              claimDetails: claimData,
              notificationType: 'accounting_rejection_notice',
              employeeName: userData.fullName,
              rejectorName: rejectorName,
              rejectionReason: rejectionReason
            }
          })
        )
      )
    }
    
    await Promise.all([employeePromise, ...adminPromises])
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send enhanced rejection email notification:', error)
    return { success: false, error }
  }
}

/**
 * Generates the HTML content for claim submission confirmation to employee
 */
export const generateEmployeeSubmissionConfirmationContent = (
  recipientName: string,
  claimDetails: {
    date: string,
    description: string,
    amount: number,
    category_name: string,
    subcategory_name: string,
    job_number?: string
  }
): string => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #16a34a;">Claim Submitted Successfully</h2>
      <p>Hello ${recipientName || 'there'},</p>
      <p>Your reimbursement claim has been successfully submitted and is now under review.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Claim Details</h3>
        <p><strong>Date:</strong> ${formatDate(claimDetails.date)}</p>
        <p><strong>Description:</strong> ${claimDetails.description}</p>
        <p><strong>Amount:</strong> ${formatCurrency(claimDetails.amount)}</p>
        <p><strong>Category:</strong> ${claimDetails.category_name} - ${claimDetails.subcategory_name}</p>
        ${claimDetails.job_number ? `<p><strong>Job Number:</strong> ${claimDetails.job_number}</p>` : ''}
      </div>
      
      <div style="background-color: #dcfce7; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #16a34a;">
        <p><strong>Status:</strong> Submitted - Under Admin Review</p>
      </div>
      
      <p>Your claim will be reviewed by our admin team. You'll receive notifications as it progresses through the approval process.</p>
      
      <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        <p>This is an automated notification from the GibClaim System.</p>
      </div>
    </div>
  `
}

/**
 * Enhanced claim submission function that notifies both admins AND the employee
 */
export const sendEnhancedClaimSubmissionEmail = async (claimId: string) => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    const adminDetails = await getAllAdminDetails(client)
    
    // Send confirmation email to the employee
    const employeePromise = emailRateLimiter.addToQueue(() => 
      $fetch('/api/send-notification', {
        method: 'POST',
        body: {
          recipientEmail: userData.email,
          recipientName: userData.fullName,
          claimId: claimId,
          claimDetails: claimData,
          notificationType: 'employee_submission_confirmation'
        }
      })
    )
    
    // Send notification emails to all admins
    const adminPromises = adminDetails.map(admin => 
      emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: admin.email,
            recipientName: admin.name,
            claimId: claimId,
            claimDetails: claimData,
            notificationType: 'submission',
            employeeName: userData.fullName
          }
        })
      )
    )
    
    await Promise.all([employeePromise, ...adminPromises])
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send enhanced submission email notification:', error)
    return { success: false, error }
  }
}

/**
 * Enhanced consolidated submission function that notifies employee AND admins
 */
export const sendEnhancedConsolidatedClaimSubmissionEmail = async (
  claimIds: string[]
) => {
  try {
    const client = useSupabaseClient()
    
    // Get details for all claims
    const claimsPromises = claimIds.map(claimId => getClaimDetailsForEmail(client, claimId))
    const claimsDetails = await Promise.all(claimsPromises)
    
    // Get all admin details
    const adminDetails = await getAllAdminDetails(client)
    
    // Calculate total amount
    const totalAmount = claimsDetails.reduce((sum, { claimData }) => sum + claimData.amount, 0)
    
    // Send confirmation email to the employee
    const employeeConfirmationContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a;">Claims Submitted Successfully</h2>
        <p>Hello ${claimsDetails[0].userData.fullName},</p>
        <p>Your reimbursement claims have been successfully submitted and are now under review.</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Claims Summary</h3>
          <p><strong>Total Claims:</strong> ${claimIds.length}</p>
          <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
        </div>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Claim Details</h3>
          ${claimsDetails.map(({ claimData }) => `
            <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
              <p><strong>Date:</strong> ${formatDate(claimData.date)}</p>
              <p><strong>Description:</strong> ${claimData.description}</p>
              <p><strong>Amount:</strong> ${formatCurrency(claimData.amount)}</p>
              <p><strong>Category:</strong> ${claimData.category_name} - ${claimData.subcategory_name}</p>
              ${claimData.job_number ? `<p><strong>Job Number:</strong> ${claimData.job_number}</p>` : ''}
            </div>
          `).join('')}
        </div>
        
        <div style="background-color: #dcfce7; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #16a34a;">
          <p><strong>Status:</strong> Submitted - Under Admin Review</p>
        </div>
        
        <p>Your claims will be reviewed by our admin team. You'll receive notifications as they progress through the approval process.</p>
        
        <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
          <p>This is an automated notification from the GibClaim System.</p>
        </div>
      </div>
    `
    
    const employeePromise = emailRateLimiter.addToQueue(() => 
      $fetch('/api/send-notification', {
        method: 'POST',
        body: {
          recipientEmail: claimsDetails[0].userData.email,
          recipientName: claimsDetails[0].userData.fullName,
          claimIds: claimIds,
          claimsDetails: claimsDetails.map(({ claimData }) => claimData),
          notificationType: 'employee_consolidated_submission_confirmation',
          htmlContent: employeeConfirmationContent
        }
      })
    )
    
    // Send email to all admins with rate limiting
    const adminPromises = adminDetails.map(admin => {
      // Generate email content for each admin
      const consolidatedContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">New Claims Submission</h2>
          <p>Hello ${admin.name},</p>
          <p>New reimbursement claims have been submitted by ${claimsDetails[0].userData.fullName} that require your verification.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claims Summary</h3>
            <p><strong>Total Claims:</strong> ${claimIds.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claimsDetails.map(({ claimData }) => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claimData.date)}</p>
                <p><strong>Description:</strong> ${claimData.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claimData.amount)}</p>
                <p><strong>Category:</strong> ${claimData.category_name} - ${claimData.subcategory_name}</p>
                ${claimData.job_number ? `<p><strong>Job Number:</strong> ${claimData.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <p>Please review these claims in the admin dashboard.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `

      return emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: admin.email,
            recipientName: admin.name,
            claimIds: claimIds,
            claimsDetails: claimsDetails.map(({ claimData }) => claimData),
            notificationType: 'consolidated_submission',
            employeeName: claimsDetails[0].userData.fullName,
            totalAmount: totalAmount,
            htmlContent: consolidatedContent
          }
        })
      )
    })
    
    await Promise.all([employeePromise, ...adminPromises])
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send enhanced consolidated submission email notification:', error)
    return { success: false, error }
  }
}

/**
 * Consolidated notification functions for bulk operations
 */

/**
 * Sends consolidated admin verification emails when multiple claims are verified at once
 */
export const sendConsolidatedAdminVerificationEmail = async (claimIds: string[]) => {
  try {
    const client = useSupabaseClient()
    
    // Get details for all claims with department info
    const claimsPromises = claimIds.map(claimId => getClaimDetailsWithDepartment(client, claimId))
    const claimsDetails = await Promise.all(claimsPromises)
    
    // Group claims by employee and department
    const claimsByEmployee = claimsDetails.reduce((acc, { claimData, userData }) => {
      const key = userData.employeeId
      if (!acc[key]) {
        acc[key] = {
          userData,
          claims: []
        }
      }
      acc[key].claims.push(claimData)
      return acc
    }, {})
    
    // Send notifications for each employee
    for (const [employeeId, { userData, claims }] of Object.entries(claimsByEmployee)) {
      if (!userData.department) continue
      
      const totalAmount = claims.reduce((sum, claim) => sum + claim.amount, 0)
      
      // Get ALL managers in the department
      const managerDetails = await getAllManagerDetails(client, userData.department)
      
      // Generate consolidated email content for managers
      const managerContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Claims Verified by Admin</h2>
          <p>Hello there,</p>
          <p>Multiple reimbursement claims from ${userData.fullName} have been verified by admin and require your approval.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Summary</h3>
            <p><strong>Employee:</strong> ${userData.fullName}</p>
            <p><strong>Total Claims:</strong> ${claims.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claims.map(claim => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claim.date)}</p>
                <p><strong>Description:</strong> ${claim.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claim.amount)}</p>
                <p><strong>Category:</strong> ${claim.category_name} - ${claim.subcategory_name}</p>
                ${claim.job_number ? `<p><strong>Job Number:</strong> ${claim.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <p>Please review and approve these claims in the manager dashboard.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `
      
      // Generate consolidated email content for employee
      const employeeContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Claims Verified by Admin</h2>
          <p>Hello ${userData.fullName},</p>
          <p>Your reimbursement claims have been verified by admin and are now awaiting manager approval.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Summary</h3>
            <p><strong>Total Claims:</strong> ${claims.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claims.map(claim => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claim.date)}</p>
                <p><strong>Description:</strong> ${claim.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claim.amount)}</p>
                <p><strong>Category:</strong> ${claim.category_name} - ${claim.subcategory_name}</p>
                ${claim.job_number ? `<p><strong>Job Number:</strong> ${claim.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <div style="background-color: #dbeafe; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2563eb;">
            <p><strong>Status:</strong> Verified - Awaiting Manager Approval</p>
          </div>
          
          <p>Your claims are progressing through the approval process. You'll be notified once they're approved by your manager.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `
      
      // Send to managers
      const managerPromises = managerDetails.map(manager => 
        emailRateLimiter.addToQueue(() => 
          $fetch('/api/send-notification', {
            method: 'POST',
            body: {
              recipientEmail: manager.email,
              recipientName: manager.name,
              claimIds: claims.map(c => c.id),
              claimsDetails: claims,
              notificationType: 'consolidated_admin_verification',
              employeeName: userData.fullName,
              htmlContent: managerContent
            }
          })
        )
      )
      
      // Send to employee
      const employeePromise = emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: userData.email,
            recipientName: userData.fullName,
            claimIds: claims.map(c => c.id),
            claimsDetails: claims,
            notificationType: 'consolidated_employee_verification',
            htmlContent: employeeContent
          }
        })
      )
      
      await Promise.all([...managerPromises, employeePromise])
    }
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send consolidated admin verification email notification:', error)
    return { success: false, error }
  }
}

/**
 * Sends consolidated manager approval emails when multiple claims are approved at once
 */
export const sendConsolidatedManagerApprovalEmail = async (claimIds: string[]) => {
  try {
    const client = useSupabaseClient()
    
    // Get details for all claims
    const claimsPromises = claimIds.map(claimId => getClaimDetailsWithDepartment(client, claimId))
    const claimsDetails = await Promise.all(claimsPromises)
    
    // Group claims by employee
    const claimsByEmployee = claimsDetails.reduce((acc, { claimData, userData }) => {
      const key = userData.employeeId
      if (!acc[key]) {
        acc[key] = {
          userData,
          claims: []
        }
      }
      acc[key].claims.push(claimData)
      return acc
    }, {})
    
    // Get ALL accountants
    const accountantDetails = await getAllAccountantDetails(client)
    
    // Send notifications for each employee
    for (const [employeeId, { userData, claims }] of Object.entries(claimsByEmployee)) {
      const totalAmount = claims.reduce((sum, claim) => sum + claim.amount, 0)
      
      // Generate consolidated email content for accountants
      const accountantContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Claims Approved by Manager</h2>
          <p>Hello there,</p>
          <p>Multiple reimbursement claims from ${userData.fullName} have been approved by the manager and require your processing.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Summary</h3>
            <p><strong>Employee:</strong> ${userData.fullName}</p>
            <p><strong>Total Claims:</strong> ${claims.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claims.map(claim => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claim.date)}</p>
                <p><strong>Description:</strong> ${claim.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claim.amount)}</p>
                <p><strong>Category:</strong> ${claim.category_name} - ${claim.subcategory_name}</p>
                ${claim.job_number ? `<p><strong>Job Number:</strong> ${claim.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <p>Please process these claims in the accountant dashboard.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `
      
      // Generate consolidated email content for employee
      const employeeContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">Claims Approved by Manager</h2>
          <p>Hello ${userData.fullName},</p>
          <p>Great news! Your reimbursement claims have been approved by your manager and are now being processed by accounting.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Summary</h3>
            <p><strong>Total Claims:</strong> ${claims.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claims.map(claim => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claim.date)}</p>
                <p><strong>Description:</strong> ${claim.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claim.amount)}</p>
                <p><strong>Category:</strong> ${claim.category_name} - ${claim.subcategory_name}</p>
                ${claim.job_number ? `<p><strong>Job Number:</strong> ${claim.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <div style="background-color: #dcfce7; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #16a34a;">
            <p><strong>Status:</strong> Approved - Being Processed for Payment</p>
          </div>
          
          <p>Your claims are now in the final processing stage. You'll receive another notification once payment has been completed.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `
      
      // Send to accountants
      const accountantPromises = accountantDetails.map(accountant => 
        emailRateLimiter.addToQueue(() => 
          $fetch('/api/send-notification', {
            method: 'POST',
            body: {
              recipientEmail: accountant.email,
              recipientName: accountant.name,
              claimIds: claims.map(c => c.id),
              claimsDetails: claims,
              notificationType: 'consolidated_manager_approval',
              employeeName: userData.fullName,
              htmlContent: accountantContent
            }
          })
        )
      )
      
      // Send to employee
      const employeePromise = emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: userData.email,
            recipientName: userData.fullName,
            claimIds: claims.map(c => c.id),
            claimsDetails: claims,
            notificationType: 'consolidated_employee_approval',
            htmlContent: employeeContent
          }
        })
      )
      
      await Promise.all([...accountantPromises, employeePromise])
    }
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send consolidated manager approval email notification:', error)
    return { success: false, error }
  }
}

/**
 * Sends consolidated processing completion emails when multiple claims are completed at once
 */
export const sendConsolidatedProcessingCompleteEmail = async (claimIds: string[]) => {
  try {
    const client = useSupabaseClient()
    
    // Get details for all claims
    const claimsPromises = claimIds.map(claimId => getClaimDetailsWithDepartment(client, claimId))
    const claimsDetails = await Promise.all(claimsPromises)
    
    // Group claims by employee
    const claimsByEmployee = claimsDetails.reduce((acc, { claimData, userData }) => {
      const key = userData.employeeId
      if (!acc[key]) {
        acc[key] = {
          userData,
          claims: []
        }
      }
      acc[key].claims.push(claimData)
      return acc
    }, {})
    
    // Send notifications for each employee
    for (const [employeeId, { userData, claims }] of Object.entries(claimsByEmployee)) {
      const totalAmount = claims.reduce((sum, claim) => sum + claim.amount, 0)
      
      // Generate consolidated email content for employee
      const employeeContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">Claims Processing Complete</h2>
          <p>Hello ${userData.fullName},</p>
          <p>Your reimbursement claims have been processed and approved for payment.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Summary</h3>
            <p><strong>Total Claims:</strong> ${claims.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claims.map(claim => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claim.date)}</p>
                <p><strong>Description:</strong> ${claim.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claim.amount)}</p>
                <p><strong>Category:</strong> ${claim.category_name} - ${claim.subcategory_name}</p>
                ${claim.job_number ? `<p><strong>Job Number:</strong> ${claim.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <p>The approved amounts will be included in your next payroll cycle.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `
      
      // Send to employee
      await emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: userData.email,
            recipientName: userData.fullName,
            claimIds: claims.map(c => c.id),
            claimsDetails: claims,
            notificationType: 'consolidated_processing_complete',
            htmlContent: employeeContent
          }
        })
      )
    }
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send consolidated processing complete email notification:', error)
    return { success: false, error }
  }
}

/**
 * Sends consolidated rejection emails when multiple claims are rejected at once
 */
export const sendConsolidatedRejectionEmail = async (
  claimIds: string[], 
  rejectedBy: string, 
  rejectionReason: string,
  rejectedAtStage: 'admin' | 'manager' | 'accounting'
) => {
  try {
    const client = useSupabaseClient()
    
    // Get details for all claims
    const claimsPromises = claimIds.map(claimId => getClaimDetailsWithDepartment(client, claimId))
    const claimsDetails = await Promise.all(claimsPromises)
    const rejectorName = await getUserNameById(client, rejectedBy)
    
    // Group claims by employee
    const claimsByEmployee = claimsDetails.reduce((acc, { claimData, userData }) => {
      const key = userData.employeeId
      if (!acc[key]) {
        acc[key] = {
          userData,
          claims: []
        }
      }
      acc[key].claims.push(claimData)
      return acc
    }, {})
    
    // Send notifications for each employee
    for (const [employeeId, { userData, claims }] of Object.entries(claimsByEmployee)) {
      const totalAmount = claims.reduce((sum, claim) => sum + claim.amount, 0)
      
      // Generate consolidated email content for employee
      const employeeContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e11d48;">Claims Rejection Notification</h2>
          <p>Hello ${userData.fullName},</p>
          <p>We regret to inform you that your reimbursement claims have been rejected.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Summary</h3>
            <p><strong>Total Claims:</strong> ${claims.length}</p>
            <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
            <p><strong>Rejected by:</strong> ${rejectorName}</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Claim Details</h3>
            ${claims.map(claim => `
              <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                <p><strong>Date:</strong> ${formatDate(claim.date)}</p>
                <p><strong>Description:</strong> ${claim.description}</p>
                <p><strong>Amount:</strong> ${formatCurrency(claim.amount)}</p>
                <p><strong>Category:</strong> ${claim.category_name} - ${claim.subcategory_name}</p>
                ${claim.job_number ? `<p><strong>Job Number:</strong> ${claim.job_number}</p>` : ''}
              </div>
            `).join('')}
          </div>
          
          <div style="background-color: #fee2e2; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #e11d48;">
            <h3 style="margin-top: 0; color: #e11d48;">Rejection Reason</h3>
            <p>${rejectionReason || 'No specific reason provided.'}</p>
          </div>
          
          <p>If you have any questions about this decision, please contact your manager or the finance department.</p>
          <p>You can view the detailed status of your claims on your employee dashboard.</p>
          
          <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
            <p>This is an automated notification from the GibClaim System.</p>
          </div>
        </div>
      `
      
      // Send to employee
      await emailRateLimiter.addToQueue(() => 
        $fetch('/api/send-notification', {
          method: 'POST',
          body: {
            recipientEmail: userData.email,
            recipientName: userData.fullName,
            claimIds: claims.map(c => c.id),
            claimsDetails: claims,
            notificationType: 'consolidated_rejection',
            rejectedBy: rejectedBy,
            rejectionReason: rejectionReason,
            rejectorName: rejectorName,
            htmlContent: employeeContent
          }
        })
      )
    }
    
    return { success: true }
  } catch (error) {
    console.error('Failed to send consolidated rejection email notification:', error)
    return { success: false, error }
  }
}

/**
 * Enhanced email notification service with error handling and UI feedback
 */
export interface NotificationResult {
  success: boolean
  results: EmailNotificationResult[]
  errors: EmailNotificationResult[]
}

export const sendNotificationWithErrorHandling = async (
  notificationData: any,
  showToast: (toast: any) => void
): Promise<NotificationResult> => {
  const results: EmailNotificationResult[] = []
  const errors: EmailNotificationResult[] = []

  try {
    const result = await emailRateLimiter.addToQueue(async () => {
      return await $fetch('/api/send-notification', {
        method: 'POST',
        body: notificationData
      })
    })

    results.push({
      success: true,
      messageId: result.messageId,
      recipientEmail: notificationData.recipientEmail,
      notificationType: notificationData.notificationType
    })

    return { success: true, results, errors }
  } catch (error) {
    const errorResult: EmailNotificationResult = {
      success: false,
      error: error.message || 'Failed to send notification',
      recipientEmail: notificationData.recipientEmail,
      notificationType: notificationData.notificationType
    }
    
    errors.push(errorResult)
    
    // Show error toast
    showToast({
      title: 'Email Notification Failed',
      description: `Failed to send email to ${notificationData.recipientEmail}: ${errorResult.error}`,
      variant: 'destructive'
    })

    return { success: false, results, errors }
  }
}

/**
 * Enhanced claim submission function with proper error handling
 */
export const sendEnhancedClaimSubmissionEmailWithErrorHandling = async (
  claimId: string,
  showToast: (toast: any) => void
): Promise<NotificationResult> => {
  try {
    const client = useSupabaseClient()
    const { claimData, userData } = await getClaimDetailsForEmail(client, claimId)
    const adminDetails = await getAllAdminDetails(client)
    
    const allResults: EmailNotificationResult[] = []
    const allErrors: EmailNotificationResult[] = []
    
    // Send confirmation email to the employee
    const employeeResult = await sendNotificationWithErrorHandling({
      recipientEmail: userData.email,
      recipientName: userData.fullName,
      claimId: claimId,
      claimDetails: claimData,
      notificationType: 'employee_submission_confirmation'
    }, showToast)
    
    allResults.push(...employeeResult.results)
    allErrors.push(...employeeResult.errors)
    
    // Send notification emails to all admins
    const adminPromises = adminDetails.map(admin => 
      sendNotificationWithErrorHandling({
        recipientEmail: admin.email,
        recipientName: admin.name,
        claimId: claimId,
        claimDetails: claimData,
        notificationType: 'submission',
        employeeName: userData.fullName
      }, showToast)
    )
    
    const adminResults = await Promise.all(adminPromises)
    
    adminResults.forEach(result => {
      allResults.push(...result.results)
      allErrors.push(...result.errors)
    })
    
    const hasErrors = allErrors.length > 0
    const hasSuccess = allResults.length > 0
    
    // Show summary toast
    if (hasErrors && hasSuccess) {
      showToast({
        title: 'Partial Email Success',
        description: `${allResults.length} emails sent successfully, ${allErrors.length} failed`,
        variant: 'default'
      })
    } else if (hasErrors) {
      showToast({
        title: 'Email Notifications Failed',
        description: `Failed to send ${allErrors.length} email notifications`,
        variant: 'destructive'
      })
    } else {
      showToast({
        title: 'Email Notifications Sent',
        description: `Successfully sent ${allResults.length} email notifications`,
        variant: 'default'
      })
    }
    
    return { 
      success: !hasErrors, 
      results: allResults, 
      errors: allErrors 
    }
  } catch (error) {
    console.error('Failed to send enhanced submission email notification:', error)
    
    showToast({
      title: 'Email System Error',
      description: 'Failed to process email notifications',
      variant: 'destructive'
    })
    
    return { 
      success: false, 
      results: [], 
      errors: [{
        success: false,
        error: error.message || 'System error',
        recipientEmail: 'unknown',
        notificationType: 'submission'
      }]
    }
  }
}