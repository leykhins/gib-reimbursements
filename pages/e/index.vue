<script setup lang="ts">
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { 
  FileText, 
  Clock,
  CheckCircle,
  XCircle,
  Plus
} from 'lucide-vue-next'
import { ref, onMounted, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

definePageMeta({
  layout: 'employee',
  middleware: ['auth', 'employee'],
  title: 'Employee Dashboard'
})

// Use Supabase client and user
const client = useSupabaseClient()
const user = useSupabaseUser()
const reimbursementRequests = ref([])
const loading = ref(true)
const error = ref(null)
const categories = ref({})
const subcategories = ref({})

// Store signed URLs for receipts
const receiptSignedUrls = ref({})

// Add these variables for receipt viewing
const viewingReceipt = ref(false)
const currentReceiptUrl = ref('')

// Add this ref for viewing rejection details
const viewingRejection = ref(false)
const currentRejection = ref(null)

// Function to get correct URL for receipt
const getReceiptUrl = async (url, requestId) => {
  if (!url) return null
  
  // If it's already a full URL, return it as is
  if (url.startsWith('http')) {
    receiptSignedUrls.value[requestId] = url
    return url
  }
  
  try {
    const { data, error } = await client.storage
      .from('receipts')
      .createSignedUrl(url, 60 * 60)
    
    if (error) throw error
    
    // Only store the signed URL without showing modal
    receiptSignedUrls.value[requestId] = data?.signedUrl || null
    return data?.signedUrl || null
  } catch (err) {
    console.error('Error getting signed URL:', err)
    return null
  }
}

// Add viewReceipt function
const viewReceipt = async (receiptUrl, requestId) => {
  if (!receiptUrl) return
  
  try {
    if (!receiptSignedUrls.value[requestId]) {
      await getReceiptUrl(receiptUrl, requestId)
    }
    
    currentReceiptUrl.value = receiptSignedUrls.value[requestId]
    viewingReceipt.value = true
  } catch (err) {
    console.error('Error viewing receipt:', err)
  }
}

// Prepare signed URLs for all receipts after fetching data
const prepareReceiptUrls = async () => {
  if (!reimbursementRequests.value?.length) return
  
  for (const request of reimbursementRequests.value) {
    if (request.receipt_url) {
      await getReceiptUrl(request.receipt_url, request.id)
    }
  }
}

// Add this function to view rejection details
const viewRejectionDetails = (request) => {
  if (request.status === 'rejected') {
    currentRejection.value = request
    viewingRejection.value = true
  }
}

// Fetch categories and reimbursement requests
const fetchReimbursementRequests = async () => {
  try {
    loading.value = true
    error.value = null
    
    if (!user.value) {
      throw new Error('User not authenticated')
    }
    
    const { data, error: fetchError } = await client
      .from('claims')
      .select(`
        id,
        description,
        amount,
        gst_amount,
        pst_amount,
        job_number,
        license_number,
        client_name,
        company_name,
        related_employee,
        is_travel,
        start_location,
        destination,
        receipt_url,
        status,
        rejection_reason,
        date,
        created_at,
        employee_id,
        employee:employee_id (
          first_name,
          last_name
        ),
        claim_categories (
          category_name,
          requires_license_number
        ),
        category_subcategory_mapping (
          claim_subcategories (
            subcategory_name
          )
        )
      `)
      .eq('employee_id', user.value.id)
      .order('created_at', { ascending: false })
    
    if (fetchError) throw fetchError
    
    reimbursementRequests.value = data || []
    await prepareReceiptUrls()
  } catch (err) {
    console.error('Error:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Fetch data on component mount
onMounted(() => {
  fetchReimbursementRequests()
})

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

// Compute top 5 reimbursement requests
const topFiveRequests = computed(() => {
  return reimbursementRequests.value.slice(0, 5);
})

// Format status text (capitalize first letter of each word)
const formatStatus = (status) => {
  return status.split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Format category text
const formatCategory = (categoryId) => {
  if (!categoryId) return 'Uncategorized'
  return categories.value[categoryId] || 'Unknown Category'
}
</script>

<template>
  <div class="text-sm">
    <!-- Header -->
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Reimbursement Dashboard</h1>
      <NuxtLink to="/e/add-expense" class="flex items-center gap-2 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
        <Plus class="h-4 w-4" />
        Add Expense
      </NuxtLink>
    </div>
    
    <!-- Stats Cards -->
    <div class="grid gap-6 md:grid-cols-3 mb-8">
      <!-- Loading State -->
      <template v-if="loading">
        <Card v-for="i in 3" :key="i">
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-4">
            <Skeleton class="h-4 w-[100px]" />
            <Skeleton class="h-4 w-4 rounded-full" />
          </CardHeader>
          <CardContent>
            <Skeleton class="h-8 w-[60px] mb-2" />
            <Skeleton class="h-3 w-[100px]" />
          </CardContent>
        </Card>
      </template>

      <!-- Loaded State -->
      <template v-else>
        <Card>
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle class="text-responsive-sm font-medium">Pending Requests</CardTitle>
            <Clock class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div class="text-responsive-2xl font-bold mb-2">{{ reimbursementRequests.filter(r => r.status === 'pending').length }}</div>
            <p class="text-responsive-xs text-muted-foreground">Awaiting approval</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle class="text-responsive-sm font-medium">Completed</CardTitle>
            <CheckCircle class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div class="text-responsive-2xl font-bold mb-2">{{ reimbursementRequests.filter(r => r.status === 'processed').length }}</div>
            <p class="text-responsive-xs text-muted-foreground">Fully processed</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle class="text-responsive-sm font-medium">Rejected</CardTitle>
            <XCircle class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div class="text-responsive-2xl font-bold mb-2">{{ reimbursementRequests.filter(r => r.status === 'rejected').length }}</div>
            <p class="text-responsive-xs text-muted-foreground">Requires revision</p>
          </CardContent>
        </Card>
      </template>
    </div>
    
    <!-- Main Table Card -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">Reimbursement History</CardTitle>
        <CardDescription class="text-xs">Your recent expense submissions</CardDescription>
      </CardHeader>
      <CardContent>
        <!-- Loading State -->
        <div v-if="loading">
          <Table>
            <TableHeader class="bg-gray-100">
              <TableRow>
                <TableHead v-for="header in ['Description', 'Amount', 'Job #', 'Category', 'Date', 'Status', 'Receipt']" 
                           :key="header" 
                           class="uppercase text-xs font-medium"
                >
                  {{ header }}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="i in 5" :key="i">
                <TableCell v-for="j in 7" :key="j" class="py-3">
                  <Skeleton :class="{'h-3 w-full': j === 1, 
                                   'h-3 w-16': j === 2, 
                                   'h-3 w-12': j === 3,
                                   'h-3 w-24': j === 4,
                                   'h-3 w-20': j === 5,
                                   'h-5 w-20': j === 6,
                                   'h-7 w-16': j === 7}" />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        
        <!-- Error State -->
        <div v-else-if="error" class="text-center py-4">
          <p class="text-red-500 text-xs">Error: {{ error }}</p>
        </div>
        
        <!-- Content State -->
        <div v-else>
          <div v-if="reimbursementRequests.length === 0" class="text-center py-4">
            <p class="text-muted-foreground text-xs">No reimbursement requests found</p>
          </div>
          <div v-else>
            <Table>
              <TableHeader class="bg-gray-100">
                <TableRow>
                  <TableHead class="uppercase text-xs font-medium">Reference #</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Category</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Description</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Amount</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Date</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Status</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="request in topFiveRequests" :key="request.id">
                  <TableCell class="text-xs py-3">
                    <template v-if="request.claim_categories?.requires_license_number">
                      License: {{ request.license_number || 'N/A' }}
                    </template>
                    <template v-else>
                      Job: {{ request.job_number || 'N/A' }}
                    </template>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    <div class="font-medium">{{ request.claim_categories?.category_name }}</div>
                    <div class="text-muted-foreground">{{ request.category_subcategory_mapping?.claim_subcategories?.subcategory_name }}</div>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    <div class="font-medium">Note: {{ request.description }}</div>
                    <div v-if="request.related_employee" class="text-muted-foreground">
                      Employee: {{ request.related_employee }}
                    </div>
                    <div v-if="request.client_name || request.company_name" class="text-muted-foreground">
                      Client: {{ request.client_name }}
                      <template v-if="request.company_name">
                        ({{ request.company_name }})
                      </template>
                    </div>
                    <div v-if="request.is_travel" class="text-muted-foreground">
                      From: {{ request.start_location }}<br>
                      To: {{ request.destination }}
                    </div>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    <div>{{ formatCurrency(request.amount) }}</div>
                    <div class="text-muted-foreground">
                      GST: {{ formatCurrency(request.gst_amount || 0) }}<br>
                      PST: {{ formatCurrency(request.pst_amount || 0) }}
                    </div>
                  </TableCell>
                  <TableCell class="text-xs py-3">{{ formatDate(request.date) }}</TableCell>
                  
                  <TableCell class="py-3">
                    <span 
                      :class="{
                        'bg-yellow-100 text-yellow-800': request.status === 'pending',
                        'bg-green-100 text-green-800': ['approved', 'verified', 'processed'].includes(request.status),
                        'bg-red-100 text-red-800': request.status === 'rejected'
                      }"
                      class="px-2 py-0.5 rounded-full text-xs inline-flex items-center gap-1"
                    >
                      <Clock v-if="request.status === 'pending'" class="h-3 w-3" />
                      <CheckCircle v-if="['approved', 'verified', 'processed'].includes(request.status)" class="h-3 w-3" />
                      <XCircle v-if="request.status === 'rejected'" class="h-3 w-3" />
                      <span class="font-medium">
                        {{ formatStatus(request.status) }}
                        <span v-if="request.status === 'rejected' && request.rejection_reason" class="font-normal">: {{ request.rejection_reason }}</span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell class="py-3">
                    <Button 
                      v-if="request.receipt_url" 
                      @click="viewReceipt(request.receipt_url, request.id)" 
                      size="sm"
                      variant="outline"
                      class="h-7 text-xs"
                    >
                      <FileText class="h-3 w-3 mr-1" />
                      View
                    </Button>
                    <span v-else class="text-muted-foreground text-xs">No receipt</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            
            <div class="flex justify-end mt-4">
              <Button variant="outline" size="sm" @click="$router.push('/e/expenses')" class="text-xs">
                View All Requests
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Receipt Dialog -->
    <Dialog v-model:open="viewingReceipt">
      <DialogContent class="max-w-4xl">
        <DialogHeader>
          <DialogTitle class="text-sm">Receipt</DialogTitle>
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

    <!-- Rejection Details Dialog -->
    <Dialog v-model:open="viewingRejection">
      <DialogContent>
        <DialogHeader>
          <DialogTitle class="text-sm">Claim Rejection</DialogTitle>
        </DialogHeader>
        <div class="space-y-3">
          <div v-if="currentRejection">
            <div class="text-muted-foreground text-xs mb-2">
              {{ formatDate(currentRejection.date) }}
            </div>
            <div class="font-medium mb-1">{{ currentRejection.description }}</div>
            <div class="text-sm mb-2">
              {{ formatCurrency(currentRejection.amount) }}
            </div>
            <div class="text-sm font-medium mt-4">Rejection Reason:</div>
            <div class="p-3 bg-red-50 border border-red-100 rounded-md mt-1">
              {{ currentRejection.rejection_reason || 'No reason provided' }}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>