<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarIcon, ChevronLeft, ChevronRight, Search, Filter, FileText, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-vue-next'
import { format } from 'date-fns'
import { toast } from '@/components/ui/toast'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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

// Pagination
const itemsPerPage = 12
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(Object.keys(groupedRequests.value).length / itemsPerPage))

// Filters
const filters = ref({
  jobNumber: '',
  expenseType: '',
  dateFrom: null,
  dateTo: null,
  status: 'manager_approved'
})

// Categories from add-expense page
const categories = {
  'general': 'General Expense',
  'travel': 'Travel',
  'meals': 'Meals & Entertainment',
  'supplies': 'Office Supplies',
  'car': 'Car Mileage',
  'transport': 'Public Transport'
}

// Store signed URLs for receipts
const receiptSignedUrls = ref({})

// Track expanded job groups
const expandedGroups = ref({})

// Group expenses by job number and sort by date
const groupedRequests = computed(() => {
  const groups = {}
  
  filteredRequests.value.forEach(request => {
    const jobNumber = request.job_number
    
    if (!groups[jobNumber]) {
      groups[jobNumber] = []
    }
    
    groups[jobNumber].push(request)
  })
  
  // Sort expenses within each group by date (newest first)
  Object.keys(groups).forEach(jobNumber => {
    groups[jobNumber].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  })
  
  return groups
})

// Get paginated job numbers
const paginatedJobNumbers = computed(() => {
  const jobNumbers = Object.keys(groupedRequests.value)
  const start = (currentPage.value - 1) * itemsPerPage
  const end = start + itemsPerPage
  return jobNumbers.slice(start, end)
})

// Function to get correct URL for receipt
const getReceiptUrl = async (url, requestId) => {
  if (!url) return null
  
  // If it's already a full URL, return it as is
  if (url.startsWith('http')) {
    receiptSignedUrls.value[requestId] = url
    return url
  }
  
  try {
    // Get signed URL from Supabase storage (authenticated)
    const { data, error } = await client.storage
      .from('receipts')
      .createSignedUrl(url, 60 * 60) // 1 hour expiry
    
    if (error) throw error
    
    // Store the signed URL
    receiptSignedUrls.value[requestId] = data?.signedUrl || null
    return data?.signedUrl || null
  } catch (err) {
    console.error('Error getting signed URL:', err)
    return null
  }
}

// Prepare signed URLs for all receipts after fetching data
const prepareReceiptUrls = async () => {
  for (const jobNumber of paginatedJobNumbers.value) {
    if (expandedGroups.value[jobNumber]) {
      for (const request of groupedRequests.value[jobNumber]) {
        if (request.receipt_url && !receiptSignedUrls.value[request.id]) {
          await getReceiptUrl(request.receipt_url, request.id)
        }
      }
    }
  }
}

// Fetch reimbursement requests for the current user
const fetchReimbursementRequests = async () => {
  try {
    loading.value = true
    error.value = null
    
    if (!user.value) {
      throw new Error('User not authenticated')
    }
    
    let query = client
      .from('reimbursement_requests')
      .select(`
        *,
        employee:employee_id (
          first_name,
          last_name,
          department
        )
      `)
      
    // Apply status filter directly in the query for better performance
    if (filters.value.status) {
      query = query.eq('status', filters.value.status)
    }
    
    query = query.order('created_at', { ascending: false })
    
    const { data, error: fetchError } = await query
    
    if (fetchError) throw fetchError
    
    reimbursementRequests.value = data || []
    applyFilters()
  } catch (err) {
    console.error('Error fetching reimbursement requests:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Apply filters to the reimbursement requests
const applyFilters = () => {
  filteredRequests.value = reimbursementRequests.value.filter(request => {
    // Filter by job number
    if (filters.value.jobNumber && !request.job_number.includes(filters.value.jobNumber)) {
      return false
    }
    
    // Filter by expense type (travel or non-travel)
    if (filters.value.expenseType) {
      if (filters.value.expenseType === 'travel' && !request.is_travel) {
        return false
      }
      if (filters.value.expenseType === 'non-travel' && request.is_travel) {
        return false
      }
    }
    
    // Filter by date range
    const createdAt = new Date(request.created_at)
    if (filters.value.dateFrom && createdAt < filters.value.dateFrom) {
      return false
    }
    if (filters.value.dateTo) {
      const dateTo = new Date(filters.value.dateTo)
      dateTo.setHours(23, 59, 59, 999) // End of the day
      if (createdAt > dateTo) {
        return false
      }
    }
    
    // Filter by status
    if (filters.value.status && request.status !== filters.value.status) {
      return false
    }
    
    return true
  })
  
  // Reset to first page when filters change
  currentPage.value = 1
  
  // Reset expanded groups
  expandedGroups.value = {}
}

// Format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount)
}

// Format date
const formatDate = (dateString) => {
  return format(new Date(dateString), 'MMM d, yyyy')
}

// Status badge class
const getStatusClass = (status) => {
  switch (status) {
    case 'manager_approved':
      return 'bg-green-100 text-green-800'
    case 'completed':
      return 'bg-purple-100 text-purple-800'
    case 'admin_verified':
      return 'bg-blue-100 text-blue-800'
    case 'pending':
      return 'bg-yellow-100 text-yellow-800'
    case 'rejected':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

// Get expense category label
const getExpenseCategory = (request) => {
  // Use the category column directly if available
  if (request.category) {
    return categories[request.category] || 'Uncategorized';
  }
  
  // Fallback to the old logic for backward compatibility
  if (request.is_travel) {
    return request.travel_type === 'car' ? categories.car : categories.transport;
  }
  return categories.general;
}

// Toggle group expansion
const toggleGroup = async (jobNumber) => {
  expandedGroups.value[jobNumber] = !expandedGroups.value[jobNumber]
  
  // Load receipt URLs when expanding a group
  if (expandedGroups.value[jobNumber]) {
    for (const request of groupedRequests.value[jobNumber]) {
      if (request.receipt_url && !receiptSignedUrls.value[request.id]) {
        await getReceiptUrl(request.receipt_url, request.id)
      }
    }
  }
}

// Pagination controls
const nextPage = () => {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
    prepareReceiptUrls()
  }
}

const prevPage = () => {
  if (currentPage.value > 1) {
    currentPage.value--
    prepareReceiptUrls()
  }
}

// Calculate total amount for a job number
const getJobTotal = (jobNumber) => {
  return groupedRequests.value[jobNumber].reduce((sum, request) => sum + parseFloat(request.amount), 0)
}

// Watch for filter changes
watch(filters, () => {
  applyFilters()
}, { deep: true })

// Add functions to handle approve/reject actions
const approveRequest = async (request) => {
  try {
    const { error } = await client
      .from('reimbursement_requests')
      .update({
        status: 'completed',
        accounting_processed_by: user.value.id,
        accounting_processed_at: new Date().toISOString()
      })
      .eq('id', request.id)
    
    if (error) throw error
    
    // Refresh the data
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error approving request:', err)
    error.value = err.message
  }
}

const rejectRequest = async (request) => {
  try {
    const { error } = await client
      .from('reimbursement_requests')
      .update({
        status: 'rejected',
        accounting_processed_by: user.value.id,
        accounting_processed_at: new Date().toISOString()
      })
      .eq('id', request.id)
    
    if (error) throw error
    
    // Refresh the data
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error rejecting request:', err)
    error.value = err.message
  }
}

// Add these variables
const viewingReceipt = ref(false)
const currentReceiptUrl = ref('')

// Add a viewReceipt function
const viewReceipt = async (receiptUrl, showDialog = true) => {
  if (!receiptUrl) return
  
  try {
    if (!receiptSignedUrls.value[receiptUrl]) {
      // This uses an existing function, getReceiptUrl
      const signedUrl = await getReceiptUrl(receiptUrl, receiptUrl)
      
      if (!signedUrl) throw new Error('Could not get signed URL')
    }
    
    if (showDialog) {
      currentReceiptUrl.value = receiptSignedUrls.value[receiptUrl]
      viewingReceipt.value = true
    }
  } catch (err) {
    console.error('Error getting signed URL:', err)
    if (showDialog) {
      toast({
        title: 'Error',
        description: 'Could not load receipt',
        variant: 'destructive'
      })
    }
  }
}

// Helper function to format status text (capitalizes first letter of each word)
const formatStatus = (status) => {
  return status.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}

// Fetch data on component mount
onMounted(() => {
  fetchReimbursementRequests()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-bold">Manager Approved Expenses</h1>
      <Button @click="navigateTo('/e/add-expense')">
        <FileText class="mr-2 h-4 w-4" />
        New Expense
      </Button>
    </div>
    
    <!-- Filters -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
          <!-- Job Number Filter -->
          <div>
            <Label for="job-number">Job Number</Label>
            <Input id="job-number" v-model="filters.jobNumber" placeholder="Filter by job number" />
          </div>
          
          <!-- Expense Type Filter -->
          <div>
            <Label for="expense-type">Expense Type</Label>
            <select 
              id="expense-type" 
              v-model="filters.expenseType"
              class="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">All Types</option>
              <option value="travel">Travel</option>
              <option value="non-travel">Non-Travel</option>
            </select>
          </div>
          
          <!-- Status Filter -->
          <div>
            <Label for="status">Status</Label>
            <select 
              id="status" 
              v-model="filters.status"
              class="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="manager_approved">Manager Approved</option>
              <option value="admin_verified">Admin Verified</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
              <option value="">All Statuses</option>
            </select>
          </div>
          
          <!-- Date From Filter -->
          <div>
            <Label>From Date</Label>
            <Popover>
              <PopoverTrigger as-child>
                <Button variant="outline" class="w-full justify-start text-left font-normal">
                  <CalendarIcon class="mr-2 h-4 w-4" />
                  {{ filters.dateFrom ? format(filters.dateFrom, 'PPP') : 'Pick a date' }}
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0">
                <Calendar v-model="filters.dateFrom" />
              </PopoverContent>
            </Popover>
          </div>
          
          <!-- Date To Filter -->
          <div>
            <Label>To Date</Label>
            <Popover>
              <PopoverTrigger as-child>
                <Button variant="outline" class="w-full justify-start text-left font-normal">
                  <CalendarIcon class="mr-2 h-4 w-4" />
                  {{ filters.dateTo ? format(filters.dateTo, 'PPP') : 'Pick a date' }}
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0">
                <Calendar v-model="filters.dateTo" />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardContent>
    </Card>
    
    <!-- Expenses Grouped by Job Number -->
    <Card>
      <CardContent class="p-0">
        <div v-if="loading" class="p-6 text-center">
          Loading expenses...
        </div>
        <div v-else-if="error" class="p-6 text-center text-red-500">
          {{ error }}
        </div>
        <div v-else-if="Object.keys(groupedRequests).length === 0" class="p-6 text-center">
          No expenses found
        </div>
        <div v-else>
          <!-- Job Number Groups -->
          <div v-for="jobNumber in paginatedJobNumbers" :key="jobNumber" class="border-b last:border-b-0">
            <!-- Job Header -->
            <div 
              class="flex justify-between items-center p-4 hover:bg-gray-50 cursor-pointer"
              @click="toggleGroup(jobNumber)"
            >
              <div class="flex items-center">
                <div class="mr-2">
                  <ChevronDown v-if="!expandedGroups[jobNumber]" class="h-5 w-5" />
                  <ChevronUp v-else class="h-5 w-5" />
                </div>
                <div>
                  <h3 class="font-medium">Job #{{ jobNumber }}</h3>
                  <p class="text-sm text-gray-500">
                    {{ groupedRequests[jobNumber].length }} expense{{ groupedRequests[jobNumber].length > 1 ? 's' : '' }} - 
                    Total: {{ formatCurrency(getJobTotal(jobNumber)) }}
                  </p>
                </div>
              </div>
              <div>
                <span class="text-sm text-gray-500">
                  Latest: {{ formatDate(groupedRequests[jobNumber][0].created_at) }}
                </span>
              </div>
            </div>
            
            <!-- Expenses Table for this Job -->
            <div v-if="expandedGroups[jobNumber]" class="border-t">
              <table class="w-full">
                <thead>
                  <tr class="bg-gray-50">
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="request in groupedRequests[jobNumber]" :key="request.id" class="border-t hover:bg-gray-50">
                    <td class="px-4 py-3">{{ formatDate(request.created_at) }}</td>
                    <td class="px-4 py-3">{{ request.description }}</td>
                    <td class="px-4 py-3">
                      <div class="font-medium">
                        {{ request.employee ? `${request.employee.first_name} ${request.employee.last_name}` : 'Unknown' }}
                      </div>
                      <div class="text-xs text-gray-500">{{ request.employee?.department || 'Unknown' }}</div>
                    </td>
                    <td class="px-4 py-3">
                      {{ getExpenseCategory(request) }}
                      <span v-if="request.is_travel && request.travel_distance" class="block text-xs text-gray-500">
                        {{ request.travel_distance }} miles
                      </span>
                    </td>
                    <td class="px-4 py-3">{{ formatCurrency(request.amount) }}</td>
                    <td class="px-4 py-3">
                      <span :class="['px-2 py-1 rounded-full text-xs', getStatusClass(request.status)]">
                        {{ formatStatus(request.status) }}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          @click.stop="viewReceipt(request.receipt_url)"
                          :disabled="!request.receipt_url"
                          class="relative group"
                        >
                          <FileText class="h-4 w-4" />
                          <span class="sr-only">View Receipt</span>
                          <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                            View Receipt
                          </div>
                        </Button>
                        
                        <Button 
                          v-if="request.status === 'manager_approved'"
                          variant="outline" 
                          size="sm"
                          class="bg-green-100 hover:bg-green-200 text-green-700 relative group"
                          @click.stop="approveRequest(request)"
                        >
                          <CheckCircle2 class="h-4 w-4" />
                          <span class="sr-only">Accept</span>
                          <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                            Accept Request
                          </div>
                        </Button>
                        
                        <Button 
                          v-if="request.status === 'manager_approved'"
                          variant="outline" 
                          size="sm"
                          class="bg-red-100 hover:bg-red-200 text-red-700 relative group"
                          @click.stop="rejectRequest(request)"
                        >
                          <XCircle class="h-4 w-4" />
                          <span class="sr-only">Reject</span>
                          <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                            Reject Request
                          </div>
                        </Button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <!-- Pagination -->
          <div class="flex items-center justify-between px-4 py-3 border-t">
            <div>
              <p class="text-sm text-gray-700">
                Showing page {{ currentPage }} of {{ totalPages || 1 }}
                ({{ Object.keys(groupedRequests).length }} job{{ Object.keys(groupedRequests).length !== 1 ? 's' : '' }})
              </p>
            </div>
            <div class="flex space-x-2">
              <Button 
                variant="outline" 
                size="sm" 
                @click="prevPage" 
                :disabled="currentPage === 1"
              >
                <ChevronLeft class="h-4 w-4" />
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                @click="nextPage" 
                :disabled="currentPage === totalPages || totalPages === 0"
              >
                Next
                <ChevronRight class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>

  <!-- Receipt Viewer Dialog -->
  <Dialog v-model:open="viewingReceipt">
    <DialogContent class="max-w-4xl">
      <DialogHeader>
        <DialogTitle>Receipt</DialogTitle>
      </DialogHeader>
      <div class="h-[70vh] overflow-auto">
        <iframe 
          v-if="currentReceiptUrl" 
          :src="currentReceiptUrl" 
          class="w-full h-full"
        ></iframe>
      </div>
    </DialogContent>
  </Dialog>
</template>
