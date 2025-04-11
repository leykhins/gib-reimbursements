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
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

// State
const loading = ref(false)
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
      .from('reimbursement_requests')
      .select('status')
    
    console.log("Request response:", requestResponse);
    
    if (requestResponse.error) {
      console.error("Request error:", requestResponse.error);
      throw requestResponse.error;
    }
    
    const requestData = requestResponse.data || [];
    
    stats.value.totalRequests = requestData.length || 0
    stats.value.pendingRequests = requestData.filter(r => r.status === 'pending').length || 0
    stats.value.adminVerified = requestData.filter(r => r.status === 'admin_verified').length || 0
    stats.value.managerApproved = requestData.filter(r => r.status === 'manager_approved').length || 0
    stats.value.completed = requestData.filter(r => r.status === 'completed').length || 0
    stats.value.rejectedRequests = requestData.filter(r => r.status === 'rejected').length || 0
    
    // For display purposes, use this:
    stats.value.approvedRequests = stats.value.adminVerified + stats.value.managerApproved
    
    console.log("Fetching pending requests...");
    // Fetch pending reimbursement requests for the dashboard
    const pendingResponse = await client
      .from('reimbursement_requests')
      .select(`
        *,
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
      <main class="flex-1 overflow-y-auto p-6">
        <!-- Dashboard Overview -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-responsive-sm font-medium">Total Users</CardTitle>
              <Users class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-responsive-2xl font-bold">{{ stats.totalUsers }}</div>
              <p class="text-responsive-xs text-muted-foreground">Registered accounts</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-responsive-sm font-medium">Pending Requests</CardTitle>
              <Clock class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-responsive-2xl font-bold">{{ stats.pendingRequests }}</div>
              <p class="text-responsive-xs text-muted-foreground">Awaiting approval</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-responsive-sm font-medium">Approved</CardTitle>
              <CheckCircle class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-responsive-2xl font-bold">{{ stats.approvedRequests }}</div>
              <p class="text-responsive-xs text-muted-foreground">Ready for payment</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-responsive-sm font-medium">Rejected</CardTitle>
              <XCircle class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-responsive-2xl font-bold">{{ stats.rejectedRequests }}</div>
              <p class="text-responsive-xs text-muted-foreground">Requires revision</p>
            </CardContent>
          </Card>
        </div>
        
        <!-- Recent Pending Reimbursement Requests -->
        <Card>
          <CardHeader>
            <CardTitle>Pending Reimbursement Requests</CardTitle>
            <CardDescription>Reimbursement requests awaiting approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div v-if="loading" class="text-center py-4">
              <p class="text-muted-foreground">Loading dashboard data...</p>
            </div>
            <div v-else-if="pendingRequests.length === 0" class="text-center py-4">
              <p class="text-muted-foreground">No pending requests to display</p>
            </div>
            <div v-else class="space-y-4">
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="border-b">
                      <th class="text-left py-2 px-4 font-medium text-responsive-sm">Employee</th>
                      <th class="text-left py-2 px-4 font-medium text-responsive-sm">Description</th>
                      <th class="text-left py-2 px-4 font-medium text-responsive-sm">Amount</th>
                      <th class="text-left py-2 px-4 font-medium text-responsive-sm">Job #</th>
                      <th class="text-left py-2 px-4 font-medium text-responsive-sm">Date</th>
                      <th class="text-left py-2 px-4 font-medium text-responsive-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="request in pendingRequests" :key="request.id" class="border-b">
                      <td class="py-2 px-4 text-responsive-sm">
                        {{ 
                          request.profiles 
                            ? `${request.profiles.first_name} ${request.profiles.last_name}` 
                            : 'Unknown' 
                        }}
                      </td>
                      <td class="py-2 px-4 text-responsive-sm">{{ request.description }}</td>
                      <td class="py-2 px-4 text-responsive-sm">{{ formatCurrency(request.amount) }}</td>
                      <td class="py-2 px-4 text-responsive-sm">{{ request.job_number }}</td>
                      <td class="py-2 px-4 text-responsive-sm">{{ formatDate(request.created_at) }}</td>
                      <td class="py-2 px-4">
                        <Button size="sm" variant="outline" @click="router.push(`/a/expenses?id=${request.id}`)">
                          Review
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              <div class="flex justify-end">
                <Button variant="outline" size="sm" @click="router.push('/a/expenses')">
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
