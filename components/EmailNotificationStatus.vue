<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold">Email Notification Status</h3>
      <Button @click="refreshStatus" :disabled="loading" size="sm">
        <RefreshCw v-if="loading" class="h-4 w-4 animate-spin" />
        <RefreshCw v-else class="h-4 w-4" />
        Refresh
      </Button>
    </div>
    
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium">Queue Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ queueLength }}</div>
          <p class="text-xs text-muted-foreground">Emails in queue</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium">Processing</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ isProcessing ? 'Yes' : 'No' }}</div>
          <p class="text-xs text-muted-foreground">Currently sending</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium">Rate Limit</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">2/s</div>
          <p class="text-xs text-muted-foreground">Emails per second</p>
        </CardContent>
      </Card>
    </div>
    
    <Card v-if="recentErrors.length > 0">
      <CardHeader>
        <CardTitle class="text-sm font-medium text-destructive">Recent Errors</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          <div v-for="error in recentErrors" :key="error.id" class="text-sm">
            <div class="font-medium">{{ error.recipient_email }}</div>
            <div class="text-muted-foreground">{{ error.error_message }}</div>
            <div class="text-xs text-muted-foreground">{{ formatDate(error.sent_at) }}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { emailRateLimiter } from '~/lib/rateLimiter'
import { format } from 'date-fns'

const loading = ref(false)
const queueLength = ref(0)
const isProcessing = ref(false)
const recentErrors = ref([])

const refreshStatus = async () => {
  loading.value = true
  try {
    queueLength.value = emailRateLimiter.getQueueLength()
    isProcessing.value = emailRateLimiter.isProcessing()
    
    // Fetch recent email errors from database
    const client = useSupabaseClient()
    const { data, error } = await client
      .from('email_notifications')
      .select('*')
      .eq('status', 'failed')
      .order('sent_at', { ascending: false })
      .limit(5)
    
    if (!error && data) {
      recentErrors.value = data
    }
  } catch (err) {
    console.error('Failed to refresh email status:', err)
  } finally {
    loading.value = false
  }
}

const formatDate = (dateString) => {
  return format(new Date(dateString), 'MMM dd, yyyy HH:mm')
}

onMounted(() => {
  refreshStatus()
  // Refresh status every 30 seconds
  setInterval(refreshStatus, 30000)
})
</script> 