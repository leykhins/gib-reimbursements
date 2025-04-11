<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DollarSign, Clock, CheckCircle, FileText } from 'lucide-vue-next'

definePageMeta({
  layout: 'accounting',
  middleware: ['accountant']
})

// Use Supabase client and user
const client = useSupabaseClient()
const user = useSupabaseUser()
const loading = ref(true)
const error = ref(null)

// Dashboard stats
const stats = ref({
  pendingPayments: 0,
  processedPayments: 0,
  totalReimbursed: 0,
  pendingAmount: 0
})

// Recent reimbursement requests
const recentRequests = ref([])

onMounted(async () => {
  try {
    loading.value = true
    
    // Fetch dashboard stats
    const { data: pendingData, error: pendingError } = await client
      .from('reimbursement_requests')
      .select('id, amount')
      .eq('status', 'manager_approved')
      .is('accounting_processed_at', null)
    
    if (pendingError) throw pendingError
    
    const { data: processedData, error: processedError } = await client
      .from('reimbursement_requests')
      .select('id, amount')
      .eq('status', 'completed')
      .not('accounting_processed_at', 'is', null)
      .order('accounting_processed_at', { ascending: false })
      .limit(10)
    
    if (processedError) throw processedError
    
    // Calculate stats
    stats.value.pendingPayments = pendingData.length
    stats.value.processedPayments = processedData.length
    stats.value.pendingAmount = pendingData.reduce((sum, req) => sum + parseFloat(req.amount), 0)
    stats.value.totalReimbursed = processedData.reduce((sum, req) => sum + parseFloat(req.amount), 0)
    
    // Fetch recent requests for the dashboard
    const { data: recentData, error: recentError } = await client
      .from('reimbursement_requests')
      .select(`
        id, 
        employee_id,
        job_number,
        description,
        amount,
        status,
        created_at,
        users:employee_id(first_name, last_name, department)
      `)
      .eq('status', 'manager_approved')
      .order('created_at', { ascending: false })
      .limit(5)
    
    if (recentError) throw recentError
    recentRequests.value = recentData
    
  } catch (err) {
    error.value = err.message
    console.error('Error fetching dashboard data:', err)
  } finally {
    loading.value = false
  }
})

// Format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
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
</script>

<template>
  <div>  
    <div v-if="loading" class="flex justify-center items-center h-40">
      <div class="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
    </div>
    
    <div v-else-if="error" class="bg-destructive/20 p-4 rounded-md text-destructive">
      {{ error }}
    </div>
    
    <div v-else>
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium">Pending Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center space-x-2">
              <Clock class="h-4 w-4 text-muted-foreground" />
              <div class="text-2xl font-bold">{{ stats.pendingPayments }}</div>
            </div>
            <p class="text-xs text-muted-foreground mt-2">
              {{ formatCurrency(stats.pendingAmount) }} awaiting processing
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium">Processed Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center space-x-2">
              <CheckCircle class="h-4 w-4 text-muted-foreground" />
              <div class="text-2xl font-bold">{{ stats.processedPayments }}</div>
            </div>
            <p class="text-xs text-muted-foreground mt-2">
              Recently processed reimbursements
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium">Total Reimbursed</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center space-x-2">
              <DollarSign class="h-4 w-4 text-muted-foreground" />
              <div class="text-2xl font-bold">{{ formatCurrency(stats.totalReimbursed) }}</div>
            </div>
            <p class="text-xs text-muted-foreground mt-2">
              Total amount processed
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex flex-col space-y-2">
              <NuxtLink to="/m/expenses">
                <Button variant="outline" class="w-full justify-start">
                  <FileText class="mr-2 h-4 w-4" />
                  View All Expenses
                </Button>
              </NuxtLink>
              <NuxtLink to="/m/pending">
                <Button variant="outline" class="w-full justify-start">
                  <Clock class="mr-2 h-4 w-4" />
                  Process Pending
                </Button>
              </NuxtLink>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <!-- Recent Requests -->
      <Card class="mt-6">
        <CardHeader>
          <CardTitle>Recent Reimbursement Requests</CardTitle>
          <CardDescription>Pending manager-approved requests</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b">
                  <th class="text-left py-2 px-4 font-medium">Employee</th>
                  <th class="text-left py-2 px-4 font-medium">Department</th>
                  <th class="text-left py-2 px-4 font-medium">Job #</th>
                  <th class="text-left py-2 px-4 font-medium">Description</th>
                  <th class="text-left py-2 px-4 font-medium">Amount</th>
                  <th class="text-left py-2 px-4 font-medium">Status</th>
                  <th class="text-left py-2 px-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="request in recentRequests" :key="request.id" class="border-b hover:bg-muted/50">
                  <td class="py-2 px-4">{{ request.users?.first_name }} {{ request.users?.last_name }}</td>
                  <td class="py-2 px-4">{{ request.users?.department }}</td>
                  <td class="py-2 px-4">{{ request.job_number }}</td>
                  <td class="py-2 px-4">{{ request.description }}</td>
                  <td class="py-2 px-4">{{ formatCurrency(request.amount) }}</td>
                  <td class="py-2 px-4">
                    <span 
                      class="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800"
                    >
                      {{ request.status.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') }}
                    </span>
                  </td>
                  <td class="py-2 px-4">{{ formatDate(request.created_at) }}</td>
                </tr>
                <tr v-if="recentRequests.length === 0">
                  <td colspan="7" class="py-4 text-center text-muted-foreground">No pending manager-approved requests found</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="mt-4 flex justify-end">
            <NuxtLink to="/m/expenses">
              <Button variant="outline">View All Expenses</Button>
            </NuxtLink>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
