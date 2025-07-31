<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { addDays } from 'date-fns'
import { cn } from '@/lib/utils'
import { getReceiptSignedUrl } from '~/lib/utils'

import { 
  CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  FileText, 
  ChevronDown, 
  ChevronUp,
  CheckCircle2,
  XCircle,
  User,
  Clock,
  CheckCircle,
  Download,
  Loader2,
  MessageSquare
} from 'lucide-vue-next'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  DateFormatter,
  type DateValue,
  getLocalTimeZone,
  parseDate,
  today,
  CalendarDate
} from '@internationalized/date'
import { RangeCalendar } from '@/components/ui/range-calendar'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

definePageMeta({
  layout: 'accounting',
  middleware: ['accountant']
})

// Use Supabase client and user
const client = useSupabaseClient()
const user = useSupabaseUser()
const reimbursementRequests = ref([])
const filteredRequests = ref([])
const loading = ref(true)
const error = ref(null)
const categories = ref([])
const viewingReceipt = ref(false)
const currentReceiptUrl = ref('')

// Expanded sections tracking
const expandedEmployees = ref({})
const expandedCategories = ref({})

// Filters
const filters = ref({
  jobNumber: '',
  categoryId: '',
  subcategoryId: '',
  dateRange: {
    start: null,
    end: null
  },
  employeeName: '',
  status: 'all'
})

// Store signed URLs for receipts
const receiptSignedUrls = ref({})

// Add these new refs after the existing refs
const selectedYear = ref(new Date().getFullYear())
const selectedMonth = ref(new Date().getMonth())
const selectedRequests = ref(new Set())
const years = ref([])
const months = [
  'January', 'February', 'March', 'April', 'May', 'June', 
  'July', 'August', 'September', 'October', 'November', 'December'
]

// Add these refs after other refs
const showVerifyModal = ref(false)
const verifyingRequests = ref([])
const showSuccessModal = ref(false)
const successMessage = ref('')

// Add these refs at the beginning of the script section where other refs are defined
const showRejectModal = ref(false)
const rejectingRequestId = ref(null)
const rejectionReason = ref('')

// Add these new refs for tracking different loading states
const verifyingRequestIds = ref(new Set())  // For tracking individual request processing
const isVerifying = ref(false)  // For bulk processing
const isRejecting = ref(false)  // For rejection process

// Add these refs after other refs
const noteDialogOpen = ref(false)
const newNote = ref('')
const selectedClaim = ref(null)
const userRole = ref('')

// Add this new function to fetch unique years from claims
const fetchAvailableYears = async () => {
  try {
    const { data, error } = await client
      .from('claims')
      .select('date')
    
    if (error) throw error
    
    // Extract unique years from claims
    const uniqueYears = new Set(
      data.map(claim => new Date(claim.date).getFullYear())
    )
    
    // Add current year if not present
    const currentYear = new Date().getFullYear()
    uniqueYears.add(currentYear)
    
    // Sort years in descending order
    years.value = Array.from(uniqueYears).sort((a, b) => b - a)
    
    // Set selected year to most recent year
    if (years.value.length > 0) {
      selectedYear.value = years.value[0]
    }
  } catch (err) {
    console.error('Error fetching available years:', err)
    // Fallback to current year if there's an error
    const currentYear = new Date().getFullYear()
    years.value = [currentYear]
    selectedYear.value = currentYear
  }
}

// Fetch categories and subcategories
const fetchCategories = async () => {
  try {
    const { data: categoryData, error: categoryError } = await client
      .from('claim_categories')
      .select(`
        id,
        category_name,
        category_subcategory_mapping!inner (
          id,
          requires_job_number,
          requires_employee_name,
          requires_client_info,
          subcategory:claim_subcategories (
            id,
            subcategory_name
          )
        )
      `)
      .order('category_name')
    
    if (categoryError) throw categoryError
    
    // Transform the data to match the expected structure
    categories.value = categoryData?.map(category => ({
      id: category.id,
      name: category.category_name,
      expense_subcategories: category.category_subcategory_mapping.map(mapping => ({
        id: mapping.subcategory.id,
        name: mapping.subcategory.subcategory_name,
        mapping_id: mapping.id,
        requires_job_number: mapping.requires_job_number,
        requires_employee_name: mapping.requires_employee_name,
        requires_client_info: mapping.requires_client_info
      }))
    })) || []
  } catch (err) {
    console.error('Error fetching categories:', err)
    toast({
      title: 'Error',
      description: 'Failed to load expense categories',
      variant: 'destructive'
    })
  }
}

// Fetch reimbursement requests
const fetchReimbursementRequests = async () => {
  try {
    loading.value = true
    error.value = null
    
    const { data, error: fetchError } = await client
      .from('claims')
      .select(`
        *,
        profiles:employee_id(first_name, last_name, department),
        category:category_id(id, category_name),
        subcategory_mapping:subcategory_mapping_id(
          id,
          subcategory:subcategory_id(id, subcategory_name)
        ),
        manager_approver:manager_approved_by(first_name, last_name),
        admin_verifier:admin_verified_by(first_name, last_name),
        notes:claim_notes(
          id,
          note,
          role,
          created_at,
          user_id
        )
      `)
      .order('date', { ascending: false })
    
    if (fetchError) throw fetchError
    
    reimbursementRequests.value = data || []
    applyFilters()
  } catch (err) {
    console.error('Error fetching claims:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Add this after other refs
const df = new DateFormatter('en-US', {
  dateStyle: 'long',
})

// Update the applyFilters function to use CalendarDate
const applyFilters = () => {
  filteredRequests.value = reimbursementRequests.value.filter(request => {
    const requestDate = new CalendarDate(
      new Date(request.date).getFullYear(),
      new Date(request.date).getMonth() + 1,
      new Date(request.date).getDate()
    )
    
    // Month/Year filter
    const requestMonth = requestDate.month - 1 // Adjust for 0-based months
    const requestYear = requestDate.year
    if (requestMonth !== selectedMonth.value || requestYear !== selectedYear.value) {
      return false
    }
    
    // Date range filter
    if (filters.value.dateRange.start) {
      if (requestDate.compare(filters.value.dateRange.start) < 0) return false
    }
    if (filters.value.dateRange.end) {
      if (requestDate.compare(filters.value.dateRange.end) > 0) return false
    }
    
    // Job number filter
    if (filters.value.jobNumber && !request.job_number.includes(filters.value.jobNumber)) {
      return false
    }
    
    // Employee name filter
    if (filters.value.employeeName) {
      const fullName = `${request.profiles?.first_name} ${request.profiles?.last_name}`.toLowerCase()
      if (!fullName.includes(filters.value.employeeName.toLowerCase())) {
        return false
      }
    }
    
    // Category filter
    if (filters.value.categoryId && request.category_id !== filters.value.categoryId) {
      return false
    }
    
    // Subcategory filter
    if (filters.value.subcategoryId && request.subcategory_id !== filters.value.subcategoryId) {
      return false
    }
    
    // Status filter
    if (filters.value.status && filters.value.status !== 'all') {
      if (request.status !== filters.value.status) {
        return false
      }
    }
    
    return true
  })
  
  // Only reset selections, keep expanded state
  selectedRequests.value.clear()
  
  // Set only employee sections expanded after filtering
  if (sortedEmployeeKeys.value) {
    sortedEmployeeKeys.value.forEach(employeeId => {
      expandedEmployees.value[employeeId] = true
    })
  }
}

// Update the formatDate function to handle dates correctly
const formatDate = (date) => {
  if (!date) return ''
  const parsedDate = parseDate(date.split('T')[0])
  return df.format(parsedDate.toDate(getLocalTimeZone()))
}

// Update the organizedData computed property
const organizedData = computed(() => {
  const organized = {}
  
  filteredRequests.value.forEach(request => {
    const employeeId = request.employee_id
    const employeeName = request.profiles ? 
      `${request.profiles.first_name} ${request.profiles.last_name}` : 
      'Unknown Employee'
    const employeeDept = request.profiles?.department || 'Unknown Department'
    
    if (!organized[employeeId]) {
      organized[employeeId] = {
        key: employeeId,
        name: employeeName,
        department: employeeDept,
        categories: {},
        total: 0
      }
    }
    
    const categoryId = request.category_id || 'uncategorized'
    const categoryName = request.category?.category_name || 'Uncategorized'
    const subcategoryName = request.subcategory_mapping?.subcategory?.subcategory_name
    
    const categoryKey = `${categoryId}${request.subcategory_id ? `-${request.subcategory_id}` : ''}`
    
    if (!organized[employeeId].categories[categoryKey]) {
      organized[employeeId].categories[categoryKey] = {
        key: categoryKey,
        categoryId: categoryId,
        subcategoryId: request.subcategory_id,
        name: categoryName,
        subcategoryName: subcategoryName,
        jobGroups: {},
        total: 0
      }
    }
    
    const jobNumber = request.job_number || 'No Job Number'
    if (!organized[employeeId].categories[categoryKey].jobGroups[jobNumber]) {
      organized[employeeId].categories[categoryKey].jobGroups[jobNumber] = {
        requests: [],
        total: 0
      }
    }
    
    organized[employeeId].categories[categoryKey].jobGroups[jobNumber].requests.push(request)
    const amount = parseFloat(request.amount) || 0
    organized[employeeId].categories[categoryKey].jobGroups[jobNumber].total += amount
    organized[employeeId].categories[categoryKey].total += amount
    organized[employeeId].total += amount
  })
  
  return organized
})

// Get sorted employee keys
const sortedEmployeeKeys = computed(() => {
  return Object.keys(organizedData.value).sort((a, b) => {
    const empA = organizedData.value[a]
    const empB = organizedData.value[b]
    return empA.name.localeCompare(empB.name)
  })
})

// Get sorted category keys for an employee
const getSortedCategoryKeys = (employeeId) => {
  const employee = organizedData.value[employeeId]
  if (!employee) return []
  
  return Object.keys(employee.categories).sort((a, b) => {
    const catA = employee.categories[a]
    const catB = employee.categories[b]
    return catA.name.localeCompare(catB.name)
  })
}

// Toggle expansion functions
const toggleEmployee = (employeeId) => {
  expandedEmployees.value[employeeId] = !expandedEmployees.value[employeeId]
}

const toggleCategory = (employeeId, categoryId) => {
  const key = `${employeeId}-${categoryId}`
  expandedCategories.value[key] = !expandedCategories.value[key]
  
  // If expanding the category, also expand all job groups under it
  if (expandedCategories.value[key]) {
    const category = organizedData.value[employeeId].categories[categoryId]
    Object.keys(category.jobGroups).forEach(jobNumber => {
      const jobKey = `${employeeId}-${categoryId}-${jobNumber}`
      expandedJobs.value[jobKey] = true
    })
  }
}

// Format helpers
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD'
  }).format(amount)
}

const formatStatus = (status) => {
  return status.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}

// Receipt handling
const viewReceipt = async (receiptUrl) => {
  if (!receiptUrl) return
  
  isReceiptLoading.value = true
  currentReceiptUrl.value = '' // Clear the current URL while loading
  viewingReceipt.value = true
  
  try {
    const { signedUrl, isImage } = await getReceiptSignedUrl(client, receiptUrl)
    
    if (!signedUrl) {
      throw new Error('Failed to get signed URL')
    }
    
    currentReceiptUrl.value = signedUrl
    isImageReceipt.value = isImage
  } catch (err) {
    console.error('Error viewing receipt:', err)
    toast({
      title: 'Error',
      description: 'Could not load receipt',
      variant: 'destructive'
    })
  } finally {
    isReceiptLoading.value = false
  }
}

// Status badge class
const getStatusClass = (status) => {
  switch (status) {
    case 'approved':
      return 'bg-green-100 text-green-800'
    case 'completed':
      return 'bg-purple-100 text-purple-800'
    case 'processed':
      return 'bg-green-100 text-green-800'
    case 'verified':
      return 'bg-blue-100 text-blue-800'
    case 'pending':
      return 'bg-yellow-100 text-yellow-800'
    case 'rejected':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

// Watch for filter changes
watch(filters, () => {
  applyFilters()
}, { deep: true })

// Selected category subcategories
const selectedCategorySubcategories = computed(() => {
  if (!filters.value.categoryId) return []
  const category = categories.value.find(c => c.id === filters.value.categoryId)
  return category?.expense_subcategories || []
})

// Watch for category changes to reset subcategory
watch(() => filters.value.categoryId, () => {
  filters.value.subcategoryId = ''
})

// Add these new methods
const changeMonth = (newMonth) => {
  selectedMonth.value = newMonth
  applyFilters()
}

const changeYear = (newYear) => {
  selectedYear.value = newYear
  applyFilters()
}

// Add bulk approval methods
const toggleEmployeeSelection = (employeeId, checked) => {
  const employee = organizedData.value[employeeId]
  
  // Create a new Set to ensure reactivity
  const newSelectedRequests = new Set(selectedRequests.value)
  
  // Collect all requests that can be verified for this employee
  Object.values(employee.categories).forEach(category => {
    Object.values(category.jobGroups).forEach(jobGroup => {
      jobGroup.requests.forEach(request => {
        if (request.status === 'approved') {
          if (checked) {
            newSelectedRequests.add(request.id)
          } else {
            newSelectedRequests.delete(request.id)
          }
        }
      })
    })
  })
  
  // Assign the new Set to trigger reactivity
  selectedRequests.value = newSelectedRequests
}

const isEmployeeFullySelected = (employeeId) => {
  const employee = organizedData.value[employeeId]
  const verifiableRequests = []
  
  Object.values(employee.categories).forEach(category => {
    Object.values(category.jobGroups).forEach(jobGroup => {
      jobGroup.requests.forEach(request => {
        if (request.status === 'approved') {
          verifiableRequests.push(request.id)
        }
      })
    })
  })
  
  return verifiableRequests.length > 0 && 
         verifiableRequests.every(id => selectedRequests.value.has(id))
}

const verifySelectedRequests = async (requestId) => {
  if (requestId) {
    verifyingRequestIds.value.add(requestId)
  }
  const requestsToVerify = requestId ? [requestId] : Array.from(selectedRequests.value)
  verifyingRequests.value = requestsToVerify
  showVerifyModal.value = true
  if (requestId) {
    verifyingRequestIds.value.delete(requestId)
  }
}

// Update the confirmVerification function
const confirmVerification = async () => {
  try {
    isVerifying.value = true
    // Add all requests being verified to the tracking set
    verifyingRequests.value.forEach(id => verifyingRequestIds.value.add(id))
    
    const promises = verifyingRequests.value.map(async (id) => {
      try {
        const { data, error } = await client
          .rpc('update_claim_status', {
            claim_id: id,
            new_status: 'completed',
            rejection_reason: null
          })
        
        if (error) throw error
        
        // Send notification
        try {
          const { sendClaimProcessedEmail } = await import('~/lib/notifications')
          await sendClaimProcessedEmail(id)
        } catch (emailError) {
          console.error('Failed to send email notification:', emailError)
        }
      } finally {
        verifyingRequestIds.value.delete(id)
      }
    })
    
    await Promise.all(promises)
    
    // Show success modal
    successMessage.value = `Successfully processed ${verifyingRequests.value.length} request${verifyingRequests.value.length > 1 ? 's' : ''}`
    showSuccessModal.value = true
    showVerifyModal.value = false
    
    // Refresh the list and clear selections
    selectedRequests.value.clear()
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error processing requests:', err)
    toast({
      title: 'Error',
      description: 'Failed to process some requests',
      variant: 'destructive'
    })
    showVerifyModal.value = false
  } finally {
    isVerifying.value = false
    verifyingRequestIds.value.clear()
  }
}

// Update the monthlyClaimStatus computed property
const monthlyClaimStatus = computed(() => {
  const status = {}
  
  // Initialize all months as undefined (no claims)
  months.forEach((_, index) => {
    status[index] = undefined
  })
  
  // Process all claims for the selected year
  reimbursementRequests.value.forEach(request => {
    const date = new Date(request.date)
    if (date.getFullYear() === selectedYear.value) {
      const month = date.getMonth()
      // If any claim in this month is processed, mark as processed
      if (request.status === 'completed') {
        status[month] = 'completed'
      } 
      // Otherwise mark as having claims if not already marked as processed
      else if (status[month] !== 'processed') {
        status[month] = 'has-claims'
      }
    }
  })
  
  return status
})

// Add new ref for expanded job groups
const expandedJobs = ref({})

// Add new toggle function for job groups
const toggleJob = (employeeId, categoryKey, jobNumber) => {
  const key = `${employeeId}-${categoryKey}-${jobNumber}`
  expandedJobs.value[key] = !expandedJobs.value[key]
}

// Replace the existing rejectRequest function with this updated version
const rejectRequest = async (requestId) => {
  rejectingRequestId.value = requestId
  rejectionReason.value = ''
  showRejectModal.value = true
}

// Update the confirmRejection function
const confirmRejection = async () => {
  try {
    isRejecting.value = true
    const { data, error } = await client
      .rpc('update_claim_status', {
        claim_id: rejectingRequestId.value,
        new_status: 'rejected',
        rejection_reason: rejectionReason.value
      })
    
    if (error) throw error
    
    // Show success message
    toast({
      title: 'Success',
      description: 'Request has been rejected',
      variant: 'default'
    })
    
    // Send email notification
    try {
      const { sendClaimRejectionEmail } = await import('~/lib/notifications')
      await sendClaimRejectionEmail(
        rejectingRequestId.value,
        user.value.id,
        rejectionReason.value
      )
    } catch (emailError) {
      console.error('Failed to send email notification:', emailError)
    }
    
    showRejectModal.value = false
    
    // Refresh the list
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error rejecting request:', err)
    toast({
      title: 'Error',
      description: 'Failed to reject request',
      variant: 'destructive'
    })
  } finally {
    isRejecting.value = false
  }
}

// Update the PDF generation function
const generateEmployeePDF = (employeeId) => {
  const employee = organizedData.value[employeeId]
  if (!employee) return

  try {
    // Try different ways to access pdfMake
    const { $pdfMake } = useNuxtApp()
    
    if (!$pdfMake) {
      console.error('pdfMake is not available')
      toast({
        title: 'Error',
        description: 'PDF generation is not available. Please check the console for more details.',
        variant: 'destructive'
      })
      return
    }
    
    // Check if any completed claims exist for this employee this month
    let hasCompletedClaims = false
    Object.values(employee.categories).forEach(category => {
      Object.values(category.jobGroups).forEach(jobGroup => {
        if (jobGroup.requests.some(req => req.status === 'completed')) {
          hasCompletedClaims = true
        }
      })
    })

    if (!hasCompletedClaims) {
      toast({
        title: 'No Completed Claims',
        description: 'This employee has no completed claims for the selected period',
        variant: 'destructive'
      })
      return
    }

    // Get current month and year strings
    const monthName = months[selectedMonth.value]
    const yearStr = String(selectedYear.value)

    // Create document content array - we'll add elements to this
    const docContent = [
      {
        text: 'Expense Reimbursement Summary',
        style: 'header',
        alignment: 'center',
        margin: [0, 0, 0, 10]
      },
      {
        text: [
          { text: 'Employee: ', bold: true },
          employee.name
        ],
        margin: [0, 5, 0, 0]
      },
      {
        text: [
          { text: 'Department: ', bold: true },
          employee.department
        ],
        margin: [0, 5, 0, 0]
      },
      {
        text: [
          { text: 'Period: ', bold: true },
          `${monthName} ${yearStr}`
        ],
        margin: [0, 5, 0, 0]
      }
    ]

    // Add date range if it exists
    if (filters.value.dateRange.start || filters.value.dateRange.end) {
      docContent.push({
        text: [
          { text: 'Date Range: ', bold: true },
          filters.value.dateRange.start ? df.format(filters.value.dateRange.start.toDate(getLocalTimeZone())) : '',
          filters.value.dateRange.start && filters.value.dateRange.end ? ' - ' : '',
          filters.value.dateRange.end ? df.format(filters.value.dateRange.end.toDate(getLocalTimeZone())) : ''
        ],
        margin: [0, 5, 0, 15]
      })
    } else {
      // Add extra margin if no date range
      docContent[docContent.length - 1].margin = [0, 5, 0, 15]
    }

    // Create separate tables for each category
    let overallTotal = 0
    let overallGst = 0
    let overallPst = 0

    // Get categories in sorted order
    const sortedCategoryIds = getSortedCategoryKeys(employeeId)
    
    sortedCategoryIds.forEach(categoryId => {
      const category = employee.categories[categoryId]
      let categoryHasCompletedClaims = false
      let categoryTotal = 0
      let categoryGst = 0
      let categoryPst = 0
      
      // Prepare table data
      const tableBody = [
        [
          { text: 'Date', style: 'tableHeader' },
          { text: 'Job #', style: 'tableHeader' },
          { text: 'Description', style: 'tableHeader' },
          { text: 'Amount', style: 'tableHeader', alignment: 'right' },
          { text: 'GST', style: 'tableHeader', alignment: 'right' },
          { text: 'PST', style: 'tableHeader', alignment: 'right' }
        ]
      ]
      
      // Add entries for this category
      Object.entries(category.jobGroups).forEach(([jobNumber, jobGroup]) => {
        jobGroup.requests.forEach(request => {
          if (request.status === 'completed') {
            categoryHasCompletedClaims = true
            const amount = parseFloat(request.amount) || 0
            const gst = parseFloat(request.gst_amount) || 0
            const pst = parseFloat(request.pst_amount) || 0
            
            categoryTotal += amount
            categoryGst += gst
            categoryPst += pst
            
            overallTotal += amount
            overallGst += gst
            overallPst += pst
            
            tableBody.push([
              formatDate(request.date),
              request.job_number,
              {
                text: [
                  request.description,
                  request.related_employee ? `\nEmployee: ${request.related_employee}` : '',
                  request.client_name ? `\nClient: ${request.client_name}${request.company_name ? ` (${request.company_name})` : ''}` : '',
                  request.is_travel ? `\nFrom: ${request.start_location} To: ${request.destination}` : ''
                ],
                fontSize: 9
              },
              { text: formatCurrency(amount), alignment: 'right' },
              { text: formatCurrency(gst), alignment: 'right' },
              { text: formatCurrency(pst), alignment: 'right' }
            ])
          }
        })
      })
      
      // Only add this category if it has completed claims
      if (categoryHasCompletedClaims) {
        // Add category header
        docContent.push({
          text: category.name + (category.subcategoryName ? ` - ${category.subcategoryName}` : ''),
          style: 'categoryHeader',
          margin: [0, 10, 0, 5]
        })
        
        // Add category table
        docContent.push({
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'],
            body: tableBody
          },
          layout: 'lightHorizontalLines'
        })
        
        // Add category subtotal
        docContent.push({
          columns: [
            { width: '*', text: '' },
            {
              width: 'auto',
              table: {
                body: [
                  [
                    { text: 'Category Subtotal:', style: 'subtotalLabel' },
                    { text: formatCurrency(categoryTotal), style: 'subtotalValue', alignment: 'right' }
                  ],
                  [
                    { text: 'Category GST:', style: 'subtotalLabel' },
                    { text: formatCurrency(categoryGst), style: 'subtotalValue', alignment: 'right' }
                  ],
                  [
                    { text: 'Category PST:', style: 'subtotalLabel' },
                    { text: formatCurrency(categoryPst), style: 'subtotalValue', alignment: 'right' }
                  ]
                ]
              },
              layout: {
                hLineWidth: function(i, node) { return 0; },
                vLineWidth: function(i, node) { return 0; },
                paddingLeft: function(i) { return 4; },
                paddingRight: function(i) { return 4; },
                paddingTop: function(i) { return 2; },
                paddingBottom: function(i) { return 2; }
              },
              margin: [0, 5, 0, 15]
            }
          ]
        })
      }
    })
    
    // Add grand total
    docContent.push({
      columns: [
        { width: '*', text: '' },
        {
          width: 'auto',
          table: {
            body: [
              [
                { text: 'TOTAL GST:', style: 'totalLabel' },
                { text: formatCurrency(overallGst), style: 'totalValue', alignment: 'right' }
              ],
              [
                { text: 'TOTAL PST:', style: 'totalLabel' },
                { text: formatCurrency(overallPst), style: 'totalValue', alignment: 'right' }
              ],
              [
                { text: 'TOTAL AMOUNT:', style: 'totalLabel' },
                { text: formatCurrency(overallTotal), style: 'totalValue', alignment: 'right' }
              ]
            ]
          },
          layout: {
            hLineWidth: function(i, node) { return (i === 0 || i === node.table.body.length) ? 1 : 0; },
            vLineWidth: function(i, node) { return 0; },
            hLineColor: function(i) { return '#aaa'; },
            paddingLeft: function(i) { return 4; },
            paddingRight: function(i) { return 4; },
            paddingTop: function(i) { return 3; },
            paddingBottom: function(i) { return 3; }
          },
          margin: [0, 10, 0, 0]
        }
      ]
    })

    // Create document definition
    const docDefinition = {
      content: docContent,
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          margin: [0, 0, 0, 10]
        },
        categoryHeader: {
          fontSize: 14,
          bold: true,
          color: '#333'
        },
        tableHeader: {
          bold: true,
          fontSize: 10,
          color: '#333',
          fillColor: '#f2f2f2'
        },
        subtotalLabel: {
          bold: true,
          fontSize: 10,
          margin: [0, 2, 0, 2]
        },
        subtotalValue: {
          fontSize: 10,
          margin: [0, 2, 0, 2]
        },
        totalLabel: {
          bold: true,
          fontSize: 12,
          margin: [0, 3, 0, 3]
        },
        totalValue: {
          bold: true,
          fontSize: 12,
          margin: [0, 3, 0, 3]
        }
      },
      footer: function(currentPage, pageCount) {
        return {
          columns: [
            { 
              text: `Generated on ${new Date().toLocaleDateString()}`,
              alignment: 'left',
              margin: [40, 0],
              fontSize: 8,
              color: '#777'
            },
            { 
              text: `Page ${currentPage} of ${pageCount}`,
              alignment: 'right',
              margin: [0, 0, 40, 0],
              fontSize: 8,
              color: '#777'
            }
          ],
          margin: [0, 10]
        }
      },
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 60]
    }

    // Use pdfMake to generate the PDF
    const fileName = `${employee.name.replace(/\s+/g, '_')}_Expenses_${monthName}_${yearStr}.pdf`
    $pdfMake.createPdf(docDefinition).download(fileName)
  } catch (err) {
    console.error('PDF generation error')
    toast({
      title: 'Error',
      description: 'Failed to generate PDF',
      variant: 'destructive'
    })
  }
}

// Add this function to check if all claims for an employee in the selected month are completed
const hasAllClaimsCompleted = (employeeId) => {
  const employee = organizedData.value[employeeId]
  if (!employee) return false
  
  let hasAnyRequests = false
  let allCompleted = true
  
  Object.values(employee.categories).forEach(category => {
    Object.values(category.jobGroups).forEach(jobGroup => {
      jobGroup.requests.forEach(request => {
        hasAnyRequests = true
        if (request.status !== 'completed') {
          allCompleted = false
        }
      })
    })
  })
  
  // Only return true if the employee has at least one request and all are completed
  return hasAnyRequests && allCompleted
}

// Add this function after toggleJob
const hasEmployeeSelectedRequests = (employeeId) => {
  const employee = organizedData.value[employeeId]
  
  return Object.values(employee.categories).some(category => 
    Object.values(category.jobGroups).some(jobGroup => 
      jobGroup.requests.some(request => selectedRequests.value.has(request.id))
    )
  )
}

// Initialize
onMounted(async () => {
  try {
    loading.value = true
    await fetchAvailableYears()
    await fetchCategories()
    await fetchReimbursementRequests()
    await fetchUserRole()
  } catch (err) {
    console.error('Error during initialization:', err)
    error.value = 'Failed to initialize the page'
  } finally {
    loading.value = false
  }
})

const isReceiptLoading = ref(false)
const isImageReceipt = ref(false)

// Add this function to fetch user role
const fetchUserRole = async () => {
  const { data, error } = await client
    .from('users')
    .select('role')
    .eq('id', user.value.id)
    .single()
  
  if (!error && data) {
    userRole.value = data.role
  }
}

// Add these functions for note handling
const openAddNoteDialog = (claim) => {
  selectedClaim.value = claim
  newNote.value = ''
  noteDialogOpen.value = true
}

const saveNote = async () => {
  if (!newNote.value.trim()) return
  
  try {
    const { error } = await client
      .from('claim_notes')
      .insert({
        claim_id: selectedClaim.value.id,
        note: newNote.value.trim(),
        role: userRole.value,
        user_id: user.value.id
      })
    
    if (error) throw error
    
    // Refresh the claims data
    await fetchReimbursementRequests()
    noteDialogOpen.value = false
    toast({
      title: 'Success',
      description: 'Note added successfully'
    })
  } catch (err) {
    console.error('Error adding note:', err)
    toast({
      title: 'Error',
      description: 'Failed to add note',
      variant: 'destructive'
    })
  }
}

// Add this helper function
const getTotalNotes = (request) => {
  return request.notes?.length || 0
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center">
      <h1 class="text-xl font-bold">All Expense Reimbursements</h1>
    </div>
    
    <!-- Month navigation tabs -->
    <div class="flex flex-col lg:flex-row items-stretch lg:items-center text-responsive-base gap-2">
      <div class="w-full lg:w-32 text-sm ">
        <Select v-model="selectedYear">
          <SelectTrigger class="h-8 w-full shadow-none bg-white">
            <div class="flex items-center">
              <CalendarIcon class="w-4 h-4 mr-2" />
              <SelectValue :placeholder="String(selectedYear)" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem 
              v-for="year in years" 
              :key="year" 
              :value="year"
              class="text-sm"
            >
              {{ year }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex w-full grow relative px-1">
        <div class="flex items-center w-full">
          <button 
            class="p-1 bg-black rounded-sm z-10 shrink-0"
            @click="changeMonth((selectedMonth - 1 + 12) % 12)"
          >
            <ChevronLeft class="h-4 w-4 text-white" />
          </button>
          
          <div class="flex overflow-x-auto relative w-full mx-1 scrollbar-hide">
            <div class="absolute left-0 w-4 h-full bg-gradient-to-r from-background to-transparent pointer-events-none z-[1]"></div>
            <div class="flex w-full justify-start lg:justify-center px-1 min-w-0">
              <div class="flex space-x-2 h-full">
                <button 
                  v-for="(month, index) in months" 
                  :key="index"
                  :class="[
                    'px-2 py-1 whitespace-nowrap text-sm shrink-0 relative mt-2 mb-1 rounded-md',
                    selectedMonth === index ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary hover:text-white'
                  ]"
                  @click="changeMonth(index)"
                >
                  {{ month }}
                  <div 
                    v-if="monthlyClaimStatus[index]"
                    class="absolute -top-2 -right-1 w-3 h-3 rounded-full border-2 border-background"
                    :class="{
                      'bg-red-500': monthlyClaimStatus[index] === 'has-claims',
                      'bg-green-500': monthlyClaimStatus[index] === 'completed'
                    }"
                  ></div>
                </button>
              </div>
            </div>
            <div class="absolute right-0 w-4 h-full bg-gradient-to-l from-background to-transparent pointer-events-none z-[1]"></div>
          </div>

          <button 
            class="p-1 bg-black rounded-sm z-10 shrink-0"
            @click="changeMonth((selectedMonth + 1) % 12)"
          >
            <ChevronRight class="h-4 w-4 text-white" />
          </button>
        </div>
      </div>
    </div>
    
    <!-- Border under months -->
    <div class="h-px w-full bg-border"></div>

    <!-- Filters section -->
    <div class="flex flex-col lg:flex-row gap-2 mt-4">
      <!-- Status Filter -->
      <div class="w-full lg:w-48 flex items-center gap-1">
        <div class="flex-1">
          <Select v-model="filters.status">
            <SelectTrigger class="h-8 w-full bg-white shadow-none">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          v-if="filters.status !== 'all'"
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          @click="filters.status = 'all'"
        >
          <XCircle class="h-4 w-4" />
        </Button>
      </div>

      <!-- Date Range Filter -->
      <div class="w-full lg:w-[150px] flex items-center gap-1">
        <div class="flex-1">
          <Popover>
            <PopoverTrigger as-child>
              <Button
                variant="outline"
                :class="cn(
                  'w-full justify-start text-left font-normal h-8 bg-white shadow-none',
                  !filters.dateRange.start && 'text-muted-foreground'
                )"
              >
                <CalendarIcon class="mr-2 h-4 w-4" />
                <template v-if="filters.dateRange.start">
                  <template v-if="filters.dateRange.end">
                    {{ df.format(filters.dateRange.start.toDate(getLocalTimeZone())) }} - 
                    {{ df.format(filters.dateRange.end.toDate(getLocalTimeZone())) }}
                  </template>
                  <template v-else>
                    {{ df.format(filters.dateRange.start.toDate(getLocalTimeZone())) }}
                  </template>
                </template>
                <template v-else>
                  Select date range
                </template>
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0">
              <RangeCalendar 
                v-model="filters.dateRange"
                initial-focus 
                :number-of-months="2"
                @update:start-value="(startDate) => filters.dateRange.start = startDate"
                @update:end-value="(endDate) => filters.dateRange.end = endDate"
              />
            </PopoverContent>
          </Popover>
        </div>
        <Button
          v-if="filters.dateRange.start || filters.dateRange.end"
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          @click="filters.dateRange = { start: null, end: null }"
        >
          <XCircle class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Expenses List -->
    <div>
      <div v-if="loading" class="space-y-4">
        <!-- Skeleton for 3 employee cards -->
        <div v-for="i in 3" :key="i" class="border mb-4 rounded-lg overflow-hidden shadow-sm animate-pulse">
          <!-- Employee Header Skeleton -->
          <div class="bg-primary/20 p-3 flex justify-between items-center">
            <div class="flex items-center gap-4">
              <div class="w-4 h-4 bg-muted rounded"></div>
              <div class="flex items-center gap-2">
                <div class="w-10 h-10 bg-muted rounded-full"></div>
                <div>
                  <div class="h-4 w-32 bg-muted rounded"></div>
                  <div class="h-3 w-24 bg-muted rounded mt-2"></div>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <div class="h-4 w-24 bg-muted rounded"></div>
              <div class="h-4 w-4 bg-muted rounded"></div>
            </div>
          </div>

          <!-- Category Skeleton -->
          <div class="border-t">
            <div v-for="j in 2" :key="j" class="border-t">
              <div class="flex justify-between items-center p-3 bg-background">
                <div class="flex items-center gap-2">
                  <div class="w-5 h-5 bg-muted rounded"></div>
                  <div class="h-4 w-40 bg-muted rounded"></div>
                </div>
                <div class="flex items-center gap-4">
                  <div class="h-4 w-20 bg-muted rounded"></div>
                  <div class="h-4 w-4 bg-muted rounded"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else-if="error" class="bg-destructive/20 p-4 rounded-md text-destructive">
        {{ error }}
      </div>
      
      <div v-else-if="sortedEmployeeKeys.length === 0" class="text-center py-8 text-muted-foreground">
        No reimbursement requests found matching your filters.
      </div>
      
      <div v-else>
        <!-- Employee Groups -->
        <div v-for="employeeId in sortedEmployeeKeys" :key="employeeId" class="border mb-4 rounded-lg overflow-hidden shadow-sm">
          <!-- Employee Header -->
          <div 
            class="bg-primary text-primary-foreground p-3 flex justify-between items-center cursor-pointer"
            @click="toggleEmployee(employeeId)"
          >
            <div class="flex items-center gap-2">
              <div class="mr-2" @click.stop>
                <input
                  type="checkbox"
                  :checked="isEmployeeFullySelected(employeeId)"
                  @change="toggleEmployeeSelection(employeeId, $event.target.checked)"
                  class="white-checkbox"
                />
              </div>
              <div class="flex items-center justify-between gap-2">
                <div class="bg-orange-500/50 p-2 rounded-full border border-white">
                    <User class="h-5 w-5 text-white" />
                </div>
                <div>
                    <h3 class="font-medium text-base">{{ organizedData[employeeId].name }}</h3>
                    <p class="text-xs text-primary-foreground/70">{{ organizedData[employeeId].department }}</p>
                </div>
              </div>
              <!-- Modified PDF export button to only show for employees with all completed claims -->
              <Button 
                v-if="hasAllClaimsCompleted(employeeId)"
                variant="outline" 
                size="sm"
                @click.stop="generateEmployeePDF(employeeId)"
                class="ml-2 bg-white/20 hover:bg-white/30 border-white/40"
                title="Export Completed Claims to PDF"
              >
                <Download class="h-4 w-4 mr-1" />
                PDF
              </Button>
            </div>
            <div class="flex items-center space-x-4">
              <div class="text-sm text-primary-foreground/70">
                Total: {{ formatCurrency(organizedData[employeeId].total) }}
              </div>
              <Button 
                v-if="hasEmployeeSelectedRequests(employeeId)"
                @click.stop="verifySelectedRequests(null)"
                class="bg-green-600 hover:bg-green-700 text-white"
                size="sm"
              >
                <CheckCircle2 class="mr-2 h-4 w-4" />
                Verify Selected ({{ selectedRequests.size }})
              </Button>
              <ChevronUp v-if="expandedEmployees[employeeId]" class="h-4 w-4" />
              <ChevronDown v-else class="h-4 w-4" />
            </div>
          </div>
          
          <!-- Category Groups -->
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition-all duration-200 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-2"
          >
            <div v-if="expandedEmployees[employeeId]">
              <div 
                v-for="categoryId in getSortedCategoryKeys(employeeId)" 
                :key="`${employeeId}-${categoryId}`" 
                class="border-t"
              >
                <!-- Category Header -->
                <div 
                  class="flex justify-between items-center p-3 bg-background cursor-pointer"
                  @click="toggleCategory(employeeId, categoryId)"
                >
                  <div class="text-sm font-medium flex items-center">
                    <img 
                      :src="`/icons/${organizedData[employeeId].categories[categoryId].name.toLowerCase().replace(/\s+/g, '-')}.svg`" 
                      :alt="organizedData[employeeId].categories[categoryId].name"
                      class="w-5 h-5 mr-2"
                    />
                    {{ organizedData[employeeId].categories[categoryId].name }}
                    <span v-if="organizedData[employeeId].categories[categoryId].subcategoryName" 
                          class="text-muted-foreground ml-2">
                      - {{ organizedData[employeeId].categories[categoryId].subcategoryName }}
                    </span>
                  </div>
                  <div class="flex items-center">
                    <div class="mr-4">
                      <span class="text-xs text-muted-foreground">
                        {{ Object.values(organizedData[employeeId].categories[categoryId].jobGroups)
                          .reduce((total, group) => total + group.requests.length, 0) }} Requests
                      </span>
                    </div>
                    <div class="text-sm font-medium">
                      {{ formatCurrency(organizedData[employeeId].categories[categoryId].total) }}
                    </div>
                    <ChevronUp v-if="expandedCategories[`${employeeId}-${categoryId}`]" class="h-4 w-4" />
                    <ChevronDown v-else class="h-4 w-4" />
                  </div>
                </div>
                
                <!-- Add transition to Request Details -->
                <Transition
                  enter-active-class="transition-all duration-300 ease-out"
                  enter-from-class="opacity-0 -translate-y-2"
                  enter-to-class="opacity-100 translate-y-0"
                  leave-active-class="transition-all duration-200 ease-in"
                  leave-from-class="opacity-100 translate-y-0"
                  leave-to-class="opacity-0 -translate-y-2"
                >
                  <div v-if="expandedCategories[`${employeeId}-${categoryId}`]">
                    <div v-for="(jobGroup, jobNumber) in organizedData[employeeId].categories[categoryId].jobGroups" 
                         :key="jobNumber" 
                         class="border-t">
                      <!-- Job Header -->
                      <div 
                        class="flex justify-between items-center p-2 bg-muted/30 cursor-pointer hover:bg-muted/50"
                        @click="toggleJob(employeeId, categoryId, jobNumber)"
                      >
                        <div class="flex items-center gap-2">
                          <ChevronDown v-if="!expandedJobs[`${employeeId}-${categoryId}-${jobNumber}`]" class="h-4 w-4" />
                          <ChevronUp v-else class="h-4 w-4" />
                          <span 
                            v-if="jobGroup.requests[0]?.job_number" 
                            class="font-medium"
                          >
                            Job #<span class="uppercase">{{ jobGroup.requests[0].job_number }}</span>
                          </span>
                          <span 
                            v-else-if="jobGroup.requests[0]?.license_number" 
                            class="font-medium"
                          >
                            License #<span class="uppercase">{{ jobGroup.requests[0].license_number }}</span>
                          </span>
                          <span class="text-sm text-muted-foreground">
                            ({{ jobGroup.requests.length }} items - Total: {{ formatCurrency(jobGroup.total) }})
                          </span>
                        </div>
                      </div>
                      
                      <!-- Job Entries Table -->
                      <Transition
                        enter-active-class="transition-all duration-300 ease-out"
                        enter-from-class="opacity-0 -translate-y-2"
                        enter-to-class="opacity-100 translate-y-0"
                        leave-active-class="transition-all duration-200 ease-in"
                        leave-from-class="opacity-100 translate-y-0"
                        leave-to-class="opacity-0 -translate-y-2"
                      >
                        <div v-if="expandedJobs[`${employeeId}-${categoryId}-${jobNumber}`]" class="border-t">
                          <Table class="bg-white">
                            <TableHeader>
                              <TableRow class="bg-muted/50 hover:bg-muted/50">
                                <TableHead class="w-[50px]"></TableHead>
                                <TableHead class="uppercase">Date</TableHead>
                                <TableHead class="uppercase">Description</TableHead>
                                <TableHead class="uppercase">Amount</TableHead>
                                <TableHead class="uppercase">Status</TableHead>
                                <TableHead class="uppercase">
                                  <div class="flex items-center gap-2">
                                    Notes
                                    <Badge 
                                      v-if="getTotalNotes(jobGroup.requests[0]) > 0" 
                                      class="h-5 px-1.5 bg-[#F15A1F] text-white"
                                    >
                                      {{ getTotalNotes(jobGroup.requests[0]) }}
                                    </Badge>
                                  </div>
                                </TableHead>
                                <TableHead class="uppercase">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow 
                                v-for="request in jobGroup.requests" 
                                :key="request.id"
                                class="hover:bg-muted/50"
                              >
                                <TableCell class="py-2">
                                  <input
                                    v-if="request.status === 'approved'"
                                    type="checkbox"
                                    :checked="selectedRequests.has(request.id)"
                                    @change="checked => checked.target.checked ? 
                                      selectedRequests.add(request.id) : 
                                      selectedRequests.delete(request.id)"
                                    class="white-checkbox"
                                  />
                                </TableCell>
                                <TableCell class="py-2 text-sm">{{ formatDate(request.date) }}</TableCell>
                                <TableCell class="py-2">
                                  <div class="text-sm">{{ request.description }}</div>
                                  <div v-if="request.subcategory_mapping?.subcategory?.subcategory_name" 
                                       class="text-xs text-muted-foreground mt-1">
                                    {{ request.subcategory_mapping.subcategory.subcategory_name }}
                                  </div>
                                  <div v-if="request.related_employee" class="text-xs text-muted-foreground">
                                    Employee: {{ request.related_employee }}
                                  </div>
                                  <div v-if="request.client_name || request.company_name" class="text-xs text-muted-foreground">
                                    Client: {{ request.client_name }}
                                    <template v-if="request.company_name">
                                      ({{ request.company_name }})
                                    </template>
                                  </div>
                                  <div v-if="request.is_travel" class="text-xs text-muted-foreground">
                                    From: {{ request.start_location }}<br>
                                    To: {{ request.destination }}
                                  </div>
                                </TableCell>
                                <TableCell class="py-2">
                                    <div>{{ formatCurrency(request.amount) }}</div>
                                    <div class="text-xs text-muted-foreground">
                                    <div>GST: {{ formatCurrency(request.gst_amount) }}</div>
                                    <div>PST: {{ formatCurrency(request.pst_amount) }}</div>
                                    </div>
                                </TableCell>
                                <TableCell class="py-2">
                                  <span :class="[
                                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs gap-1', 
                                  getStatusClass(request.status)
                                  ]">
                                      <Clock v-if="request.status === 'pending'" class="h-3 w-3" />
                                      <CheckCircle v-if="['approved', 'verified', 'processed'].includes(request.status)" class="h-3 w-3" />
                                      <XCircle v-if="request.status === 'rejected'" class="h-3 w-3" />
                                      <span class="font-medium">
                                          {{ formatStatus(request.status) }}
                                          <span v-if="request.status === 'rejected' && request.rejection_reason" class="font-normal">- {{ request.rejection_reason }}</span>
                                      </span>
                                  </span>
                                </TableCell>
                                <TableCell class="py-2">
                                  <div v-if="request.notes && request.notes.length > 0" class="space-y-1">
                                    <div v-for="note in request.notes" :key="note.id" class="text-sm">
                                      <span class="font-medium capitalize">{{ note.role }}:</span> {{ note.note }}
                                      <span class="text-xs text-muted-foreground ml-2">
                                        {{ formatDate(note.created_at) }}
                                      </span>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell class="py-2">
                                  <div class="flex space-x-2">
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      @click="viewReceipt(request.receipt_url)"
                                      :disabled="!request.receipt_url"
                                      class="h-7 w-7 p-0 rounded-md"
                                      title="View Receipt"
                                    >
                                      <FileText class="h-4 w-4" /> 
                                    </Button>

                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      class="h-7 w-7 p-0 rounded-md"
                                      @click="openAddNoteDialog(request)"
                                      title="Add Note"
                                    >
                                      <MessageSquare class="h-4 w-4" />
                                    </Button>
                                    
                                    <Button 
                                      v-if="request.status === 'approved'"
                                      variant="outline" 
                                      size="sm"
                                      class="h-7 w-7 p-0 bg-green-100 hover:bg-green-200 text-green-800 rounded-md"
                                      @click="verifySelectedRequests(request.id)"
                                      title="Complete Request"
                                    >
                                      <CheckCircle2 class="h-4 w-4" />
                                    </Button>
                                    
                                    <Button 
                                      v-if="request.status === 'approved'"
                                      variant="outline" 
                                      size="sm"
                                      class="h-7 w-7 p-0 bg-red-100 hover:bg-red-200 text-red-800 rounded-md"
                                      @click="rejectRequest(request.id)"
                                      title="Reject Request"
                                    >
                                      <XCircle class="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </Transition>
                    </div>
                  </div>
                </Transition>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    
    <!-- Receipt Viewer Dialog -->
    <Dialog v-model:open="viewingReceipt">
      <DialogContent class="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Receipt</DialogTitle>
        </DialogHeader>
        <div class="h-[70vh] overflow-auto">
          <!-- Loading state -->
          <div v-if="isReceiptLoading" class="flex items-center justify-center h-full">
            <Loader2 class="h-8 w-8 animate-spin text-black" />
          </div>
          <!-- For image files -->
          <img 
            v-else-if="isImageReceipt" 
            :src="currentReceiptUrl" 
            class="max-w-full max-h-full object-contain mx-auto"
            alt="Receipt"
          />
          <!-- For PDF files -->
          <iframe 
            v-else
            :src="currentReceiptUrl" 
            class="w-full h-full"
          ></iframe>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Verification Confirmation Modal -->
    <Dialog v-model:open="showVerifyModal">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Verification</DialogTitle>
          <DialogDescription>
            Are you sure you want to verify {{ verifyingRequests.length }} request{{ verifyingRequests.length > 1 ? 's' : '' }}?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div class="flex justify-end space-x-2 mt-4">
          <Button variant="outline" @click="showVerifyModal = false">Cancel</Button>
          <Button 
            class="bg-green-600 hover:bg-green-700 text-white"
            @click="confirmVerification"
          >
            Verify
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Success Modal -->
    <Dialog v-model:open="showSuccessModal">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Success</DialogTitle>
          <DialogDescription>
            {{ successMessage }}
          </DialogDescription>
        </DialogHeader>
        <div class="flex justify-end mt-4">
          <Button @click="showSuccessModal = false">Close</Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Reject Request Modal -->
    <Dialog v-model:open="showRejectModal">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Request</DialogTitle>
          <DialogDescription>
            Please provide a reason for rejecting this request.
          </DialogDescription>
        </DialogHeader>
        <div class="mt-4">
          <Label for="rejection-reason">Rejection Reason</Label>
          <Input id="rejection-reason" v-model="rejectionReason" />
        </div>
        <div class="flex justify-end space-x-2 mt-4">
          <Button variant="outline" @click="showRejectModal = false">Cancel</Button>
          <Button 
            class="bg-red-600 hover:bg-red-700 text-white"
            @click="confirmRejection"
            :disabled="!rejectionReason.trim()"
          >
            Reject
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Note Dialog -->
    <Dialog v-model:open="noteDialogOpen">
      <DialogContent class="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Add Note</DialogTitle>
          <DialogDescription>
            Add a note to this expense claim. Notes are only visible to admin, manager, and accounting roles.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="note">Note</Label>
            <Textarea
              id="note"
              v-model="newNote"
              placeholder="Enter your note here..."
              class="min-h-[100px] resize-none"
            />
          </div>
          <div class="flex justify-end space-x-2">
            <Button variant="outline" @click="noteDialogOpen = false">Cancel</Button>
            <Button @click="saveNote">Save Note</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style>
.white-checkbox {
  @apply appearance-none h-4 w-4 rounded border border-gray-300 bg-white;
  @apply checked:bg-white checked:border-primary relative cursor-pointer;
}

.white-checkbox:checked::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='black'%3E%3Cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

.transition-all {
  transition-property: all;
}

.duration-200 {
  transition-duration: 200ms;
}

.duration-300 {
  transition-duration: 300ms;
}

.ease-in {
  transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
}

.ease-out {
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
}

.rotate-180 {
  transform: rotate(180deg);
}

.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Add these to your existing styles */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: .5;
  }
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style> 