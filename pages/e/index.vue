<script setup lang="ts">
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  FileText, 
  Clock,
  CheckCircle,
  XCircle,
  Plus
} from 'lucide-vue-next'
import { ref, onMounted, computed } from 'vue'
import { Button } from '@/components/ui/button'

definePageMeta({
  layout: 'employee',
  middleware: ['auth', 'employee']
})

// Use Supabase client and user
const client = useSupabaseClient()
const user = useSupabaseUser()
const reimbursementRequests = ref([])
const loading = ref(true)
const error = ref(null)

// Store signed URLs for receipts
const receiptSignedUrls = ref({})

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
  if (!reimbursementRequests.value?.length) return
  
  for (const request of reimbursementRequests.value) {
    if (request.receipt_url) {
      await getReceiptUrl(request.receipt_url, request.id)
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
    
    const { data, error: fetchError } = await client
      .from('reimbursement_requests')
      .select('*')
      .eq('employee_id', user.value.id)
      .order('created_at', { ascending: false })
    
    if (fetchError) throw fetchError
    
    reimbursementRequests.value = data || []
    
    // Prepare receipt URLs after fetching data
    await prepareReceiptUrls()
  } catch (err) {
    console.error('Error fetching reimbursement requests:', err)
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

// Format category text (capitalize first letter of each word)
const formatCategory = (category) => {
  if (!category) return 'Uncategorized';
  
  return category.split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-responsive-2xl font-semibold tracking-tight">Reimbursement Dashboard</h1>
      <NuxtLink to="/e/add-expense" class="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md">
        <Plus class="h-4 w-4" />
        Add Expense
      </NuxtLink>
    </div>
    
    <div class="grid gap-4 md:grid-cols-3 mb-6">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-responsive-sm font-medium">Pending Requests</CardTitle>
          <Clock class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-responsive-2xl font-bold">{{ reimbursementRequests.filter(r => r.status === 'pending').length }}</div>
          <p class="text-responsive-xs text-muted-foreground">Awaiting approval</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-responsive-sm font-medium">Completed</CardTitle>
          <CheckCircle class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-responsive-2xl font-bold">{{ reimbursementRequests.filter(r => r.status === 'completed').length }}</div>
          <p class="text-responsive-xs text-muted-foreground">Fully processed</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-responsive-sm font-medium">Rejected</CardTitle>
          <XCircle class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-responsive-2xl font-bold">{{ reimbursementRequests.filter(r => r.status === 'rejected').length }}</div>
          <p class="text-responsive-xs text-muted-foreground">Requires revision</p>
        </CardContent>
      </Card>
    </div>
    
    <Card>
      <CardHeader>
        <CardTitle>Reimbursement History</CardTitle>
        <CardDescription>Your recent expense submissions</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="text-center py-4">
          <p class="text-muted-foreground">Loading your reimbursement requests...</p>
        </div>
        <div v-else-if="error" class="text-center py-4">
          <p class="text-red-500">Error: {{ error }}</p>
        </div>
        <div v-else class="space-y-4">
          <div v-if="reimbursementRequests.length === 0" class="text-center py-4 text-muted-foreground">
            No reimbursement requests found
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b">
                  <th class="text-left py-2 px-4 font-medium text-responsive-sm">Description</th>
                  <th class="text-left py-2 px-4 font-medium text-responsive-sm">Amount</th>
                  <th class="text-left py-2 px-4 font-medium text-responsive-sm">Job #</th>
                  <th class="text-left py-2 px-4 font-medium text-responsive-sm">Category</th>
                  <th class="text-left py-2 px-4 font-medium text-responsive-sm">Date</th>
                  <th class="text-left py-2 px-4 font-medium text-responsive-sm">Status</th>
                  <th class="text-left py-2 px-4 font-medium text-responsive-sm">Receipt</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="request in topFiveRequests" :key="request.id" class="border-b">
                  <td class="py-2 px-4 text-responsive-sm">{{ request.description }}</td>
                  <td class="py-2 px-4 text-responsive-sm">{{ formatCurrency(request.amount) }}</td>
                  <td class="py-2 px-4 text-responsive-sm">{{ request.job_number || 'N/A' }}</td>
                  <td class="py-2 px-4 text-responsive-sm">{{ formatCategory(request.category) }}</td>
                  <td class="py-2 px-4 text-responsive-sm">{{ formatDate(request.created_at) }}</td>
                  <td class="py-2 px-4">
                    <span 
                      :class="{
                        'bg-yellow-100 text-yellow-800': request.status === 'pending',
                        'bg-green-100 text-green-800': request.status === 'approved' || 
                                                      request.status === 'admin_verified' || 
                                                      request.status === 'manager_approved' || 
                                                      request.status === 'completed',
                        'bg-red-100 text-red-800': request.status === 'rejected'
                      }"
                      class="px-2 py-1 rounded-full text-responsive-xs font-medium"
                    >
                      {{ formatStatus(request.status) }}
                    </span>
                  </td>
                  <td class="py-2 px-4">
                    <Button 
                      v-if="request.receipt_url && receiptSignedUrls[request.id]" 
                      :href="receiptSignedUrls[request.id]" 
                      target="_blank" 
                      size="sm"
                      variant="outline"
                      class="flex items-center gap-1"
                    >
                      <FileText class="h-3 w-3" />
                      View
                    </Button>
                    <Button 
                      v-else-if="request.receipt_url" 
                      @click="getReceiptUrl(request.receipt_url, request.id)" 
                      size="sm"
                      variant="outline"
                      class="flex items-center gap-1"
                    >
                      <FileText class="h-3 w-3" />
                      Load
                    </Button>
                    <span v-else class="text-muted-foreground text-responsive-xs">No receipt</span>
                  </td>
                </tr>
              </tbody>
            </table>
            
            <div class="flex justify-end mt-4">
              <Button variant="outline" size="sm" @click="$router.push('/e/all-expenses')">
                View All Requests
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>