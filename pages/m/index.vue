<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DollarSign, Clock, CheckCircle, FileText, XCircle } from 'lucide-vue-next'
import { BarChart } from '@/components/ui/chart-bar'
import { Table, TableHeader, TableBody, TableCell, TableRow, TableHead } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

definePageMeta({
  layout: 'manager',
  middleware: ['manager']
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
  pendingAmount: 0,
  rejectedClaims: 0,
  rejectedAmount: 0
})

// Recent reimbursement requests
const recentRequests = ref([])

// Chart data
const claimsData = ref([])

// Add this computed property
const maxTotal = computed(() => {
  if (!claimsData.value.length) return 100
  return Math.max(...claimsData.value.map(item => item.total))
})

// Add these computed properties
const currentMonthTotal = computed(() => {
  if (!claimsData.value.length) return 0
  return claimsData.value[claimsData.value.length - 1].total
})

const previousMonthTotal = computed(() => {
  if (claimsData.value.length < 2) return 0
  return claimsData.value[claimsData.value.length - 2].total
})

const monthlyChange = computed(() => {
  if (previousMonthTotal.value === 0) return 0
  return ((currentMonthTotal.value - previousMonthTotal.value) / previousMonthTotal.value) * 100
})

onMounted(async () => {
  try {
    loading.value = true
    
    // Fetch dashboard stats
    const { data: pendingData, error: pendingError } = await client
      .from('claims')
      .select('id, amount')
      .eq('status', 'verified')
      .is('accounting_processed_at', null)
    
    if (pendingError) throw pendingError
    
    const { data: processedData, error: processedError } = await client
      .from('claims')
      .select('id, amount')
      .eq('status', 'completed')
      .not('accounting_processed_at', 'is', null)
    
    if (processedError) throw processedError
    
    // Get rejected claims data
    const { data: rejectedData, error: rejectedError } = await client
      .from('claims')
      .select('id, amount')
      .eq('status', 'rejected')
    
    if (rejectedError) throw rejectedError
    
    // Calculate stats
    stats.value.pendingPayments = pendingData.length
    stats.value.processedPayments = processedData.length
    stats.value.pendingAmount = pendingData.reduce((sum, req) => sum + parseFloat(req.amount), 0)
    stats.value.totalReimbursed = processedData.reduce((sum, req) => sum + parseFloat(req.amount), 0)
    stats.value.rejectedClaims = rejectedData.length
    stats.value.rejectedAmount = rejectedData.reduce((sum, req) => sum + parseFloat(req.amount), 0)
    
    // Get current user's department
    const { data: userData, error: userError } = await client
      .from('users')
      .select('department')
      .eq('id', user.value.id)
      .single()
    
    if (userError) throw userError
    
    // Fetch recent pending requests for the manager's department
    recentRequests.value = await fetchRecentRequests(userData.department)
    
    // Fetch data for the chart (last 5 months of claims)
    await fetchChartData()
    
  } catch (err) {
    error.value = err.message
    console.error('Error fetching dashboard data:', err)
  } finally {
    loading.value = false
  }
})

// Fetch chart data for the last 5 months
const fetchChartData = async () => {
  try {
    // Get current date and create proper date range
    const now = new Date()
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    
    // Generate array of last 6 months (including current month)
    // Start from oldest (5 months ago) to newest (current month)
    const chartData = []
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthKey = date.toISOString().substring(0, 7) // YYYY-MM format
      const monthLabel = monthNames[date.getMonth()]
      
      chartData.push({
        month: monthLabel,
        monthKey: monthKey,
        total: 0
      })
    }
    
    // Get claims data for the period (6 months ago from today)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1) // First day of month
    const startDate = sixMonthsAgo.toISOString().split('T')[0]
    
    const { data, error } = await client
      .from('claims')
      .select('date, amount')
      .gte('date', startDate)
      
    if (error) throw error
    
    // Process data for chart - count total claim values per month
    data.forEach(claim => {
      const claimMonth = claim.date.substring(0, 7) // YYYY-MM format
      const dataPoint = chartData.find(item => item.monthKey === claimMonth)
      
      if (dataPoint && claim.amount) {
        dataPoint.total += parseFloat(claim.amount)
      }
    })
    
    // Remove the monthKey property before passing to chart
    claimsData.value = chartData.map(({ monthKey, ...rest }) => rest)
    
  } catch (err) {
    console.error('Error fetching chart data:', err)
  }
}

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

// Format status for display
const formatStatus = (status) => {
  const statusMap = {
    'pending': 'Pending',
    'verified': 'Admin Verified',
    'approved': 'Manager Approved',
    'completed': 'Completed',
    'rejected': 'Rejected'
  }
  return statusMap[status] || status
}

// Get status variant for styling
const getStatusVariant = (status) => {
  const variantMap = {
    'pending': 'warning',
    'verified': 'info',
    'approved': 'success',
    'completed': 'success',
    'rejected': 'destructive'
  }
  return variantMap[status] || 'default'
}

// Get status icon component
const getStatusIconComponent = (status) => {
  const iconMap = {
    'pending': Clock,
    'verified': FileText,
    'approved': CheckCircle,
    'completed': CheckCircle,
    'rejected': XCircle
  }
  return iconMap[status] || FileText
}

// Fetch recent requests query update
const fetchRecentRequests = async (department) => {
  const { data, error } = await client
    .from('claims')
    .select(`
      id, 
      employee_id,
      job_number,
      license_number,
      description,
      amount,
      gst_amount,
      pst_amount,
      status,
      date,
      client_name,
      company_name,
      related_employee,
      is_travel,
      start_location,
      destination,
      users!claims_employee_id_fkey(first_name, last_name, department),
      claim_categories:category_id(category_name),
      category_subcategory_mapping:subcategory_mapping_id(
        id,
        claim_subcategories:subcategory_id(subcategory_name)
      )
    `)
    .eq('status', 'verified')  // Only show verified claims
    .eq('users.department', department)
    .order('date', { ascending: false })
    .limit(5)
  
  if (error) throw error
  return data
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
</script>

<template>
  <div>  
    <!-- Error display -->
    <div v-if="error" class="bg-destructive/20 p-4 rounded-md text-destructive">
      {{ error }}
    </div>
    
    <!-- Stats Cards with skeleton loading states -->
    <div v-else>
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <template v-if="loading">
          <!-- Skeleton Stats Cards -->
          <Card v-for="i in 4" :key="i">
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-medium">
                <Skeleton class="h-4 w-[100px]" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="flex items-center space-x-2">
                <Skeleton class="h-4 w-4 rounded-full" />
                <div class="text-2xl font-bold">
                  <Skeleton class="h-8 w-[60px]" />
                </div>
              </div>
              <p class="text-xs text-muted-foreground mt-2">
                <Skeleton class="h-3 w-[120px]" />
              </p>
            </CardContent>
          </Card>
        </template>
        
        <template v-else>
          <!-- Actual Stats Cards -->
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
              <CardTitle class="text-sm font-medium">Total Processed Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="flex items-center space-x-2">
                <CheckCircle class="h-4 w-4 text-muted-foreground" />
                <div class="text-2xl font-bold">{{ stats.processedPayments }}</div>
              </div>
              <p class="text-xs text-muted-foreground mt-2">
                {{ formatCurrency(stats.totalReimbursed) }} total reimbursed
              </p>
            </CardContent>
          </Card>

          <!-- Month Claims Value Card -->
          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-medium">Monthly Claims</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="flex items-center space-x-2">
                <DollarSign class="h-4 w-4 text-muted-foreground" />
                <div class="text-2xl font-bold">{{ formatCurrency(currentMonthTotal) }}</div>
              </div>
              <div class="flex items-center mt-2 text-xs">
                <span 
                  class="flex items-center gap-1"
                  :class="monthlyChange >= 0 ? 'text-green-600' : 'text-red-600'"
                >
                  <span v-if="monthlyChange >= 0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-up"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                  </span>
                  <span v-else>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-down"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>
                  </span>
                  {{ Math.abs(monthlyChange).toFixed(1) }}% from last month
                </span>
              </div>
            </CardContent>
          </Card>

          <!-- Rejected Claims Card -->
          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-medium">Rejected Claims</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="flex items-center space-x-2">
                <XCircle class="h-4 w-4 text-destructive" />
                <div class="text-2xl font-bold">{{ stats.rejectedClaims }}</div>
              </div>
              <p class="text-xs text-muted-foreground mt-2">
                {{ formatCurrency(stats.rejectedAmount) }} declined value
              </p>
            </CardContent>
          </Card>
        </template>
      </div>
      
      <!-- Recent Requests -->
      <Card class="mt-6">
        <CardHeader>
          <CardTitle>Pending Verified Requests</CardTitle>
          <CardDescription>Reimbursement requests verified by admin awaiting manager approval</CardDescription>
        </CardHeader>
        <CardContent>
          <div v-if="loading">
            <Table>
              <TableHeader class="bg-gray-100">
                <TableRow>
                  <TableHead v-for="header in ['Reference #', 'Employee', 'Category', 'Description', 'Amount', 'Date', 'Status', 'Actions']" 
                          :key="header" 
                          class="uppercase text-xs font-medium"
                  >
                    {{ header }}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="i in 5" :key="i">
                  <TableCell v-for="j in 8" :key="j" class="py-3">
                    <Skeleton :class="{
                      'h-3 w-12': j === 1,
                      'h-3 w-24': j === 2,
                      'h-3 w-24': j === 3,
                      'h-3 w-full': j === 4,
                      'h-3 w-16': j === 5,
                      'h-3 w-20': j === 6,
                      'h-5 w-20': j === 7,
                      'h-7 w-16': j === 8
                    }" />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div v-else-if="recentRequests.length === 0" class="text-center py-4">
            <p class="text-muted-foreground">No verified requests found in your department</p>
          </div>
          <div v-else>
            <Table>
              <TableHeader class="bg-gray-100">
                <TableRow>
                  <TableHead class="uppercase text-xs font-medium">Reference #</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Employee</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Category</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Description</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Amount</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Date</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Status</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="request in recentRequests" :key="request.id" class="hover:bg-muted/50">
                  <TableCell class="text-xs py-3">
                    <template v-if="request.license_number">
                      License: {{ request.license_number }}
                    </template>
                    <template v-else>
                      Job: {{ request.job_number || 'N/A' }}
                    </template>
                  </TableCell>
                  <TableCell class="text-xs py-3">{{ request.users?.first_name }} {{ request.users?.last_name }}</TableCell>
                  <TableCell class="text-xs py-3">
                    <div class="font-medium">{{ request.claim_categories?.category_name || 'Unknown' }}</div>
                    <div class="text-muted-foreground">{{ request.category_subcategory_mapping?.claim_subcategories?.subcategory_name || 'Unknown' }}</div>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    <div class="font-medium">{{ request.description }}</div>
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
                  <TableCell class="py-3">
                    <NuxtLink :to="`/m/pending?id=${request.id}`">
                      <Button variant="outline" size="sm" class="h-7 text-xs">Review</Button>
                    </NuxtLink>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            
            <div class="mt-4 flex justify-end">
              <NuxtLink to="/m/pending">
                <Button variant="outline" size="sm" class="text-xs">View All Requests</Button>
              </NuxtLink>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

