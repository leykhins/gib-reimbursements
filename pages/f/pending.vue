<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MessageSquare } from 'lucide-vue-next'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

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
  Loader2
} from 'lucide-vue-next'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getReceiptSignedUrl } from '~/lib/utils'

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
  dateFrom: null,
  dateTo: null,
  employeeName: '',
  status: ''
})

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
const showRejectModal = ref(false)
const rejectingRequestId = ref(null)
const rejectionReason = ref('')
const noteDialogOpen = ref(false)
const newNote = ref('')
const selectedClaim = ref(null)
const userRole = ref('')
const verifyingRequestIds = ref(new Set())
const isVerifying = ref(false)
const isRejecting = ref(false)

// Add this new function to fetch unique years from claims
const fetchAvailableYears = async () => {
  try {
    const { data, error } = await client
      .from('claims')
      .select('date')
      .eq('status', 'approved')
    
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
      .eq('status', 'approved')
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

// Apply filters to reimbursement requests
const applyFilters = () => {
  filteredRequests.value = reimbursementRequests.value.filter(request => {
    // Only show approved requests
    if (request.status !== 'approved') {
      return false
    }
    
    const requestDate = new Date(request.date)
    const requestMonth = requestDate.getMonth()
    const requestYear = requestDate.getFullYear()
    
    // Month/Year filter
    if (requestMonth !== selectedMonth.value || requestYear !== selectedYear.value) {
      return false
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
  
  // If the category is being expanded, also expand all job groups
  if (expandedCategories.value[key]) {
    // Get all job groups for this category
    const category = organizedData.value[employeeId]?.categories[categoryId]
    if (category) {
      Object.keys(category.jobGroups).forEach(jobNumber => {
        const jobKey = `${employeeId}-${categoryId}-${jobNumber}`
        expandedJobs.value[jobKey] = true
      })
    }
  }
}

// Format helpers
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD'
  }).format(amount)
}

const formatDate = (dateString) => {
  return format(new Date(dateString), 'MMM d, yyyy')
}

const formatStatus = (status) => {
  return status.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}

// Receipt handling
const isReceiptLoading = ref(false)
const isImageReceipt = ref(false)
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
  
  // Collect all approved requests for this employee
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
  const pendingRequests = []
  
  Object.values(employee.categories).forEach(category => {
    Object.values(category.jobGroups).forEach(jobGroup => {
      jobGroup.requests.forEach(request => {
        if (request.status === 'approved') {
          pendingRequests.push(request.id)
        }
      })
    })
  })
  
  return pendingRequests.length > 0 && 
         pendingRequests.every(id => selectedRequests.value.has(id))
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
    verifyingRequests.value.forEach(id => verifyingRequestIds.value.add(id))
    
    const promises = verifyingRequests.value.map(async (id) => {
      try {
        const { error: updateError } = await client
          .from('claims')
          .update({
            status: 'completed',
            accounting_processed_by: user.value.id,
            accounting_processed_at: new Date().toISOString()
          })
          .eq('id', id)
        
        if (updateError) throw updateError
      } finally {
        verifyingRequestIds.value.delete(id)
      }
    })
    
    await Promise.all(promises)
    
    // Send notifications - consolidated if multiple, individual if single
    try {
      if (verifyingRequests.value.length > 1) {
        const { sendConsolidatedProcessingCompleteEmail } = await import('~/lib/notifications')
        await sendConsolidatedProcessingCompleteEmail(verifyingRequests.value)
      } else {
        const { sendClaimProcessedEmail } = await import('~/lib/notifications')
        await sendClaimProcessedEmail(verifyingRequests.value[0])
      }
    } catch (emailError) {
      console.error('Failed to send email notification:', emailError)
    }
    
    // Show success modal
    successMessage.value = `Successfully verified ${verifyingRequests.value.length} request${verifyingRequests.value.length > 1 ? 's' : ''}`
    showSuccessModal.value = true
    showVerifyModal.value = false
    
    // Refresh the list and clear selections
    selectedRequests.value.clear()
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error verifying requests:', err)
    toast({
      title: 'Error',
      description: 'Failed to verify some requests',
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
  
  // Only process claims for the selected year
  reimbursementRequests.value.forEach(request => {
    const date = new Date(request.date)
    if (date.getFullYear() === selectedYear.value) {
      const month = date.getMonth()
      if (request.status === 'approved') {
        status[month] = 'approved'
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

// Add this function near the other request handling functions
const rejectRequest = async (requestId) => {
  rejectingRequestId.value = requestId
  rejectionReason.value = ''
  showRejectModal.value = true
}

// Update the confirmRejection function
const confirmRejection = async () => {
  try {
    isRejecting.value = true
    const { error } = await client
      .from('claims')
      .update({
        status: 'rejected',
        accounting_processed_by: user.value.id,
        accounting_processed_at: new Date().toISOString(),
        rejection_reason: rejectionReason.value
      })
      .eq('id', rejectingRequestId.value)
    
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

// Add this function after the toggleJob function
const hasEmployeeSelectedRequests = (employeeId) => {
  const employee = organizedData.value[employeeId]
  
  return Object.values(employee.categories).some(category => 
    Object.values(category.jobGroups).some(jobGroup => 
      jobGroup.requests.some(request => selectedRequests.value.has(request.id))
    )
  )
}

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
</script>

<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center">
      <h1 class="text-xl font-bold">Manager Approved Reimbursements</h1>
    </div>
    
    <!-- Month navigation tabs -->
    <div class="flex flex-col lg:flex-row items-stretch lg:items-center text-responsive-base gap-2">
      <div class="w-full bg-white lg:w-32 text-sm">
        <Select v-model="selectedYear">
          <SelectTrigger class="h-8 w-full">
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
              class="bg-white text-sm"
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
                      'bg-red-500': monthlyClaimStatus[index] === 'approved'
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
            <div class="flex items-center">
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
                :disabled="isVerifying"
              >
                <template v-if="isVerifying">
                  <svg class="animate-spin mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </template>
                <template v-else>
                  <CheckCircle2 class="mr-2 h-4 w-4" />
                  Process Selected ({{ selectedRequests.size }})
                </template>
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
                
                <!-- Job Groups -->
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
                                <TableHead class="uppercase">Notes</TableHead>
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
                                      <span class="font-medium">{{ note.role }}:</span> {{ note.note }}
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
                                      v-if="request.status === 'approved'"
                                      variant="outline" 
                                      size="sm"
                                      class="h-7 w-7 p-0 bg-green-100 hover:bg-green-200 text-green-800 rounded-md"
                                      @click="verifySelectedRequests(request.id)"
                                      :disabled="verifyingRequestIds.has(request.id)"
                                      title="Process Request"
                                    >
                                      <template v-if="verifyingRequestIds.has(request.id)">
                                        <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                      </template>
                                      <template v-else>
                                        <CheckCircle2 class="h-4 w-4" />
                                      </template>
                                    </Button>
                                    
                                    <Button 
                                      v-if="request.status === 'approved'"
                                      variant="outline" 
                                      size="sm"
                                      class="h-7 w-7 p-0 bg-red-100 hover:bg-red-200 text-red-800 rounded-md"
                                      @click="rejectRequest(request.id)"
                                      :disabled="isRejecting && rejectingRequestId === request.id"
                                      title="Reject Request"
                                    >
                                      <template v-if="isRejecting && rejectingRequestId === request.id">
                                        <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                      </template>
                                      <template v-else>
                                        <XCircle class="h-4 w-4" />
                                      </template>
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
          <DialogTitle>Confirm Processing</DialogTitle>
          <DialogDescription>
            Are you sure you want to process {{ verifyingRequests.length }} request{{ verifyingRequests.length > 1 ? 's' : '' }}?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div class="flex justify-end space-x-2 mt-4">
          <Button variant="outline" @click="showVerifyModal = false" :disabled="isVerifying">Cancel</Button>
          <Button 
            class="bg-green-600 hover:bg-green-700 text-white"
            @click="confirmVerification"
            :disabled="isVerifying"
          >
            <template v-if="isVerifying">
              <svg class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </template>
            <template v-else>
              Process
            </template>
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
          <Button variant="outline" @click="showRejectModal = false" :disabled="isRejecting">Cancel</Button>
          <Button 
            class="bg-red-600 hover:bg-red-700 text-white"
            @click="confirmRejection"
            :disabled="!rejectionReason.trim() || isRejecting"
          >
            <template v-if="isRejecting">
              <svg class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Rejecting...
            </template>
            <template v-else>
              Reject
            </template>
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