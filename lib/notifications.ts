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
        <p>This is an automated notification from the Gibraltar Construction Reimbursement System.</p>
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
      users:employee_id(first_name, last_name, email)
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
        <p>This is an automated notification from the Gibraltar Construction Reimbursement System.</p>
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
        <p>This is an automated notification from the Gibraltar Construction Reimbursement System.</p>
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
        <p>This is an automated notification from the Gibraltar Construction Reimbursement System.</p>
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
 * Gets accountant email and name
 */
export const getAccountantDetails = async (client: any) => {
  const { data, error } = await client
    .from('users')
    .select('email, first_name, last_name')
    .eq('role', 'accountant')
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
            <p>This is an automated notification from the Gibraltar Construction Reimbursement System.</p>
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
