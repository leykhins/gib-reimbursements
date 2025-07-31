<script setup lang="ts">
  import { ref, computed, onMounted } from 'vue'
  import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
  import { Button } from '@/components/ui/button'
  import { DollarSign, Clock, CheckCircle, FileText, ArrowUpRight } from 'lucide-vue-next'
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
  import { toast } from '@/components/ui/toast'
  import { Skeleton } from '@/components/ui/skeleton'
  
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
  
  // Recent claims
  const recentClaims = ref([])
  
  onMounted(async () => {
    try {
      loading.value = true
      
      // Fetch dashboard stats for pending claims
      const { data: pendingData, error: pendingError } = await client
        .from('claims')
        .select('id, amount, gst_amount, pst_amount')
        .eq('status', 'approved')
        .is('accounting_processed_at', null)
      
      if (pendingError) throw pendingError
      
      // Fetch processed claims
      const { data: processedData, error: processedError } = await client
        .from('claims')
        .select('id, amount, gst_amount, pst_amount')
        .eq('status', 'completed')
        .not('accounting_processed_at', 'is', null)
        .order('accounting_processed_at', { ascending: false })
        .limit(10)
      
      if (processedError) throw processedError
      
      // Calculate stats with tax amounts included
      stats.value.pendingPayments = pendingData.length
      stats.value.processedPayments = processedData.length
      stats.value.pendingAmount = pendingData.reduce((sum, claim) => {
        const total = parseFloat(claim.amount) + 
                     (claim.gst_amount ? parseFloat(claim.gst_amount) : 0) + 
                     (claim.pst_amount ? parseFloat(claim.pst_amount) : 0)
        return sum + total
      }, 0)
      stats.value.totalReimbursed = processedData.reduce((sum, claim) => {
        const total = parseFloat(claim.amount) + 
                     (claim.gst_amount ? parseFloat(claim.gst_amount) : 0) + 
                     (claim.pst_amount ? parseFloat(claim.pst_amount) : 0)
        return sum + total
      }, 0)
      
      // Fetch recent manager-approved claims with category and subcategory info
      const { data: recentData, error: recentError } = await client
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
          category_id,
          subcategory_mapping_id,
          users!claims_employee_id_fkey(first_name, last_name, department)
        `)
        .eq('status', 'approved')
        .order('date', { ascending: false })
        .limit(5)
      
      if (recentError) throw recentError
      
      // If we have claims, fetch their categories and subcategories
      if (recentData.length > 0) {
        const claimsWithCategories = await Promise.all(recentData.map(async (claim) => {
          // Get category
          const { data: categoryData } = await client
            .from('claim_categories')
            .select('category_name')
            .eq('id', claim.category_id)
            .single()
          
          // Get subcategory through mapping
          const { data: mappingData } = await client
            .from('category_subcategory_mapping')
            .select('subcategory_id')
            .eq('id', claim.subcategory_mapping_id)
            .single()
            
          if (mappingData) {
            const { data: subcategoryData } = await client
              .from('claim_subcategories')
              .select('subcategory_name')
              .eq('id', mappingData.subcategory_id)
              .single()
              
            return {
              ...claim,
              category_name: categoryData?.category_name,
              subcategory_name: subcategoryData?.subcategory_name
            }
          }
          
          return {
            ...claim,
            category_name: categoryData?.category_name,
            subcategory_name: null
          }
        }))
        
        recentClaims.value = claimsWithCategories
      }
      
    } catch (err) {
      error.value = err.message
      console.error('Error fetching dashboard data:', err)
    } finally {
      loading.value = false
    }
  })
  
  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount || 0)
  }
  
  // Format date
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }
  
  // Calculate total claim amount including taxes
  const getTotalAmount = (claim) => {
    const baseAmount = parseFloat(claim.amount || 0)
    const gst = parseFloat(claim.gst_amount || 0)
    const pst = parseFloat(claim.pst_amount || 0)
    return baseAmount + gst + pst
  }
  
  // Mark claim as processed
  const markAsProcessed = async (claimId) => {
    try {
      loading.value = true
      
      const { error: updateError } = await client
        .from('claims')
        .update({
          status: 'completed',
          accounting_processed_by: user.value.id,
          accounting_processed_at: new Date().toISOString(),
        })
        .eq('id', claimId)
      
      if (updateError) throw updateError
      
      // Remove the processed claim from the list
      recentClaims.value = recentClaims.value.filter(claim => claim.id !== claimId)
      
      // Update stats
      const processedClaim = recentClaims.value.find(claim => claim.id === claimId)
      if (processedClaim) {
        const amount = getTotalAmount(processedClaim)
        stats.value.pendingPayments--
        stats.value.pendingAmount -= amount
        stats.value.processedPayments++
        stats.value.totalReimbursed += amount
      }
      
      toast({
        title: 'Success',
        description: 'Claim marked as processed successfully',
        variant: 'default'
      })
    } catch (err) {
      console.error('Error processing claim:', err)
      toast({
        title: 'Error',
        description: 'Failed to process claim',
        variant: 'destructive'
      })
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div>  
    <div v-if="loading">
      <!-- Stats Card Skeletons -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card v-for="i in 5" :key="i">
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium">
              <Skeleton class="h-4 w-24" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center space-x-2">
              <Skeleton class="h-4 w-4 rounded-full" />
              <Skeleton class="h-8 w-16" />
            </div>
            <Skeleton class="h-3 w-32 mt-2" />
          </CardContent>
        </Card>
      </div>
      
      <!-- Recent Requests Skeleton -->
      <Card class="mt-6">
        <CardHeader>
          <CardTitle><Skeleton class="h-5 w-48" /></CardTitle>
          <CardDescription><Skeleton class="h-4 w-64" /></CardDescription>
        </CardHeader>
        <CardContent>
          <div class="overflow-x-auto">
            <Table>
              <TableHeader class="bg-gray-100">
                <TableRow>
                  <TableHead v-for="i in 6" :key="i" class="uppercase text-xs font-medium">
                    <Skeleton class="h-3 w-24" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="i in 5" :key="i">
                  <TableCell v-for="j in 6" :key="j" class="text-xs py-3">
                    <Skeleton class="h-4 w-full" />
                    <Skeleton v-if="j === 2 || j === 4" class="h-3 w-2/3 mt-1" />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div class="mt-4 flex justify-end">
            <Skeleton class="h-8 w-40" />
          </div>
        </CardContent>
      </Card>
    </div>
    
    <div v-else-if="error" class="bg-destructive/20 p-4 rounded-md text-destructive">
      {{ error }}
    </div>
    
    <div v-else>
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="text-sm font-medium">Pending Payments</CardTitle>
            <Clock class="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">{{ stats.pendingPayments }}</div>
            <p class="text-xs text-muted-foreground mt-2">
              {{ formatCurrency(stats.pendingAmount) }} awaiting processing
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="text-sm font-medium">Processed Payments</CardTitle>
            <CheckCircle class="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">{{ stats.processedPayments }}</div>
            <p class="text-xs text-muted-foreground mt-2">
              Recently processed reimbursements
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="text-sm font-medium">Total Reimbursed</CardTitle>
            <DollarSign class="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">{{ formatCurrency(stats.totalReimbursed) }}</div>
            <p class="text-xs text-muted-foreground mt-2">
              Total amount processed
            </p>
          </CardContent>
        </Card>

        <NuxtLink to="/f/pending">
          <Card class="text-center cursor-pointer hover:bg-gray-50 h-full">
            <CardHeader class="pb-2">
            </CardHeader>
            <CardContent class="flex flex-col items-center justify-center">
              <Clock class="h-6 w-6 mb-2  text-orange-500" />
            </CardContent>
            <CardFooter class="flex items-center justify-center text-sm gap-2">
              <p>Process Pending Requests</p>
              <ArrowUpRight class="h-4 w-4" />
            </CardFooter>
          </Card>
        </NuxtLink>
        
        <NuxtLink to="/f/expenses">
          <Card class="text-center content-center cursor-pointer hover:bg-gray-50 h-full">
            <CardHeader class="pb-2">
            </CardHeader>
            <CardContent class="flex flex-col items-center justify-center">
              <FileText class="h-6 w-6 mb-2  text-orange-500" />
            </CardContent>
            <CardFooter class="flex items-center justify-center text-sm gap-2">
              <p>View All Expenses</p>
              <ArrowUpRight class="h-4 w-4" />
            </CardFooter>
          </Card>
        </NuxtLink>
      </div>
      
      <!-- Recent Requests -->
      <Card class="mt-6">
        <CardHeader>
          <CardTitle>Approved Reimbursement Requests</CardTitle>
          <CardDescription>Manager-approved requests ready for payment processing</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="overflow-x-auto">
            <Table>
              <TableHeader class="bg-gray-100">
                <TableRow>
                  <TableHead class="uppercase text-xs font-medium">Reference #</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Employee</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Category</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Description</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Amount</TableHead>
                  <TableHead class="uppercase text-xs font-medium">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="claim in recentClaims" :key="claim.id">
                  <TableCell class="text-xs py-3">
                    <template v-if="claim.license_number">
                      License: {{ claim.license_number }}
                    </template>
                    <template v-else>
                      Job: {{ claim.job_number || 'N/A' }}
                    </template>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    {{ claim.users?.first_name }} {{ claim.users?.last_name }}
                    <div class="text-muted-foreground">{{ claim.users?.department }}</div>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    <div class="font-medium">{{ claim.category_name }}</div>
                    <div class="text-muted-foreground">{{ claim.subcategory_name }}</div>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    <div class="font-medium">{{ claim.description }}</div>
                  </TableCell>
                  <TableCell class="text-xs py-3">
                    <div>{{ formatCurrency(claim.amount) }}</div>
                    <div class="text-muted-foreground">
                      GST: {{ formatCurrency(claim.gst_amount || 0) }}<br>
                      PST: {{ formatCurrency(claim.pst_amount || 0) }}
                    </div>
                  </TableCell>
                  <TableCell class="text-xs py-3">{{ formatDate(claim.date) }}</TableCell>
                </TableRow>
                <TableRow v-if="recentClaims.length === 0">
                  <TableCell colSpan="7" class="py-4 text-center text-muted-foreground">No pending claims for accounting processing</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div class="mt-4 flex justify-end">
            <NuxtLink to="/f/pending">
              <Button variant="outline" size="sm" class="text-xs">View All Pending Requests</Button>
            </NuxtLink>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
