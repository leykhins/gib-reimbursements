<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { 
  CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Filter, 
  FileText, 
  ChevronDown, 
  ChevronUp,
  DollarSign,
  CheckCircle2,
  XCircle
} from 'lucide-vue-next'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'

definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'admin']
})

// Use Supabase client and user
const client = useSupabaseClient()
const user = useSupabaseUser()
const reimbursementRequests = ref([])
const filteredRequests = ref([])
const loading = ref(true)
const error = ref(null)
const viewingReceipt = ref(false)
const currentReceiptUrl = ref('')

// Pagination
const itemsPerPage = 10
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(filteredRequests.value.length / itemsPerPage))
const paginatedRequests = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage
  const end = start + itemsPerPage
  return filteredRequests.value.slice(start, end)
})

// Filters
const filters = ref({
  jobNumber: '',
  employeeName: '',
  status: '',
  dateFrom: null,
  dateTo: null
})

// Store signed URLs for receipts
const receiptSignedUrls = ref({})

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

// Track expanded job groups
const expandedGroups = ref({})

// Get paginated job numbers
const paginatedJobNumbers = computed(() => {
  const jobNumbers = Object.keys(groupedRequests.value)
  const start = (currentPage.value - 1) * itemsPerPage
  const end = start + itemsPerPage
  return jobNumbers.slice(start, end)
})

// Toggle group expansion
const toggleGroup = async (jobNumber) => {
  expandedGroups.value[jobNumber] = !expandedGroups.value[jobNumber]
  
  // Load receipt URLs when expanding a group
  if (expandedGroups.value[jobNumber]) {
    for (const request of groupedRequests.value[jobNumber]) {
      if (request.receipt_url && !receiptSignedUrls.value[request.receipt_url]) {
        await viewReceipt(request.receipt_url, false)
      }
    }
  }
}

// Calculate total amount for a job number
const getJobTotal = (jobNumber) => {
  return groupedRequests.value[jobNumber].reduce((sum, request) => sum + parseFloat(request.amount), 0)
}

// Fetch all reimbursement requests
const fetchReimbursementRequests = async () => {
  try {
    loading.value = true
    
    const { data, error: fetchError } = await client
      .from('reimbursement_requests')
      .select(`
        *,
        profiles:employee_id(first_name, last_name, email, department),
        manager_approver:manager_approved_by(first_name, last_name),
        admin_verifier:admin_verified_by(first_name, last_name)
      `)
      .order('created_at', { ascending: false })
    
    if (fetchError) throw fetchError
    
    reimbursementRequests.value = data
    applyFilters()
    
  } catch (err) {
    error.value = err.message
    console.error('Error fetching reimbursement requests:', err)
  } finally {
    loading.value = false
  }
}

// Apply filters to reimbursement requests
const applyFilters = () => {
  filteredRequests.value = reimbursementRequests.value.filter(request => {
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
    
    // Status filter
    if (filters.value.status && request.status !== filters.value.status) {
      return false
    }
    
    // Date range filter
    if (filters.value.dateFrom) {
      const requestDate = new Date(request.created_at)
      const fromDate = new Date(filters.value.dateFrom)
      if (requestDate < fromDate) {
        return false
      }
    }
    
    if (filters.value.dateTo) {
      const requestDate = new Date(request.created_at)
      const toDate = new Date(filters.value.dateTo)
      toDate.setHours(23, 59, 59, 999) // End of day
      if (requestDate > toDate) {
        return false
      }
    }
    
    return true
  })
  
  // Reset to first page when filters change
  currentPage.value = 1
}

// Watch for filter changes
watch(filters, () => {
  applyFilters()
}, { deep: true })

// Format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD'
  }).format(amount)
}

// Format date
const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Modified viewReceipt to support silent mode (not showing dialog)
const viewReceipt = async (receiptUrl, showDialog = true) => {
  if (!receiptUrl) return
  
  try {
    if (!receiptSignedUrls.value[receiptUrl]) {
      const { data, error } = await client.storage
        .from('receipts')
        .createSignedUrl(receiptUrl, 60)
      
      if (error) throw error
      receiptSignedUrls.value[receiptUrl] = data.signedUrl
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

// Initialize
onMounted(() => {
  fetchReimbursementRequests()
})

// Verify request (for admin)
const verifyRequest = async (requestId) => {
  try {
    const { error } = await client
      .from('reimbursement_requests')
      .update({
        status: 'admin_verified',
        admin_verified_by: user.value.id,
        admin_verified_at: new Date().toISOString()
      })
      .eq('id', requestId)
    
    if (error) throw error
    
    toast({
      title: 'Success',
      description: 'Request verified successfully',
      variant: 'default'
    })
    
    // Refresh the list
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error verifying request:', err)
    toast({
      title: 'Error',
      description: 'Failed to verify request',
      variant: 'destructive'
    })
  }
}

// Reject request (for admin)
const rejectRequest = async (requestId) => {
  try {
    const { error } = await client
      .from('reimbursement_requests')
      .update({
        status: 'rejected',
        admin_verified_by: user.value.id,
        admin_verified_at: new Date().toISOString()
      })
      .eq('id', requestId)
    
    if (error) throw error
    
    toast({
      title: 'Success',
      description: 'Request rejected',
      variant: 'default'
    })
    
    // Refresh the list
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error rejecting request:', err)
    toast({
      title: 'Error',
      description: 'Failed to reject request',
      variant: 'destructive'
    })
  }
}

// Helper function to capitalize status
const formatStatus = (status) => {
  return status.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}
</script>

<template>
  <div class="container mx-auto p-4 space-y-6">
    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-bold">Expense Reimbursements</h1>
    </div>
    
    <!-- Filters -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label for="jobNumber">Job Number</Label>
            <Input id="jobNumber" v-model="filters.jobNumber" placeholder="Filter by job #" />
          </div>
          
          <div>
            <Label for="employeeName">Employee Name</Label>
            <Input id="employeeName" v-model="filters.employeeName" placeholder="Filter by employee" />
          </div>
          
          <div>
            <Label for="status">Status</Label>
            <select 
              id="status" 
              v-model="filters.status"
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="admin_verified">Admin Verified</option>
              <option value="manager_approved">Manager Approved</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          
          <div class="flex space-x-2">
            <div class="w-1/2">
              <Label>From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    class="w-full justify-start text-left font-normal"
                    :class="{ 'text-muted-foreground': !filters.dateFrom }"
                  >
                    <CalendarIcon class="mr-2 h-4 w-4" />
                    {{ filters.dateFrom ? format(filters.dateFrom, 'PPP') : 'Pick a date' }}
                  </Button>
                </PopoverTrigger>
                <PopoverContent class="w-auto p-0">
                  <Calendar v-model="filters.dateFrom" />
                </PopoverContent>
              </Popover>
            </div>
            
            <div class="w-1/2">
              <Label>To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    class="w-full justify-start text-left font-normal"
                    :class="{ 'text-muted-foreground': !filters.dateTo }"
                  >
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
        </div>
      </CardContent>
    </Card>
    
    <!-- Reimbursement Requests Table -->
    <Card>
      <CardHeader>
        <CardTitle>Reimbursement Requests</CardTitle>
        <CardDescription>
          {{ filteredRequests.length }} requests found
        </CardDescription>
      </CardHeader>
      <CardContent class="p-0">
        <div v-if="loading" class="flex justify-center items-center h-40">
          <div class="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
        </div>
        
        <div v-else-if="error" class="bg-destructive/20 p-4 rounded-md text-destructive">
          {{ error }}
        </div>
        
        <div v-else-if="filteredRequests.length === 0" class="text-center py-8 text-muted-foreground">
          No reimbursement requests found matching your filters.
        </div>
        
        <div v-else>
          <!-- Job Number Groups -->
          <div v-for="jobNumber in paginatedJobNumbers" :key="jobNumber" class="border-b last:border-b-0">
            <!-- Job Header -->
            <div 
              class="flex justify-between items-center p-4 hover:bg-muted/50 cursor-pointer"
              @click="toggleGroup(jobNumber)"
            >
              <div class="flex items-center">
                <div class="mr-2">
                  <ChevronDown v-if="!expandedGroups[jobNumber]" class="h-5 w-5" />
                  <ChevronUp v-else class="h-5 w-5" />
                </div>
                <div>
                  <h3 class="font-medium">Job #{{ jobNumber }}</h3>
                  <p class="text-sm text-muted-foreground">
                    {{ groupedRequests[jobNumber].length }} expense{{ groupedRequests[jobNumber].length > 1 ? 's' : '' }} - 
                    Total: {{ formatCurrency(getJobTotal(jobNumber)) }}
                  </p>
                </div>
              </div>
              <div>
                <span class="text-sm text-muted-foreground">
                  Latest: {{ formatDate(groupedRequests[jobNumber][0].created_at) }}
                </span>
              </div>
            </div>
            
            <!-- Expenses Table for this Job -->
            <div v-if="expandedGroups[jobNumber]" class="border-t">
              <table class="w-full">
                <thead>
                  <tr class="bg-muted/50">
                    <th class="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Employee</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Department</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="request in groupedRequests[jobNumber]" :key="request.id" class="border-t hover:bg-muted/50">
                    <td class="px-4 py-3">{{ request.profiles?.first_name }} {{ request.profiles?.last_name }}</td>
                    <td class="px-4 py-3">{{ request.profiles?.department || 'N/A' }}</td>
                    <td class="px-4 py-3">{{ formatDate(request.created_at) }}</td>
                    <td class="px-4 py-3">{{ request.description }}</td>
                    <td class="px-4 py-3">{{ formatCurrency(request.amount) }}</td>
                    <td class="px-4 py-3">
                      <span 
                        class="px-2 py-1 rounded-full text-xs" 
                        :class="{
                          'bg-yellow-100 text-yellow-800': request.status === 'pending',
                          'bg-blue-100 text-blue-800': request.status === 'admin_verified' || request.status === 'manager_approved',
                          'bg-green-100 text-green-800': request.status === 'completed',
                          'bg-red-100 text-red-800': request.status === 'rejected'
                        }"
                      >
                        {{ formatStatus(request.status) }}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          @click="viewReceipt(request.receipt_url)"
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
                          v-if="request.status === 'pending'"
                          variant="outline" 
                          size="sm"
                          class="bg-green-100 hover:bg-green-200 text-green-700 relative group"
                          @click="verifyRequest(request.id)"
                        >
                          <CheckCircle2 class="h-4 w-4" />
                          <span class="sr-only">Verify</span>
                          <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                            Verify Request
                          </div>
                        </Button>
                        
                        <Button 
                          v-if="request.status === 'pending'"
                          variant="outline" 
                          size="sm"
                          class="bg-red-100 hover:bg-red-200 text-red-700 relative group"
                          @click="rejectRequest(request.id)"
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
              <p class="text-sm text-muted-foreground">
                Showing page {{ currentPage }} of {{ totalPages || 1 }}
                ({{ Object.keys(groupedRequests).length }} job{{ Object.keys(groupedRequests).length !== 1 ? 's' : '' }})
              </p>
            </div>
            <div class="flex space-x-2">
              <Button 
                variant="outline" 
                size="sm" 
                @click="currentPage--" 
                :disabled="currentPage === 1"
              >
                <ChevronLeft class="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                @click="currentPage++" 
                :disabled="currentPage === totalPages || totalPages === 0"
              >
                Next
                <ChevronRight class="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
    
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
  </div>
</template> 