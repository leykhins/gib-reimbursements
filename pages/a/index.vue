<script setup lang="ts">
  import { ref, onMounted, computed } from 'vue'
  import { useSupabaseClient, useSupabaseUser } from '#imports'
  import { useRouter } from 'vue-router'
  import { 
    Users, 
    UserCog, 
    Shield, 
    Home,
    DollarSign,
    FileText,
    Clock,
    CheckCircle,
    XCircle
  } from 'lucide-vue-next'
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
  import { Skeleton } from '@/components/ui/skeleton'
  import { toast } from '@/components/ui/toast'
  import { Button } from '@/components/ui/button'

  const client = useSupabaseClient()
  const user = useSupabaseUser()
  const router = useRouter()

  // State
  const loading = ref(true)
  const isAdmin = ref(false)
  const stats = ref({
    totalUsers: 0,
    totalRequests: 0,
    pendingRequests: 0,
    adminVerified: 0,
    managerApproved: 0,
    completed: 0,
    rejectedRequests: 0
  })
  const pendingRequests = ref([])

  // Admin navigation items
  const adminNavItems = [
    { name: 'Dashboard', icon: Home, path: '/a/' },
    { name: 'Users', icon: Users, path: '/a/users' },
    { name: 'Settings', icon: UserCog, path: '/a/settings' },
  ]

  // Check if current user is admin
  const checkAdminStatus = async () => {
    if (!user.value) {
      navigateTo('/login')
      return
    }
    
    try {
      const { data, error } = await client
        .from('users')
        .select('role')
        .eq('id', user.value.id)
        .single()
      
      if (error) throw error
      
      isAdmin.value = data.role === 'admin'
      
      if (!isAdmin.value) {
        navigateTo('/e/')
        toast({
          title: 'Access Denied',
          description: 'You do not have admin privileges',
          variant: 'destructive'
        })
      }
    } catch (error) {
      console.error('Error checking admin status:', error)
      navigateTo('/e/')
    }
  }

  // Fetch dashboard stats
  const fetchDashboardStats = async () => {
    if (!isAdmin.value) return
    
    loading.value = true
    try {
      console.log("Fetching user count...");
      // Fetch user count
      const { count, error: countError } = await client
        .from('users')
        .select('*', { count: 'exact', head: true })
      
      console.log("User count response:", { count, countError });
      
      if (countError) {
        console.error("User count error:", countError);
        throw countError;
      }
      
      stats.value.totalUsers = count || 0
      
      console.log("Fetching reimbursement requests...");
      // Fetch reimbursement request stats
      const requestResponse = await client
        .from('claims')
        .select('status')
      
      console.log("Request response:", requestResponse);
      
      if (requestResponse.error) {
        console.error("Request error:", requestResponse.error);
        throw requestResponse.error;
      }
      
      const requestData = requestResponse.data || [];
      
      stats.value.totalRequests = requestData.length || 0
      stats.value.pendingRequests = requestData.filter(r => r.status === 'pending').length || 0
      stats.value.adminVerified = requestData.filter(r => r.status === 'verified').length || 0
      stats.value.managerApproved = requestData.filter(r => r.status === 'approved').length || 0
      stats.value.completed = requestData.filter(r => r.status === 'processed').length || 0
      stats.value.rejectedRequests = requestData.filter(r => r.status === 'rejected').length || 0
      
      // For display purposes, use this:
      stats.value.approvedRequests = stats.value.adminVerified + stats.value.managerApproved
      
      console.log("Fetching pending requests...");
      // Fetch pending reimbursement requests for the dashboard
      const pendingResponse = await client
        .from('claims')
        .select(`
          *,
          claim_categories:category_id(category_name),
          category_subcategory_mapping!inner(
            id,
            claim_subcategories:subcategory_id(subcategory_name)
          ),
          profiles:employee_id(first_name, last_name, email)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5)
      
      console.log("Pending response:", pendingResponse);
      
      if (pendingResponse.error) {
        console.error("Pending error:", pendingResponse.error);
        throw pendingResponse.error;
      }
      
      pendingRequests.value = pendingResponse.data || []
      
    } catch (error) {
      console.error('Error fetching dashboard stats:', error)
    } finally {
      loading.value = false
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

  // Initialize component
  onMounted(async () => {
    await checkAdminStatus()
    if (isAdmin.value) {
      await fetchDashboardStats()
    }
  })

  definePageMeta({
    layout: 'admin',
    middleware: ['auth', 'admin']
  })
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <!-- Main Content -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <main class="flex-1 overflow-y-auto">
        <!-- Dashboard Overview -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <template v-if="loading">
            <Card v-for="i in 4" :key="i">
              <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle class="text-responsive-sm font-medium">
                  <Skeleton class="h-4 w-[100px]" />
                </CardTitle>
                <Skeleton class="h-4 w-4 rounded-full" />
              </CardHeader>
              <CardContent class="space-y-2">
                <div class="text-responsive-2xl font-bold">
                  <Skeleton class="h-8 w-[60px]" />
                </div>
                <p class="text-responsive-xs text-muted-foreground">
                  <Skeleton class="h-3 w-[100px]" />
                </p>
              </CardContent>
            </Card>
          </template>
          <template v-else>
            <Card>
              <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle class="text-responsive-sm font-medium">Total Users</CardTitle>
                <Users class="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div class="text-responsive-2xl font-bold">{{ stats.totalUsers }}</div>
                <p class="text-responsive-xs text-muted-foreground">Registered accounts</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle class="text-responsive-sm font-medium">Pending Requests</CardTitle>
                <Clock class="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div class="text-responsive-2xl font-bold">{{ stats.pendingRequests }}</div>
                <p class="text-responsive-xs text-muted-foreground">Awaiting approval</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle class="text-responsive-sm font-medium">Approved</CardTitle>
                <CheckCircle class="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div class="text-responsive-2xl font-bold">{{ stats.approvedRequests }}</div>
                <p class="text-responsive-xs text-muted-foreground">Ready for payment</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle class="text-responsive-sm font-medium">Rejected</CardTitle>
                <XCircle class="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div class="text-responsive-2xl font-bold">{{ stats.rejectedRequests }}</div>
                <p class="text-responsive-xs text-muted-foreground">Requires revision</p>
              </CardContent>
            </Card>
          </template>
        </div>
        
        <!-- Recent Pending Reimbursement Requests -->
        <Card>
          <CardHeader>
            <CardTitle>Pending Reimbursement Requests</CardTitle>
            <CardDescription>Reimbursement requests awaiting approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div v-if="loading" class="text-center py-4">
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
            <div v-else-if="pendingRequests.length === 0" class="text-center py-4">
              <p class="text-muted-foreground">No pending requests to display</p>
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
                  <TableRow v-for="request in pendingRequests" :key="request.id">
                    <TableCell class="text-xs py-3">
                      <template v-if="request.license_number">
                        License: {{ request.license_number }}
                      </template>
                      <template v-else>
                        Job: {{ request.job_number || 'N/A' }}
                      </template>
                    </TableCell>
                    <TableCell class="text-xs py-3">
                      {{ request.profiles ? `${request.profiles.first_name} ${request.profiles.last_name}` : 'Unknown' }}
                    </TableCell>
                    <TableCell class="text-xs py-3">
                      <div class="font-medium">{{ request.claim_categories.category_name }}</div>
                      <div class="text-muted-foreground">{{ request.category_subcategory_mapping.claim_subcategories.subcategory_name }}</div>
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
                    <TableCell class="text-xs py-3">{{ formatDate(request.created_at) }}</TableCell>
                    <TableCell class="py-3">
                      <span class="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1">
                        <Clock class="h-3 w-3" />
                        Pending
                      </span>
                    </TableCell>
                    <TableCell class="py-3">
                      <Button size="sm" variant="outline" @click="router.push(`/a/pending?id=${request.id}`)" class="h-7 text-xs">
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              
              <div class="flex justify-end mt-4">
                <Button variant="outline" size="sm" @click="router.push('/a/pending')" class="text-xs">
                  View All Requests
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  </div>
</template>
