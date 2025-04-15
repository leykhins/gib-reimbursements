<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarIcon, Plus, Trash2, Upload, ArrowLeft, Check, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'
import { GoogleApis } from 'vue'

// Add showConfirmModal ref
const showConfirmModal = ref(false)

definePageMeta({
  layout: 'employee',
  middleware: ['auth', 'employee']
})

const router = useRouter()
const client = useSupabaseClient()
const user = useSupabaseUser()
const loading = ref(false)
const error = ref('')
const uploadStatus = ref<Record<number, 'idle' | 'uploading' | 'success' | 'error'>>({})
const uploadProgress = ref<Record<number, number>>({})
const receiptUrls = ref<Record<number, string>>({})
const receiptPaths = ref<Record<number, string>>({})

// Get the runtime config
const config = useRuntimeConfig()

// Define constants for mileage calculation
const MILEAGE_RATE = 0.61 // $0.61 per kilometer

// Add Google Maps API configuration - use API key from environment
const GOOGLE_MAPS_API_KEY = config.public.googleMapsApiKey || ''
let autocompleteStart = null
let autocompleteEnd = null
let distanceMatrixService = null

// Keep existing refs and add new ones
const isGoogleMapsLoaded = ref(false)
const calculatedDistance = ref(null)
const calculatedDuration = ref(null)

// Define expense type
interface Expense {
  id: number
  jobNumber: string
  description: string
  amount: string
  date: Date
  category: string
  distance?: string
  startLocation?: string
  destination?: string
  receipt: File | null
}

// Initialize expenses array with one empty expense
const expenses = ref<Expense[]>([
  {
    id: 1,
    jobNumber: '',
    description: '',
    amount: '',
    date: new Date(),
    category: 'general',
    distance: '',
    startLocation: '',
    destination: '',
    receipt: null
  }
])

// Initialize upload status for first expense
uploadStatus.value[1] = 'idle'
uploadProgress.value[1] = 0

// Categories for dropdown
const categories = [
  { value: 'general', label: 'General Expense' },
  { value: 'meals', label: 'Meals & Entertainment' },
  { value: 'supplies', label: 'Office Supplies' },
  { value: 'car', label: 'Car Mileage' },
  { value: 'transport', label: 'Public Transport' }
]

// Calculate the mileage amount automatically
const calculateMileageAmount = (distance: string) => {
  if (!distance || isNaN(parseFloat(distance))) return '0.00'
  return (parseFloat(distance) * MILEAGE_RATE).toFixed(2)
}

// Update amount when distance changes for car mileage
const updateMileageAmount = (expenseId: number) => {
  const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
  if (expenseIndex !== -1 && expenses.value[expenseIndex].category === 'car') {
    expenses.value[expenseIndex].amount = calculateMileageAmount(expenses.value[expenseIndex].distance || '0')
  }
}

// Add a new expense form
const addExpense = () => {
  const newId = expenses.value.length + 1
  expenses.value.push({
    id: newId,
    jobNumber: '',
    description: '',
    amount: '',
    date: new Date(),
    category: 'general',
    distance: '',
    startLocation: '',
    destination: '',
    receipt: null
  })
  uploadStatus.value[newId] = 'idle'
  uploadProgress.value[newId] = 0
}

// Remove an expense form
const removeExpense = async (id: number) => {
  if (expenses.value.length > 1) {
    // If there's a receipt path, delete it from Supabase storage
    if (receiptPaths.value[id]) {
      try {
        const { error: deleteError } = await client.storage
          .from('receipts')
          .remove([receiptPaths.value[id]])
        
        if (deleteError) {
          console.error('Error deleting file from storage:', deleteError)
        }
      } catch (err) {
        console.error('Error during file deletion:', err)
      }
    }
    
    expenses.value = expenses.value.filter(expense => expense.id !== id)
    delete uploadStatus.value[id]
    delete uploadProgress.value[id]
    delete receiptUrls.value[id]
    delete receiptPaths.value[id]
  }
}

// Handle file selection and immediate upload
const handleFileUpload = async (event: Event, expenseId: number) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex !== -1) {
      expenses.value[expenseIndex].receipt = input.files[0]
      
      // Start upload immediately
      await uploadFile(input.files[0], expenseId)
    }
  }
}

// Upload file to Supabase storage
const uploadFile = async (file: File, expenseId: number): Promise<void> => {
  if (!file) return
  
  try {
    // Check if user is authenticated
    if (!user.value) {
      throw new Error('You must be logged in to upload files')
    }
    
    uploadStatus.value[expenseId] = 'uploading'
    uploadProgress.value[expenseId] = 0
    
    // Create a unique file path using user ID and timestamp
    const filePath = `${user.value.id}/${Date.now()}-${file.name}`
    
    // Create a custom upload handler to track progress
    const xhr = new XMLHttpRequest()
    
    // Track upload progress
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        uploadProgress.value[expenseId] = Math.round((event.loaded / event.total) * 100)
      }
    })
    
    // Create a Promise to handle the upload
    const uploadPromise = new Promise<void>((resolve, reject) => {
      // Use Supabase storage upload
      client.storage
        .from('receipts')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          onUploadProgress: (progress) => {
            uploadProgress.value[expenseId] = Math.round((progress.loaded / progress.total) * 100)
          }
        })
        .then(({ data, error: uploadError }) => {
          if (uploadError) {
            uploadStatus.value[expenseId] = 'error'
            reject(uploadError)
            return
          }
          
          // Store just the file path
          receiptPaths.value[expenseId] = filePath
          receiptUrls.value[expenseId] = filePath  // Store path instead of public URL
          uploadStatus.value[expenseId] = 'success'
          resolve()
        })
        .catch((err) => {
          uploadStatus.value[expenseId] = 'error'
          reject(err)
        })
    })
    
    // Wait for upload to complete
    await uploadPromise
    
  } catch (err) {
    console.error('Error uploading file:', err)
    uploadStatus.value[expenseId] = 'error'
    error.value = `Failed to upload file: ${err.message}`
  }
}

// Delete file
const deleteFile = async (expenseId: number): Promise<void> => {
  if (!receiptPaths.value[expenseId]) return
  
  try {
    // Delete file from Supabase storage
    const { error: deleteError } = await client.storage
      .from('receipts')
      .remove([receiptPaths.value[expenseId]])
    
    if (deleteError) {
      throw deleteError
    }
    
    // Clear local state
    delete receiptPaths.value[expenseId]
    delete receiptUrls.value[expenseId]
    uploadStatus.value[expenseId] = 'idle'
    uploadProgress.value[expenseId] = 0
    
    // Clear the file input
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex !== -1) {
      expenses.value[expenseIndex].receipt = null
    }
    
  } catch (err) {
    console.error('Error deleting file:', err)
    error.value = `Failed to delete file: ${err.message}`
  }
}

// Submit all expenses
const submitExpenses = async () => {
  try {
    error.value = ''
    
    // Get the current user's ID
    if (!user.value) throw new Error('User not authenticated')
    
    // Check if all non-car expense files are uploaded
    for (const expense of expenses.value) {
      if (expense.category !== 'car' && !receiptPaths.value[expense.id]) {
        throw new Error(`Receipt for expense #${expense.id} is not uploaded`)
      }
    }
    
    // Show confirmation modal instead of submitting immediately
    showConfirmModal.value = true
    
  } catch (err) {
    console.error('Error validating expenses:', err)
    error.value = typeof err === 'object' && err !== null && 'message' in err 
      ? String(err.message) 
      : 'Failed to submit expenses. Please try again.'
  }
}

// Add new function to handle confirmed submission
const confirmSubmit = async () => {
  try {
    loading.value = true
    
    // Process each expense
    for (const expense of expenses.value) {
      // Determine if it's a travel expense
      const isTravel = expense.category === 'car' || expense.category === 'transport'
      
      // Create expense record in database
      const { data: expenseData, error: expenseError } = await client
        .from('reimbursement_requests')
        .insert({
          employee_id: user.value.id,
          job_number: expense.jobNumber,
          description: expense.description,
          amount: parseFloat(expense.amount),
          is_travel: isTravel,
          travel_distance: isTravel && expense.distance ? parseFloat(expense.distance) : null,
          travel_type: isTravel ? (expense.category === 'car' ? 'car' : 'public_transport') : null,
          start_location: expense.startLocation || null,
          destination: expense.destination || null,
          receipt_url: receiptPaths.value[expense.id] || null, // Make receipt_url optional
          status: 'pending',
          category: expense.category,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single()
      
      if (expenseError) {
        console.error('Database insert error:', expenseError)
        throw new Error(`Failed to save expense: ${expenseError.message}`)
      }
    }
    
    // Close modal and navigate to dashboard
    showConfirmModal.value = false
    navigateTo('/e/')
  } catch (err) {
    console.error('Error submitting expenses:', err)
    error.value = typeof err === 'object' && err !== null && 'message' in err 
      ? String(err.message) 
      : 'Failed to submit expenses. Please try again.'
    showConfirmModal.value = false
  } finally {
    loading.value = false
  }
}

// Add function to cancel submission
const cancelSubmit = () => {
  showConfirmModal.value = false
}

// Navigate back to dashboard
const goBack = () => {
  navigateTo('/e/')
}

// For date picker
const formatDate = (date: Date) => {
  return format(date, 'PPP')
}

// Add these computed properties to handle date conversion
const formattedDates = computed(() => {
  return expenses.value.reduce((acc, expense) => {
    acc[expense.id] = formatDateForInput(expense.date)
    return acc
  }, {} as Record<number, string>)
})

// Format date for input field (YYYY-MM-DD)
const formatDateForInput = (date: Date) => {
  return date.toISOString().split('T')[0]
}

// Handle date change
const handleDateChange = (expenseId: number, dateString: string) => {
  const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
  if (expenseIndex !== -1) {
    expenses.value[expenseIndex].date = new Date(dateString)
  }
}

// Function to initialize Google Maps and related services
const initGoogleMaps = () => {
  if (window.google && window.google.maps) {
    isGoogleMapsLoaded.value = true
    
    // Initialize the Distance Matrix service
    distanceMatrixService = new window.google.maps.DistanceMatrixService()
    
    // Setup autocomplete 
    // We'll call this whenever a car expense is visible
    setupAutocomplete()

    // Watch for category changes to initialize autocomplete when car is selected
    watch(expenses, (newExpenses) => {
      // Check if any expense is a car expense
      const hasCar = newExpenses.some(e => e.category === 'car')
      if (hasCar) {
        // Wait for DOM to update before initializing autocomplete
        nextTick(() => {
          setupAutocomplete()
        })
      }
    }, { deep: true })
  }
}

// Modified function to setup the Google Places Autocomplete
const setupAutocomplete = () => {
  // Find all the input elements for car expenses
  const startInput = document.getElementById('startLocation')
  const endInput = document.getElementById('destination')
  
  if (!startInput || !endInput) {
    console.warn("Cannot find start/destination inputs")
    return
  }
  
  try {
    // Only recreate the autocomplete if it hasn't been initialized already for this input
    if (!startInput.getAttribute('data-autocomplete-initialized')) {
      const options = {
        types: ['address'],
        componentRestrictions: { country: 'ca' }
      }
      
      autocompleteStart = new window.google.maps.places.Autocomplete(startInput, options)
      startInput.setAttribute('data-autocomplete-initialized', 'true')
      
      // Use the place_changed event to update the model
      autocompleteStart.addListener('place_changed', () => {
        const place = autocompleteStart.getPlace()
        if (place && place.formatted_address) {
          // Find current car expense
          const expenseIndex = expenses.value.findIndex(e => e.category === 'car')
          if (expenseIndex !== -1) {
            // Update the startLocation value
            expenses.value[expenseIndex].startLocation = place.formatted_address
          }
          calculateDistance()
        }
      })
    }
    
    if (!endInput.getAttribute('data-autocomplete-initialized')) {
      const options = {
        types: ['address'],
        componentRestrictions: { country: 'ca' }
      }
      
      autocompleteEnd = new window.google.maps.places.Autocomplete(endInput, options)
      endInput.setAttribute('data-autocomplete-initialized', 'true')
      
      autocompleteEnd.addListener('place_changed', () => {
        const place = autocompleteEnd.getPlace()
        if (place && place.formatted_address) {
          // Find current car expense
          const expenseIndex = expenses.value.findIndex(e => e.category === 'car')
          if (expenseIndex !== -1) {
            // Update the destination value
            expenses.value[expenseIndex].destination = place.formatted_address
          }
          calculateDistance()
        }
      })
    }
  } catch (error) {
    console.error("Error setting up autocomplete:", error)
  }
}

// Modified calculate distance function to check if we have addresses
const calculateDistance = () => {
  if (!autocompleteStart || !autocompleteEnd) return
  
  const startPlace = autocompleteStart.getPlace()
  const endPlace = autocompleteEnd.getPlace()
  
  // Only calculate if both places have been selected
  if (startPlace?.formatted_address && endPlace?.formatted_address && 
      startPlace.geometry && endPlace.geometry) {
    const request = {
      origins: [startPlace.formatted_address],
      destinations: [endPlace.formatted_address],
      travelMode: 'DRIVING',
      unitSystem: window.google.maps.UnitSystem.METRIC
    }
    
    distanceMatrixService.getDistanceMatrix(request, (response, status) => {
      if (status === 'OK') {
        const results = response.rows[0].elements[0]
        if (results.status === 'OK') {
          // Get distance in kilometers
          const distanceInMeters = results.distance.value
          const distanceInKm = distanceInMeters / 1000
          calculatedDistance.value = distanceInKm.toFixed(2)
          calculatedDuration.value = results.duration.text
          
          // Update the distance field in the expense form
          const expenseIndex = expenses.value.findIndex(e => e.category === 'car')
          if (expenseIndex !== -1) {
            expenses.value[expenseIndex].distance = calculatedDistance.value
            updateMileageAmount(expenses.value[expenseIndex].id)
          }
        }
      }
    })
  }
}

// Load Google Maps API script
onMounted(() => {
  if (!window.google) {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = initGoogleMaps
    document.head.appendChild(script)
  } else {
    initGoogleMaps()
  }
})
</script>

<template>
  <div class="mx-auto">
    <div class="flex items-center mb-6">
      <Button variant="ghost" @click="goBack" class="mr-2">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back
      </Button>
      <h1 class="text-responsive-2xl font-bold">Add Expense</h1>
    </div>

    <form @submit.prevent="submitExpenses">
      <div v-if="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
        {{ error }}
      </div>
      
      <div class="space-y-6">
        <!-- Expense forms -->
        <Card v-for="(expense, index) in expenses" :key="expense.id" class="mb-6">
          <CardHeader class="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Expense #{{ index + 1 }}</CardTitle>
              <CardDescription>Enter expense details</CardDescription>
            </div>
            <Button 
              v-if="expenses.length > 1" 
              variant="destructive" 
              size="sm" 
              @click="removeExpense(expense.id)" 
              type="button"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              Remove
            </Button>
          </CardHeader>
          
          <CardContent>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Job Number -->
              <div class="space-y-2">
                <Label for="jobNumber">Job Number</Label>
                <Input 
                  id="jobNumber" 
                  v-model="expense.jobNumber" 
                  placeholder="Enter job number" 
                  required
                />
              </div>
              
              <!-- Date with default HTML datepicker -->
              <div class="space-y-2">
                <Label for="date">Date</Label>
                <Input 
                  id="date" 
                  type="date" 
                  :value="formattedDates[expense.id]" 
                  @input="(e) => handleDateChange(expense.id, e.target.value)"
                  required
                  class="w-full"
                />
              </div>
              
              <!-- Category -->
              <div class="space-y-2">
                <Label for="category">Category</Label>
                <select 
                  id="category" 
                  v-model="expense.category" 
                  class="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option v-for="category in categories" :key="category.value" :value="category.value">
                    {{ category.label }}
                  </option>
                </select>
              </div>
              
              <!-- Amount (hidden for car mileage) -->
              <div v-if="expense.category !== 'car'" class="space-y-2">
                <Label for="amount">Amount ($)</Label>
                <Input 
                  id="amount" 
                  type="number" 
                  step="0.01" 
                  v-model="expense.amount" 
                  placeholder="0.00" 
                  required
                />
              </div>
              
              <!-- Description -->
              <div v-if="expense.category !== 'car'" class="space-y-2" :class="{ 'md:col-span-2': expense.category !== 'car' }">
                <Label for="description">Description</Label>
                <textarea 
                  id="description" 
                  v-model="expense.description" 
                  placeholder="Describe the expense" 
                  class="w-full px-3 py-2 border rounded-md" 
                  rows="2"
                  required
                ></textarea>
              </div>
              
              <!-- Car Mileage specific fields -->
              <div v-if="expense.category === 'car'" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Start Location with Google Autocomplete -->
                  <div class="space-y-2">
                    <Label for="startLocation">Start Address</Label>
                    <Input 
                      id="startLocation" 
                      v-model="expense.startLocation" 
                      placeholder="Enter Start Address" 
                      autocomplete="off"
                      required
                    />
                  </div>
                  
                  <!-- Destination with Google Autocomplete -->
                  <div class="space-y-2">
                    <Label for="destination">Destination Address</Label>
                    <Input 
                      id="destination" 
                      v-model="expense.destination" 
                      placeholder="Enter Destination Address" 
                      autocomplete="off"
                      required
                    />
                  </div>
                  
                  <!-- Display the calculated distance info (without button) -->
                  <div v-if="calculatedDistance" class="space-y-2 md:col-span-2">
                    <div class="text-sm text-green-600 mt-1">
                      Google Maps: {{ calculatedDistance }} km ({{ calculatedDuration }})
                    </div>
                  </div>
                  
                  <!-- Total Distance -->
                  <div class="space-y-2">
                    <Label for="distance">Total Distance (km)</Label>
                    <Input 
                      id="distance" 
                      type="number" 
                      v-model="expense.distance" 
                      placeholder="0" 
                      @input="updateMileageAmount(expense.id)"
                      readonly
                      required
                    />
                    <p v-if="calculatedDistance" class="text-xs text-green-600">
                      Auto-calculated from addresses above
                    </p>
                  </div>
                  
                  <!-- Calculated Amount (read-only) -->
                  <div class="space-y-2">
                    <Label for="calculated-amount">Amount ($)</Label>
                    <Input 
                      id="calculated-amount" 
                      type="text" 
                      :value="expense.amount" 
                      readonly
                      class="bg-gray-100"
                    />
                    <p class="text-xs text-gray-500">Based on $0.61/km</p>
                  </div>
                </div>
              </div>
              
              <!-- Public Transport fields -->
              <div v-if="expense.category === 'transport'" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="space-y-2">
                    <Label for="distance">Distance (km)</Label>
                    <Input 
                      id="distance" 
                      type="number" 
                      v-model="expense.distance" 
                      placeholder="0" 
                      required
                    />
                  </div>
                </div>
              </div>
              
              <!-- Receipt Upload with immediate upload -->
              <div v-if="expense.category !== 'car'" class="space-y-2 md:col-span-2">
                <Label for="receipt">Receipt</Label>
                
                <!-- If no receipt is uploaded yet -->
                <div v-if="!receiptPaths[expense.id]" class="border-2 border-dashed rounded-md p-4 text-center">
                  <input 
                    type="file" 
                    :id="`receipt-${expense.id}`" 
                    class="hidden" 
                    accept="image/*,.pdf" 
                    @change="(e) => handleFileUpload(e, expense.id)"
                    required
                  />
                  <label :for="`receipt-${expense.id}`" class="cursor-pointer">
                    <div class="flex flex-col items-center justify-center">
                      <Upload class="h-8 w-8 mb-2 text-gray-400" />
                      <p class="text-responsive-sm font-medium">
                        {{ uploadStatus[expense.id] === 'uploading' ? 'Uploading...' : 'Click to upload receipt' }}
                      </p>
                      <p class="text-responsive-xs text-gray-500 mt-1">
                        JPG, PNG or PDF (max. 10MB)
                      </p>
                      
                      <!-- Progress bar for upload -->
                      <div v-if="uploadStatus[expense.id] === 'uploading'" class="w-full mt-2">
                        <div class="bg-gray-200 rounded-full h-2.5 w-full">
                          <div 
                            class="bg-blue-600 h-2.5 rounded-full" 
                            :style="{ width: `${uploadProgress[expense.id]}%` }"
                          ></div>
                        </div>
                        <p class="text-responsive-xs text-gray-500 mt-1">{{ uploadProgress[expense.id] }}%</p>
                      </div>
                      
                      <!-- Error message -->
                      <p v-if="uploadStatus[expense.id] === 'error'" class="text-responsive-xs text-red-500 mt-1">
                        Upload failed. Please try again.
                      </p>
                    </div>
                  </label>
                </div>
                
                <!-- If receipt is uploaded -->
                <div v-else class="border-2 border-green-200 rounded-md p-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center">
                      <Check class="h-5 w-5 text-green-500 mr-2" />
                      <div>
                        <p class="text-responsive-sm font-medium">Receipt uploaded successfully</p>
                        <p class="text-responsive-xs text-gray-500">
                          {{ expense.receipt?.name || 'File uploaded' }}
                        </p>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      @click="deleteFile(expense.id)" 
                      type="button"
                      class="text-red-500"
                    >
                      <X class="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <!-- Add another expense button -->
        <div class="flex justify-center">
          <Button 
            type="button" 
            variant="outline" 
            @click="addExpense"
            class="mb-6"
          >
            <Plus class="h-4 w-4 mr-2" />
            Add Another Expense
          </Button>
        </div>
        
        <!-- Submit button -->
        <div class="flex justify-end">
          <Button type="submit" class="px-6" :disabled="loading">
            {{ loading ? 'Submitting...' : 'Submit Expenses' }}
          </Button>
        </div>
      </div>
    </form>

    <!-- Add confirmation modal -->
    <div v-if="showConfirmModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 class="text-lg font-medium mb-4">Confirm Submission</h3>
        <p class="mb-6">Are you sure you want to submit {{ expenses.length }} expense{{ expenses.length > 1 ? 's' : '' }}?</p>
        <div class="flex justify-end space-x-2">
          <Button variant="outline" @click="cancelSubmit">Cancel</Button>
          <Button @click="confirmSubmit" :disabled="loading">
            {{ loading ? 'Submitting...' : 'Confirm' }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>