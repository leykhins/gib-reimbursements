<script setup lang="ts">
  import { ref, computed, onMounted, watch, nextTick } from 'vue'
  import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
  import { Button } from '@/components/ui/button'
  import { Input } from '@/components/ui/input'
  import { Label } from '@/components/ui/label'
  import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
  import { Calendar } from '@/components/ui/calendar'
  import { CalendarIcon, Plus, Trash2, Upload, ArrowLeft, Check, X, LoaderCircle } from 'lucide-vue-next'
  import { useRouter } from 'vue-router'
  import { format, formatISO, parse } from 'date-fns'
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
  import { cn } from '@/lib/utils'
  import { Skeleton } from '@/components/ui/skeleton'
  import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
  import { Toaster } from '@/components/ui/toast'
  import { useToast } from '@/components/ui/toast/use-toast'
  import {
    DateFormatter,
    type DateValue,
    getLocalTimeZone,
    today,
    parseDate
  } from '@internationalized/date'

  // Add showConfirmModal ref
  const showConfirmModal = ref(false)

  // Add these refs at the top with other refs
  const showDebugModal = ref(false)
  const debugData = ref<any>(null)
  const isDragging = ref<Record<number, boolean>>({})
  const dragCounter = ref<Record<number, number>>({})

  definePageMeta({
    layout: 'employee',
    middleware: ['auth', 'employee']
  })

  const router = useRouter()
  const client = useSupabaseClient()
  const user = useSupabaseUser()
  const { toast } = useToast() // Change this line to destructure toast
  const loading = ref(false)
  const error = ref('')
  const uploadStatus = ref<Record<number, 'idle' | 'uploading' | 'success' | 'error'>>({})
  const uploadProgress = ref<Record<number, number>>({})
  const receiptUrls = ref<Record<number, string>>({})
  const receiptPaths = ref<Record<number, string>>({})
  const secondReceiptUrls = ref<Record<number, string>>({})
  const secondReceiptPaths = ref<Record<number, string>>({})
  const showSecondReceipt = ref(false)
  const lastSelectedDate = ref<DateValue>(today(getLocalTimeZone()))

  // Get the runtime config
  const config = useRuntimeConfig()

  // Add a ref to store the user's mileage rate
  const userMileageRate = ref(0.61) // Default fallback

  // Add function to fetch user's mileage rate
  const fetchUserMileageRate = async () => {
    if (!user.value) return
    
    try {
      const { data, error } = await client
        .from('users')
        .select('mileage_rate')
        .eq('id', user.value.id)
        .single()
      
      if (error) throw error
      
      userMileageRate.value = data.mileage_rate || 0.61
    } catch (error) {
      console.error('Error fetching user mileage rate:', error)
      // Keep default rate on error
    }
  }

  // Define constants for mileage calculation
  // const MILEAGE_RATE = 0.61 // Remove this line

  // Add Google Maps API configuration - use API key from environment
  const GOOGLE_MAPS_API_KEY = config.public.googleMapsApiKey || ''
  let autocompleteStart = null
  let autocompleteEnd = null
  let distanceMatrixService = null

  // Keep existing refs and add new ones
  const isGoogleMapsLoaded = ref(false)
  const calculatedDistance = ref(null)
  const calculatedDuration = ref(null)

  // Updated interface for Expense with new fields
  interface MileageEntry {
    jobNumber: string;
    startLocation: string;
    destination: string;
    distance: string;
    date: DateValue;
    datePopoverOpen: boolean;
    subcategoryMappingId: string;
  }

  interface Expense {
    id: number
    jobNumber: string
    description: string
    amount: string
    gst_amount: string
    pst_amount: string
    date: DateValue
    categoryId: string
    subcategoryId: string
    subcategoryMappingId: string
    distance?: string
    startLocation?: string
    destination?: string
    receipt: File | null
    receiptTwo: File | null
    licenseNumber?: string
    relatedEmployee?: string
    clientName?: string
    companyName?: string
    isOfficeAdmin: boolean
    isCompanyEvent: boolean
    option?: string
    datePopoverOpen: boolean
    mileageEntries?: MileageEntry[]
  }

  // Initialize expenses array with updated structure
  const expenses = ref<Expense[]>([
    {
      id: 1,
      jobNumber: '',
      description: '',
      amount: '',
      gst_amount: '',
      pst_amount: '',
      date: today(getLocalTimeZone()),
      categoryId: '',
      subcategoryId: '',
      subcategoryMappingId: '',
      distance: '',
      startLocation: '',
      destination: '',
      receipt: null,
      receiptTwo: null,
      licenseNumber: '',
      relatedEmployee: '',
      clientName: '',
      companyName: '',
      isOfficeAdmin: false,
      isCompanyEvent: false,
      datePopoverOpen: false,
      mileageEntries: [{ 
        jobNumber: '',
        startLocation: '',
        destination: '',
        distance: '',
        date: today(getLocalTimeZone()),
        datePopoverOpen: false,
        subcategoryMappingId: '',
      }]
    }
  ])

  // Initialize upload status for first expense
  uploadStatus.value[1] = 'idle'
  uploadProgress.value[1] = 0

  // Define refs for the categories and subcategories from database
  const dbCategories = ref<any[]>([])
  const dbSubcategories = ref<any[]>([])
  const categoriesLoading = ref(true)

  //Set the last selected date to the first expense date
  lastSelectedDate.value = expenses.value[0].date

  // Fetch categories and subcategories from database on component mount
  const fetchCategories = async () => {
    categoriesLoading.value = true
    
    try {
      // Fetch categories with mappings and subcategories
      const { data: mappingData, error: mappingError } = await client
        .from('claim_categories')
        .select(`
          id,
          category_name,
          requires_license_number,
          category_subcategory_mapping!inner (
            id,
            requires_job_number,
            requires_employee_name,
            requires_client_info,
            claim_subcategories!inner (
              id,
              subcategory_name
            )
          )
        `)
        .order('category_name')
      
      if (mappingError) throw mappingError
      
      // Transform the data for the UI
      dbCategories.value = mappingData.map(category => ({
        id: category.id,
        name: category.category_name,
        requires_license_number: category.requires_license_number
      }))
      
      // Create subcategories mapping
      dbSubcategories.value = mappingData.flatMap(category => 
        category.category_subcategory_mapping.map(mapping => ({
          id: mapping.claim_subcategories.id,
          name: mapping.claim_subcategories.subcategory_name,
          category_id: category.id,
          mapping_id: mapping.id,
          requires_job_number: mapping.requires_job_number,
          requires_employee_name: mapping.requires_employee_name,
          requires_client_info: mapping.requires_client_info
        }))
      )
      
    } catch (err) {
      console.error('Error fetching categories:', err)
      error.value = 'Failed to load expense categories. Please try again.'
    } finally {
      categoriesLoading.value = false
    }
  }

  // Call the fetch function when component mounts
  onMounted(async () => {
    await fetchUserMileageRate() // Fetch user's rate first
    fetchCategories()
    
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

  // Computed property to get subcategories for selected category
  const getSubcategories = computed(() => (expenseId: number) => {
    const expense = expenses.value.find(e => e.id === expenseId)
    if (!expense || !expense.categoryId) return []
    
    return dbSubcategories.value.filter(sc => sc.category_id === expense.categoryId)
  })

  // Updated showField function - modify to exclude job number for mileage
  const showField = computed(() => (expenseId: number, fieldName: string) => {
    const expense = expenses.value.find(e => e.id === expenseId)
    if (!expense || !expense.categoryId) return false
    
    // Find the subcategory using the mapping ID instead of subcategory ID
    const subcategory = dbSubcategories.value.find(sc => sc.mapping_id === expense.subcategoryMappingId)
    if (!subcategory) return false
    
    const category = dbCategories.value.find(c => c.id === expense.categoryId)
    if (!category) return false
    
    // Get human-readable category name for special cases
    const categoryName = category.name.toLowerCase()
    const subcategoryName = subcategory.name.toLowerCase()
    
    switch (fieldName) {
      case 'jobNumber':
        // Don't show job number field for mileage categories as each mileage entry has its own job number
        if (categoryName.includes('mileage')) return false
        
        return subcategory.requires_job_number === true || 
              subcategoryName.includes('jobsite') || 
              subcategoryName.includes('tender')
      case 'licenseNumber':
        return categoryName.includes('vehicle') // All vehicle expenses require license number
      case 'relatedEmployee':
        return subcategory.requires_employee_name === true || 
              subcategoryName.includes('employee')
      case 'clientName':
      case 'companyName':
        return subcategory.requires_client_info === true || 
              subcategoryName.includes('business development')
      case 'isOfficeAdmin':
        return subcategoryName.includes('office/admin') || 
              subcategoryName.includes('admin')
      case 'isCompanyEvent':
        return subcategoryName.includes('company event')
      case 'description':
        return categoryName.includes('meal') && subcategoryName.includes('jobsite')
      case 'gst':
        return true // Show GST for all categories
      case 'pst':
        return true // Show PST for all categories
      default:
        return false
    }
  })

  // Helper function to check if location includes Vancouver
  const isVancouverLocation = (startLocation: string, destination: string): boolean => {
    if (!startLocation && !destination) return false
    const start = startLocation?.toLowerCase() || ''
    const dest = destination?.toLowerCase() || ''
    return start.includes('vancouver') || dest.includes('vancouver')
  }

  // Update the calculation functions to use the user's rate
  const calculateMileageAmount = (distance: string, startLocation?: string, destination?: string) => {
    if (!distance || isNaN(parseFloat(distance))) return '0.00'
    
    let amount = parseFloat(distance) * userMileageRate.value // Use user's rate
    
    // Add 2% extra if location includes Vancouver
    if (startLocation && destination && isVancouverLocation(startLocation, destination)) {
      amount = amount * 1.02
    }
    
    return amount.toFixed(2)
  }

  const calculateMileageAmountForEntry = (distance: string, startLocation: string, destination: string): string => {
    if (!distance || isNaN(parseFloat(distance))) return '0.00'
    
    let amount = parseFloat(distance) * userMileageRate.value // Use user's rate
    
    // Add 2% extra if location includes Vancouver
    if (isVancouverLocation(startLocation, destination)) {
      amount = amount * 1.02
    }
    
    return amount.toFixed(2)
  }

  // Update amount when distance changes for car mileage
  const updateMileageAmount = (expenseId: number) => {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex === -1) return
    
    const expense = expenses.value[expenseIndex]
    const category = dbCategories.value.find(c => c.id === expense.categoryId)
    
    if (category && category.name.toLowerCase().includes('mileage')) {
      expenses.value[expenseIndex].amount = calculateMileageAmount(expenses.value[expenseIndex].distance || '0')
    }
  }

  // Add a new expense form with updated structure
  const addExpense = () => {
    const newId = expenses.value.length + 1
    const previousExpense = expenses.value[expenses.value.length - 1]
    
    expenses.value.push({
      id: newId,
      jobNumber: '',
      description: '',
      amount: '',
      gst_amount: '',
      pst_amount: '',
      date: previousExpense?.date ?? lastSelectedDate.value,
      categoryId: '',
      subcategoryId: '',
      subcategoryMappingId: '',
      distance: '',
      startLocation: '',
      destination: '',
      receipt: null,
      receiptTwo: null,
      licenseNumber: '',
      relatedEmployee: '',
      clientName: '',
      companyName: '',
      isOfficeAdmin: false,
      isCompanyEvent: false,
      datePopoverOpen: false,
      mileageEntries: [{ 
        jobNumber: '', 
        startLocation: '', 
        destination: '', 
        distance: '',
        date: lastSelectedDate.value,
        datePopoverOpen: false,
        subcategoryMappingId: '',
      }]
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
      
      // If there's a second receipt path, delete it from Supabase storage
      if (secondReceiptPaths.value[id]) {
        try {
          const { error: deleteError } = await client.storage
            .from('receipts')
            .remove([secondReceiptPaths.value[id]])
          
          if (deleteError) {
            console.error('Error deleting second file from storage:', deleteError)
          }
        } catch (err) {
          console.error('Error during second file deletion:', err)
        }
      }
      
      expenses.value = expenses.value.filter(expense => expense.id !== id)
      delete uploadStatus.value[id]
      delete uploadProgress.value[id]
      delete receiptUrls.value[id]
      delete receiptPaths.value[id]
      delete secondReceiptUrls.value[id]
      delete secondReceiptPaths.value[id]
    }
  }

  // Add this helper function to convert HEIC files
  const convertHeicToJpeg = async (file: File): Promise<File> => {
    if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      // Only run on client side
      if (typeof window !== 'undefined') {
        try {
          // Dynamically import heic2any only when needed
          const { default: heic2any } = await import('heic2any')
          
          const convertedBlob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.8
          })
          
          // Create a new File object with the converted blob
          const convertedFile = new File(
            [convertedBlob as Blob], 
            file.name.replace(/\.(heic|heif)$/i, '.jpg'),
            { type: 'image/jpeg' }
          )
          
          return convertedFile
        } catch (error) {
          console.error('Error converting HEIC file:', error)
          throw new Error('Failed to convert HEIC file. Please try again.')
        }
      } else {
        // On server side, just return the original file
        return file
      }
    }
    
    return file
  }

  // Update the handleFileUpload function
  const handleFileUpload = async (event: Event, expenseId: number) => {
    const input = event.target as HTMLInputElement
    if (input.files && input.files.length > 0) {
      const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
      if (expenseIndex !== -1) {
        try {
          // Convert HEIC to JPEG if needed
          const convertedFile = await convertHeicToJpeg(input.files[0])
          expenses.value[expenseIndex].receipt = convertedFile
          
          // Start upload immediately
          await uploadFile(convertedFile, expenseId)
        } catch (error) {
          error.value = error.message
        }
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
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const filePath = `${user.value.id}/${Date.now()}-${sanitizedFileName}`
      
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
      delete secondReceiptUrls.value[expenseId]
      delete secondReceiptPaths.value[expenseId]
      uploadStatus.value[expenseId] = 'idle'
      uploadProgress.value[expenseId] = 0
      
      // Clear the file input
      const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
      if (expenseIndex !== -1) {
        expenses.value[expenseIndex].receipt = null
        expenses.value[expenseIndex].receiptTwo = null
      }
      
    } catch (err) {
      console.error('Error deleting file:', err)
      error.value = `Failed to delete file: ${err.message}`
    }
  }

  // Helper function to truncate address after the first comma
  const truncateAddress = (address) => {
    if (!address) return '';
    const commaIndex = address.indexOf(',');
    return commaIndex > 0 ? address.substring(0, commaIndex) : address;
  };

  // Updated confirmSubmit function with address truncation
  const confirmSubmit = async () => {
    try {
      loading.value = true;
      
      let allExpensesData = [];
      
      expenses.value.forEach(expense => {
        const category = dbCategories.value.find(c => c.id === expense.categoryId);
        const categoryName = category?.name.toLowerCase() || '';
        
        if (categoryName.includes('mileage') && expense.mileageEntries && expense.mileageEntries.length > 0) {
          // For car mileage, create a separate expense for each entry
          expense.mileageEntries.forEach(entry => {
            if (!entry.distance || parseFloat(entry.distance) <= 0) {
              return; // Skip entries with no distance
            }
            
            // Calculate amount with Vancouver bonus if applicable
            const amount = calculateMileageAmountForEntry(entry.distance, entry.startLocation, entry.destination);
            
            // Truncate addresses for description
            const shortStartLocation = truncateAddress(entry.startLocation);
            const shortDestination = truncateAddress(entry.destination);
            
            // Build a basic description with truncated addresses
            let description = `Mileage: ${shortStartLocation} to ${shortDestination}`;
            
            // Add Vancouver bonus indicator to description if applicable
            if (isVancouverLocation(entry.startLocation, entry.destination)) {
              description += ' (Vancouver +2%)';
            }
            
            // Add job number to description if it exists and should be shown
            if (shouldShowJobNumber(entry.subcategoryMappingId) && entry.jobNumber) {
              description += ` (Job #: ${entry.jobNumber})`;
            }
            
            allExpensesData.push({
              employee_id: user.value.id,
              job_number: shouldShowJobNumber(entry.subcategoryMappingId) ? entry.jobNumber : null,
              description: description,
              amount: parseFloat(amount),
              gst_amount: 0,
              pst_amount: 0,
              date: entry.date.toDate(getLocalTimeZone()),
              is_travel: true,
              travel_distance: parseFloat(entry.distance),
              travel_type: 'car',
              start_location: entry.startLocation, // Keep full address in the actual data field
              destination: entry.destination, // Keep full address in the actual data field
              receipt_url: null, // Mileage doesn't need receipts
              receipt_url_2: null,
              status: 'pending',
              category_id: expense.categoryId,
              subcategory_mapping_id: entry.subcategoryMappingId,
              license_number: expense.licenseNumber || null,
              related_employee: null,
              client_name: null,
              company_name: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          });
        } else {
          // For non-mileage expenses, use the original logic
          if (categoryName.includes('meal') && !expense.description) {
            expense.description = 'Meal expense';
          }
          
          const isTravel = categoryName.includes('travel');
          
          allExpensesData.push({
            employee_id: user.value.id,
            job_number: expense.jobNumber,
            description: expense.description,
            amount: parseFloat(expense.amount),
            gst_amount: parseFloat(expense.gst_amount || '0'),
            pst_amount: parseFloat(expense.pst_amount || '0'),
            date: expense.date.toDate(getLocalTimeZone()),
            is_travel: isTravel,
            travel_distance: isTravel && expense.distance ? parseFloat(expense.distance) : null,
            travel_type: isTravel ? 'public_transport' : null,
            start_location: expense.startLocation,
            destination: expense.destination,
            receipt_url: receiptPaths.value[expense.id] || null,
            receipt_url_2: secondReceiptPaths.value[expense.id] || null,
            status: 'pending',
            category_id: expense.categoryId,
            subcategory_mapping_id: expense.subcategoryMappingId,
            license_number: expense.licenseNumber || null,
            related_employee: expense.relatedEmployee || null,
            client_name: expense.clientName || null,
            company_name: expense.companyName || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      });
      
      // Submit each expense and collect their IDs
      const submittedClaimIds = [];
      for (const expenseData of allExpensesData) {
        const { data: expenseResult, error: expenseError } = await client
          .from('claims')
          .insert(expenseData)
          .select('id')
          .single()
        
        if (expenseError) {
          throw expenseError
        }
        
        submittedClaimIds.push(expenseResult.id)
      }
      
      // Send a single consolidated notification for all claims to admins AND employee
      try {
        const { sendEnhancedConsolidatedClaimSubmissionEmail } = await import('~/lib/notifications')
        const notificationResult = await sendEnhancedConsolidatedClaimSubmissionEmail(
          submittedClaimIds
        )
        
        // Show success toast
        toast({
          title: 'Claims Submitted Successfully',
          description: `Successfully submitted ${submittedClaimIds.length} claim${submittedClaimIds.length > 1 ? 's' : ''}`,
          variant: 'default'
        })
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError)
        toast({
          title: 'Email Notification Error',
          description: 'Failed to send email notifications. Claims were submitted successfully.',
          variant: 'destructive'
        })
      }
      
      // Close modal and navigate to dashboard
      showConfirmModal.value = false;
      navigateTo('/e/');
      
    } catch (err) {
      console.error('Error submitting expenses:', err);
      error.value = typeof err === 'object' && err !== null && 'message' in err 
        ? String(err.message) 
        : 'Failed to submit expenses. Please try again.';
      showConfirmModal.value = false;
    } finally {
      loading.value = false;
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
        const hasMileage = newExpenses.some(e => {
          const category = dbCategories.value.find(c => c.id === e.categoryId)
          return category && category.name.toLowerCase().includes('mileage')
        })
        
        if (hasMileage) {
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
    nextTick(() => {
      try {
        // Find all car mileage expenses
        const mileageExpenses = expenses.value.filter(e => {
          const category = dbCategories.value.find(c => c.id === e.categoryId)
          return category && category.name.toLowerCase().includes('mileage')
        })
        
        // Initialize autocomplete for each mileage expense entry
        mileageExpenses.forEach(expense => {
          if (!expense.mileageEntries) return
          
          expense.mileageEntries.forEach((entry, entryIndex) => {
            const startInput = document.getElementById(`startLocation-${expense.id}-${entryIndex}`)
            const endInput = document.getElementById(`destination-${expense.id}-${entryIndex}`)
            
            // Only proceed if both inputs exist for this entry
            if (!startInput || !endInput) return
            
            // Initialize start location autocomplete
            if (!startInput.getAttribute('data-autocomplete-initialized')) {
              const options = {
                types: ['address'],
                componentRestrictions: { country: 'ca' }
              }
              
              const autoStart = new window.google.maps.places.Autocomplete(startInput, options)
              startInput.setAttribute('data-autocomplete-initialized', 'true')
              
              autoStart.addListener('place_changed', () => {
                const place = autoStart.getPlace()
                if (place && place.formatted_address) {
                  // Update this specific entry's startLocation
                  const expenseIndex = expenses.value.findIndex(e => e.id === expense.id)
                  if (expenseIndex !== -1 && expenses.value[expenseIndex].mileageEntries) {
                    expenses.value[expenseIndex].mileageEntries[entryIndex].startLocation = place.formatted_address
                  }
                  calculateDistanceForEntry(expense.id, entryIndex)
                }
              })
            }
            
            // Initialize destination autocomplete
            if (!endInput.getAttribute('data-autocomplete-initialized')) {
              const options = {
                types: ['address'],
                componentRestrictions: { country: 'ca' }
              }
              
              const autoEnd = new window.google.maps.places.Autocomplete(endInput, options)
              endInput.setAttribute('data-autocomplete-initialized', 'true')
              
              autoEnd.addListener('place_changed', () => {
                const place = autoEnd.getPlace()
                if (place && place.formatted_address) {
                  // Update this specific entry's destination
                  const expenseIndex = expenses.value.findIndex(e => e.id === expense.id)
                  if (expenseIndex !== -1 && expenses.value[expenseIndex].mileageEntries) {
                    expenses.value[expenseIndex].mileageEntries[entryIndex].destination = place.formatted_address
                  }
                  calculateDistanceForEntry(expense.id, entryIndex)
                }
              })
            }
          })
        })
      } catch (error) {
        console.error("Error setting up autocomplete:", error)
      }
    })
  }

  // New function to calculate distance for a specific mileage entry
  const calculateDistanceForEntry = (expenseId, entryIndex) => {
    if (!distanceMatrixService) return
    
    // Get the expense and entry
    const expense = expenses.value.find(e => e.id === expenseId)
    if (!expense || !expense.mileageEntries || !expense.mileageEntries[entryIndex]) return
    
    const entry = expense.mileageEntries[entryIndex]
    
    // Only calculate if both addresses have values
    if (entry.startLocation && entry.destination) {
      const request = {
        origins: [entry.startLocation],
        destinations: [entry.destination],
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
            
            // Update the distance field for this specific entry
            const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
            if (expenseIndex !== -1 && expenses.value[expenseIndex].mileageEntries) {
              expenses.value[expenseIndex].mileageEntries[entryIndex].distance = distanceInKm.toFixed(2)
              updateMileageTotals(expenseId)
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

  // Add the missing requiresReceipt computed property
  const requiresReceipt = computed(() => (expenseId: number) => {
    const expense = expenses.value.find(e => e.id === expenseId)
    if (!expense || !expense.categoryId) return true
    
    // Get category name
    const category = dbCategories.value.find(c => c.id === expense.categoryId)
    if (!category) return true
    
    // Mileage categories don't require receipts
    return !category.name.toLowerCase().includes('mileage')
  })

  // Calculate total amount (excluding tax)
  const totalAmount = computed(() => {
    return expenses.value.reduce((sum, expense) => {
      const amount = parseFloat(expense.amount) || 0
      return sum + amount
    }, 0).toFixed(2)
  })

  // Calculate total GST
  const totalGST = computed(() => {
    return expenses.value.reduce((sum, expense) => {
      const gst = parseFloat(expense.gst_amount) || 0
      return sum + gst
    }, 0).toFixed(2)
  })

  // Calculate total PST
  const totalPST = computed(() => {
    return expenses.value.reduce((sum, expense) => {
      const pst = parseFloat(expense.pst_amount) || 0
      return sum + pst
    }, 0).toFixed(2)
  })

  // Add function to calculate GST for parking expenses
  const calculateParkingGST = (amount: string): string => {
    if (!amount || isNaN(parseFloat(amount))) return '0.00'
    return ((parseFloat(amount) / 1.29) * 0.05).toFixed(2)
  }

  // Update the handleCategoryChange function to calculate GST for parking
  const handleCategoryChange = (expenseId: number) => {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex === -1) return
    
    const expense = expenses.value[expenseIndex]
    const category = dbCategories.value.find(c => c.id === expense.categoryId)
    
    if (category) {
      const categoryName = category.name.toLowerCase()
      
      // If it's a parking category, calculate GST based on the provided formula
      if (categoryName.includes('parking') && expense.amount) {
        expenses.value[expenseIndex].gst_amount = calculateParkingGST(expense.amount)
      }
    }
  }

  // Update the grand total calculation to only use the total amounts
  const grandTotal = computed(() => {
    return expenses.value.reduce((sum, expense) => {
      const amount = parseFloat(expense.amount) || 0
      return sum + amount
    }, 0).toFixed(2)
  })

  const df = new DateFormatter('en-US', {
    dateStyle: 'long',
  })

  // Add a function to add mileage entry
  const addMileageEntry = (expenseId: number) => {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex === -1) return
    
    // Initialize array if it doesn't exist
    if (!expenses.value[expenseIndex].mileageEntries) {
      expenses.value[expenseIndex].mileageEntries = []
    }
    
    // Add new entry with today's date and copy the subcategory from previous entry if available
    const previousSubcategoryId = expenses.value[expenseIndex].mileageEntries.length > 0 
      ? expenses.value[expenseIndex].mileageEntries[expenses.value[expenseIndex].mileageEntries.length - 1].subcategoryMappingId 
      : '';
    
    // Use last selected date
    const previousEntry = expenses.value[expenseIndex].mileageEntries[expenses.value[expenseIndex].mileageEntries.length - 1]
    const defaultDate = previousEntry?.date ?? expenses.value[expenseIndex].date ?? lastSelectedDate.value
    
    expenses.value[expenseIndex].mileageEntries.push({
      jobNumber: '',
      startLocation: '',
      destination: '',
      distance: '',
      date: defaultDate, // Use the DateValue directly
      datePopoverOpen: false,
      subcategoryMappingId: previousSubcategoryId
    })
    
    // Setup autocomplete for new fields
    nextTick(() => {
      setupAutocomplete()
    })
  }

  // Add a function to remove mileage entry
  const removeMileageEntry = (expenseId: number, entryIndex: number) => {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex === -1) return
    
    // Only remove if there's more than one
    if (expenses.value[expenseIndex].mileageEntries.length > 1) {
      expenses.value[expenseIndex].mileageEntries.splice(entryIndex, 1)
      updateMileageTotals(expenseId)
    }
  }

  // Add function to calculate total distance
  const calculateTotalDistance = (expenseId: number) => {
    const expense = expenses.value.find(e => e.id === expenseId)
    if (!expense || !expense.mileageEntries) return '0'
    
    const total = expense.mileageEntries.reduce((sum, entry) => {
      return sum + (parseFloat(entry.distance) || 0)
    }, 0)
    
    return total.toFixed(2)
  }

  // Update the mileage totals and calculate amount with Vancouver bonus
  const updateMileageTotals = (expenseId: number) => {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex === -1) return
    
    const expense = expenses.value[expenseIndex]
    if (!expense.mileageEntries) return
    
    // Calculate total amount for all entries, including Vancouver bonus
    const totalAmount = expense.mileageEntries.reduce((sum, entry) => {
      if (!entry.distance || parseFloat(entry.distance) <= 0) return sum
      const entryAmount = parseFloat(calculateMileageAmountForEntry(entry.distance, entry.startLocation, entry.destination))
      return sum + entryAmount
    }, 0)
    
    const totalDistance = calculateTotalDistance(expenseId)
    expenses.value[expenseIndex].distance = totalDistance
    expenses.value[expenseIndex].amount = totalAmount.toFixed(2)
  }

  // Add string date handling for simpler input
  const updateEntryDateFromString = (expenseId: number, entryIndex: number) => {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex === -1 || !expenses.value[expenseIndex].mileageEntries) return
    
    const entry = expenses.value[expenseIndex].mileageEntries[entryIndex]
    if (entry.dateString) {
      entry.date = new Date(entry.dateString)
    }
  }

  // Helper function to check if job number should be shown for a subcategory
  const shouldShowJobNumber = (subcategoryMappingId: string) => {
    if (!subcategoryMappingId) return false
    
    const subcategory = dbSubcategories.value.find(sc => sc.mapping_id === subcategoryMappingId)
    if (!subcategory) return false
    
    // Check if subcategory name contains jobsite or tender
    const subcategoryName = subcategory.name.toLowerCase()
    return subcategoryName.includes('jobsite') || 
          subcategoryName.includes('tender') || 
          subcategory.requires_job_number === true
  }

  // Add a computed property to count total claims
  const totalClaimsCount = computed(() => {
    return expenses.value.reduce((total, expense) => {
      // If it's a mileage expense with multiple entries, count those entries
      const category = dbCategories.value.find(c => c.id === expense.categoryId);
      if (category && category.name.toLowerCase().includes('mileage') && expense.mileageEntries) {
        // Only count entries that have distance (valid entries)
        return total + expense.mileageEntries.filter(entry => entry.distance && parseFloat(entry.distance) > 0).length;
      }
      // For non-mileage expenses, count as 1
      return total + 1;
    }, 0);
  });

  // Add these methods after the existing file handling methods
  const handleDragEnter = (event: DragEvent, expenseId: number) => {
    event.preventDefault()
    event.stopPropagation()
    
    if (!dragCounter.value[expenseId]) {
      dragCounter.value[expenseId] = 0
    }
    dragCounter.value[expenseId]++
    isDragging.value[expenseId] = true
  }

  const handleDragLeave = (event: DragEvent, expenseId: number) => {
    event.preventDefault()
    event.stopPropagation()
    
    dragCounter.value[expenseId]--
    if (dragCounter.value[expenseId] === 0) {
      isDragging.value[expenseId] = false
    }
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleDrop = async (event: DragEvent, expenseId: number) => {
    event.preventDefault()
    event.stopPropagation()
    
    isDragging.value[expenseId] = false
    dragCounter.value[expenseId] = 0
    
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
      if (expenseIndex !== -1) {
        try {
          // Convert HEIC to JPEG if needed
          const convertedFile = await convertHeicToJpeg(file)
          expenses.value[expenseIndex].receipt = convertedFile
          await uploadFile(convertedFile, expenseId)
        } catch (error) {
          error.value = error.message
        }
      }
    }
  }

  // Helper function to calculate the deadline for a given expense date
  const calculateClaimDeadline = (expenseDate: DateValue): Date => {
    const expenseJSDate = expenseDate.toDate(getLocalTimeZone())
    const expenseMonth = expenseJSDate.getMonth()
    const expenseYear = expenseJSDate.getFullYear()
    
    // Calculate next month and year
    let nextMonth = expenseMonth + 1
    let nextYear = expenseYear
    
    if (nextMonth > 11) {
      nextMonth = 0
      nextYear++
    }
    
    // Deadline is 7 days into the next month
    return new Date(nextYear, nextMonth, 7, 23, 59, 59)
  }

  // Computed property to check if any claims are late
  const hasLateClaims = computed(() => {
    const today = new Date()
    
    for (const expense of expenses.value) {
      const category = dbCategories.value.find(c => c.id === expense.categoryId)
      const categoryName = category?.name.toLowerCase() || ''
      
      if (categoryName.includes('mileage') && expense.mileageEntries) {
        // Check each mileage entry
        for (const entry of expense.mileageEntries) {
          if (entry.date && entry.distance && parseFloat(entry.distance) > 0) {
            const deadline = calculateClaimDeadline(entry.date)
            if (today > deadline) {
              return true
            }
          }
        }
      } else if (expense.date) {
        // Check regular expense
        const deadline = calculateClaimDeadline(expense.date)
        if (today > deadline) {
          return true
        }
      }
    }
    
    return false
  })

  // Computed property to get details about late claims for the warning message
  const lateClaimsDetails = computed(() => {
    const today = new Date()
    const lateExpenses: { expenseNumber: number; date: Date; deadline: Date }[] = []
    
    expenses.value.forEach((expense, index) => {
      const category = dbCategories.value.find(c => c.id === expense.categoryId)
      const categoryName = category?.name.toLowerCase() || ''
      
      if (categoryName.includes('mileage') && expense.mileageEntries) {
        // Check each mileage entry
        expense.mileageEntries.forEach(entry => {
          if (entry.date && entry.distance && parseFloat(entry.distance) > 0) {
            const deadline = calculateClaimDeadline(entry.date)
            if (today > deadline) {
              lateExpenses.push({
                expenseNumber: index + 1,
                date: entry.date.toDate(getLocalTimeZone()),
                deadline
              })
            }
          }
        })
      } else if (expense.date) {
        // Check regular expense
        const deadline = calculateClaimDeadline(expense.date)
        if (today > deadline) {
          lateExpenses.push({
            expenseNumber: index + 1,
            date: expense.date.toDate(getLocalTimeZone()),
            deadline
          })
        }
      }
    })
    
    return lateExpenses
  })

  // Handle second receipt file upload
  const handleSecondFileUpload = async (event: Event, expenseId: number) => {
    const input = event.target as HTMLInputElement
    if (input.files && input.files.length > 0) {
      const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
      if (expenseIndex !== -1) {
        try {
          const convertedFile = await convertHeicToJpeg(input.files[0])
          expenses.value[expenseIndex].receiptTwo = convertedFile
          await uploadSecondFile(convertedFile, expenseId)
        } catch (e: any) {
          error.value = e?.message || 'Failed to upload second file'
        }
      }
    }
  }

  const uploadSecondFile = async (file: File, expenseId: number): Promise<void> => {
    if (!file) return
    try {
      if (!user.value) throw new Error('You must be logged in to upload files')

      uploadStatus.value[expenseId] = 'uploading'
      uploadProgress.value[expenseId] = 0

      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const filePath = `${user.value.id}/${Date.now()}-${sanitizedFileName}`
      const { error: uploadError } = await client.storage
        .from('receipts')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          onUploadProgress: (progress) => {
            uploadProgress.value[expenseId] = Math.round((progress.loaded / progress.total) * 100)
          }
        })

      if (uploadError) throw uploadError

      secondReceiptPaths.value[expenseId] = filePath
      secondReceiptUrls.value[expenseId] = filePath
      uploadStatus.value[expenseId] = 'success'
    } catch (e: any) {
      console.error('Error uploading second file:', e)
      uploadStatus.value[expenseId] = 'error'
      error.value = e?.message || 'Failed to upload second file'
    }
  }

  const deleteSecondFile = async (expenseId: number): Promise<void> => {
    if (!secondReceiptPaths.value[expenseId]) return
    try {
      const { error: deleteError } = await client.storage
        .from('receipts')
        .remove([secondReceiptPaths.value[expenseId]])
      if (deleteError) throw deleteError

      delete secondReceiptPaths.value[expenseId]
      delete secondReceiptUrls.value[expenseId]

      const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
      if (expenseIndex !== -1) {
        expenses.value[expenseIndex].receiptTwo = null
      }
    } catch (e: any) {
      console.error('Error deleting second file:', e)
      error.value = e?.message || 'Failed to delete second file'
    }
  }

  const handleSecondDrop = async (event: DragEvent, expenseId: number) => {
    event.preventDefault()
    event.stopPropagation()
    isDragging.value[expenseId] = false
    dragCounter.value[expenseId] = 0

    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
      if (expenseIndex !== -1) {
        try {
          const convertedFile = await convertHeicToJpeg(file)
          expenses.value[expenseIndex].receiptTwo = convertedFile
          await uploadSecondFile(convertedFile, expenseId)
        } catch (e: any) {
          error.value = e?.message || 'Failed to upload second file'
        }
      }
    }
  }
</script>

<template>
  <div class="mx-auto">
    <div class="flex items-center mb-6">
      <Button variant="ghost" @click="goBack" class="mr-2">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back
      </Button>
      <h1 class="text-responsive-xl font-bold">Add Expense</h1>
    </div>

    <form @submit.prevent="showConfirmModal = true">
      <div v-if="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
        {{ error }}
      </div>
      
      <!-- Late Claims Warning -->
      <div v-if="hasLateClaims" class="bg-yellow-50 border border-yellow-400 text-yellow-800 px-4 py-3 rounded mb-4">
        <div class="flex items-start">
          <div class="flex-shrink-0">
            <svg class="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="ml-3 flex-1">
            <h3 class="text-sm font-medium">Late Claim Warning</h3>
            <div class="mt-2 text-sm">
              <p>
                <span class="font-semibold">{{ lateClaimsDetails.length }}</span> 
                claim{{ lateClaimsDetails.length > 1 ? 's' : '' }} 
                {{ lateClaimsDetails.length > 1 ? 'are' : 'is' }} past the submission deadline.
              </p>
              <p class="mt-1 text-xs">
                Claims must be submitted within 7 days of the following month. Late claims may require manager approval.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <Toaster />
      
      <div v-if="categoriesLoading" class="space-y-6">
        <Card class="mb-6 shadow-none">
          <CardHeader class="flex flex-row items-center justify-between">
            <div class="space-y-2">
              <Skeleton class="h-6 w-[150px]" />
              <Skeleton class="h-4 w-[200px]" />
            </div>
          </CardHeader>
          
          <CardContent>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Category skeleton -->
              <div class="space-y-2 md:col-span-2">
                <Skeleton class="h-4 w-[100px]" />
                <Skeleton class="h-10 w-full" />
              </div>
              
              <!-- Date field skeleton -->
              <div class="space-y-2">
                <Skeleton class="h-4 w-[80px]" />
                <Skeleton class="h-10 w-full" />
              </div>
              
              <!-- Amount field skeleton -->
              <div class="space-y-2">
                <Skeleton class="h-4 w-[80px]" />
                <Skeleton class="h-10 w-full" />
              </div>
              
              <!-- Description field skeleton -->
              <div class="space-y-2 md:col-span-2">
                <Skeleton class="h-4 w-[100px]" />
                <Skeleton class="h-24 w-full" />
              </div>
              
              <!-- Receipt upload skeleton -->
              <div class="space-y-2 md:col-span-2">
                <Skeleton class="h-4 w-[80px]" />
                <Skeleton class="h-32 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <!-- Add expense button skeleton -->
        <div class="flex justify-center">
          <Skeleton class="h-10 w-[200px]" />
        </div>
      </div>

      <div v-else class="space-y-6">
        <!-- Expense forms -->
        <Card v-for="(expense, index) in expenses" :key="expense.id" class="mb-6 shadow-none">
          <CardHeader class="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Expense #{{ index + 1 }}</CardTitle>
              <CardDescription>Enter expense details (<span class="text-red-500">*</span> Required fields)
              </CardDescription>
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
              <!-- Category and Subcategory on the same line -->
              <div class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Category selection from database -->
                  <div class="space-y-2">
                    <Label for="category" class="flex items-center">
                      Expense Category <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Select v-model="expense.categoryId" required>
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="category in dbCategories" :key="category.id" :value="category.id">
                          {{ category.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <!-- Subcategory selection - hide for mileage categories -->
                  <div class="space-y-2" v-if="!expense.categoryId || !dbCategories.find(c => c.id === expense.categoryId)?.name.toLowerCase().includes('mileage')">
                    <Label for="subcategory" class="flex items-center">
                      Subcategory <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Select 
                      v-model="expense.subcategoryMappingId" 
                      @update:modelValue="(value) => {
                        expense.subcategoryMappingId = value;
                        const subcategory = dbSubcategories.value && dbSubcategories.value.find(sc => sc.mapping_id === value);
                        expense.subcategoryId = subcategory?.id || '';
                      }"
                      required
                      :disabled="!expense.categoryId"
                    >
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Select subcategory" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem 
                          v-for="subcategory in getSubcategories(expense.id)" 
                          :key="subcategory.id" 
                          :value="subcategory.mapping_id"
                        >
                          {{ subcategory.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              
              <!-- Client Name and Company Name on the same line -->
              <div v-if="showField(expense.id, 'clientName') || showField(expense.id, 'companyName')" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Client Name -->
                  <div v-if="showField(expense.id, 'clientName')" class="space-y-2">
                    <Label for="clientName" class="flex items-center">
                      Client Name <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Input 
                      id="clientName" 
                      v-model="expense.clientName" 
                      placeholder="Enter client name" 
                      required
                    />
                  </div>
                  
                  <!-- Company Name -->
                  <div v-if="showField(expense.id, 'companyName')" class="space-y-2">
                    <Label for="companyName" class="flex items-center">
                      Company Name <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Input 
                      id="companyName" 
                      v-model="expense.companyName" 
                      placeholder="Enter company name" 
                      required
                    />
                  </div>
                </div>
              </div>

              <!-- Description field - for Meal Jobsite expenses -->
              <div v-if="showField(expense.id, 'description')" class="space-y-2 md:col-span-2">
                <Label for="description" class="flex items-center">
                  Description <span class="text-red-500 ml-1">*</span>
                </Label>
                <Input 
                  id="description" 
                  v-model="expense.description" 
                  placeholder="Enter description" 
                  required
                />
              </div>
              
              <!-- Date field - hide for mileage expenses since we have per-entry dates -->
              <div v-if="!expense.categoryId || !dbCategories.find(c => c.id === expense.categoryId)?.name.toLowerCase().includes('mileage')" class="space-y-2">
                <Label for="date" class="flex items-center">
                  Date of Expense <span class="text-red-500 ml-1">*</span>
                </Label>
                <Popover v-model:open="expense.datePopoverOpen">
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      :class="cn(
                        'w-full justify-start text-left font-normal',
                        !expense.date && 'text-muted-foreground',
                      )"
                    >
                      <CalendarIcon class="mr-2 h-4 w-4" />
                      {{ expense.date ? df.format(expense.date.toDate(getLocalTimeZone())) : "Pick a date" }}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-auto p-0">
                    <Calendar 
                      v-model="expense.date"
                      :max-value="today(getLocalTimeZone())" 
                      initial-focus 
                      @update:model-value="() => { expense.datePopoverOpen = false; lastSelectedDate.value = expense.date }"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <!-- Job Number -->
              <div v-if="showField(expense.id, 'jobNumber')" class="space-y-2">
                <Label for="jobNumber" class="flex items-center">
                  Job Number <span class="text-red-500 ml-1">*</span>
                </Label>
                <Input 
                  id="jobNumber" 
                  v-model="expense.jobNumber" 
                  placeholder="Enter job number" 
                  type="number"
                  required
                />
              </div>
              
              <!-- License Number - for Vehicle Expenses -->
              <div v-if="showField(expense.id, 'licenseNumber')" class="space-y-2">
                <Label for="licenseNumber" class="flex items-center">
                  License Number <span class="text-red-500 ml-1">*</span>
                </Label>
                <Input 
                  id="licenseNumber" 
                  v-model="expense.licenseNumber" 
                  placeholder="Enter license number" 
                  required
                />
              </div>
              
              <!-- Related Employee - for Employee to Employee meals -->
              <div v-if="showField(expense.id, 'relatedEmployee')" class="space-y-2">
                <Label for="relatedEmployee" class="flex items-center">
                  Employee Name <span class="text-red-500 ml-1">*</span>
                </Label>
                <Input 
                  id="relatedEmployee" 
                  v-model="expense.relatedEmployee" 
                  placeholder="Enter employee name" 
                  required
                />
              </div>
              
              <!-- Regular expense fields -->
              <div v-if="!expense.categoryId || !dbCategories.find(c => c.id === expense.categoryId)?.name.toLowerCase().includes('mileage')" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <!-- Amount -->
                  <div class="space-y-2">
                    <Label for="amount" class="flex items-center">
                      Total Amount (Including Tax) <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Input 
                      id="amount" 
                      type="number" 
                      step="0.01" 
                      v-model="expense.amount" 
                      placeholder="0.00" 
                      @input="handleCategoryChange(expense.id)"
                      required
                    />
                  </div>

                  <!-- GST Amount -->
                  <div v-if="showField(expense.id, 'gst')" class="space-y-2">
                    <Label for="gst_amount" class="flex items-center">
                      GST Amount ($)
                    </Label>
                    <Input 
                      id="gst_amount" 
                      type="number" 
                      step="0.01" 
                      v-model="expense.gst_amount" 
                      placeholder="0.00"
                    />
                  </div>

                  <!-- PST Amount -->
                  <div v-if="showField(expense.id, 'pst')" class="space-y-2">
                    <Label for="pst_amount" class="flex items-center">
                      PST Amount ($)
                    </Label>
                    <Input 
                      id="pst_amount" 
                      type="number" 
                      step="0.01" 
                      v-model="expense.pst_amount" 
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <!-- Car Mileage specific fields -->
              <div v-else-if="expense.categoryId && dbCategories.find(c => c.id === expense.categoryId)?.name.toLowerCase().includes('mileage')" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 gap-4">
                  <!-- Multiple entries for mileage - inline on desktop, stacked on mobile -->
                  <div v-for="(entry, entryIndex) in expense.mileageEntries || [{}]" :key="entryIndex">
                    <div class="grid grid-cols-1 md:grid-cols-12 gap-2">
                      <!-- Date picker for each entry -->
                      <div class="md:col-span-2">
                        <Label class="md:hidden">Date <span class="text-red-500">*</span></Label>
                        <Popover v-model:open="entry.datePopoverOpen">
                          <PopoverTrigger as-child>
                            <Button
                              variant="outline"
                              class="w-full justify-start text-left font-normal text-xs md:text-sm"
                              :class="cn(
                                !entry.date && 'text-muted-foreground'
                              )"
                            >
                              <CalendarIcon class="mr-2 h-3 w-3 md:h-4 md:w-4" />
                              {{ entry.date && typeof entry.date.toDate === 'function' 
                                ? df.format(entry.date.toDate(getLocalTimeZone())) 
                                : "Pick a date" }}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent class="w-auto p-0">
                            <Calendar 
                              v-model="entry.date"
                              initial-focus
                              :max-value="today(getLocalTimeZone())" 
                              @update:model-value="() => {
                                entry.datePopoverOpen = false;
                                lastSelectedDate.value = entry.date
                              }"
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      
                      <!-- Subcategory for each entry -->
                      <div class="md:col-span-2">
                        <Label class="md:hidden">Subcategory <span class="text-red-500">*</span></Label>
                        <Select 
                          v-model="entry.subcategoryMappingId" 
                          required
                        >
                          <SelectTrigger class="w-full">
                            <SelectValue placeholder="Subcategory" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem 
                              v-for="subcategory in getSubcategories(expense.id)" 
                              :key="subcategory.id" 
                              :value="subcategory.mapping_id"
                            >
                              {{ subcategory.name }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <!-- Job Number - only visible for jobsite and tender subcategories -->
                      <transition name="slide">
                        <div class="md:col-span-2" v-if="shouldShowJobNumber(entry.subcategoryMappingId)">
                          <Label class="md:hidden">Job Number <span class="text-red-500">*</span></Label>
                          <Input 
                            :id="`jobNumber-${expense.id}-${entryIndex}`" 
                            v-model="entry.jobNumber" 
                            placeholder="Job #" 
                            type="number"
                            required
                          />
                        </div>
                      </transition>
                      
                      <!-- Start Location -->
                      <div class="md:col-span-2" :class="{'md:col-span-4': !shouldShowJobNumber(entry.subcategoryMappingId)}">
                        <Label class="md:hidden">Start Address <span class="text-red-500">*</span></Label>
                        <Input 
                          :id="`startLocation-${expense.id}-${entryIndex}`" 
                          v-model="entry.startLocation" 
                          placeholder="Start address" 
                          autocomplete="off"
                          required
                        />
                      </div>
                      
                      <!-- Destination -->
                      <div class="md:col-span-2">
                        <Label class="md:hidden">Destination <span class="text-red-500">*</span></Label>
                        <Input 
                          :id="`destination-${expense.id}-${entryIndex}`" 
                          v-model="entry.destination" 
                          placeholder="Destination" 
                          autocomplete="off"
                          required
                        />
                      </div>
                      
                      <!-- Distance -->
                      <div class="md:col-span-1">
                        <Label class="md:hidden">Distance (km) <span class="text-red-500">*</span></Label>
                        <Input 
                          :id="`distance-${expense.id}-${entryIndex}`" 
                          type="number" 
                          v-model="entry.distance" 
                          placeholder="0" 
                          readonly
                          required
                          class="bg-gray-100"
                        />
                      </div>

                      <!-- Action buttons -->
                      <div class="md:col-span-1 flex items-center justify-end md:justify-center">
                        <Button 
                          v-if="expense.mileageEntries && expense.mileageEntries.length > 1" 
                          variant="destructive" 
                          size="icon"
                          @click="removeMileageEntry(expense.id, entryIndex)" 
                          type="button"
                          class="h-8 w-8"
                        >
                          <Trash2 class="h-4 w-4" />
                        </Button>
                        
                        <!-- Plus button for the last entry -->
                        <Button 
                          v-if="expense.mileageEntries && entryIndex === expense.mileageEntries.length - 1"
                          type="button" 
                          variant="outline" 
                          size="icon"
                          @click="addMileageEntry(expense.id)"
                          class="h-8 w-8 ml-2 bg-[#f05a1d] text-white hover:bg-[#f05a1d]/80 hover:text-white"
                        >
                          <Plus class="h-4 w-" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <!-- Total Distance and Amount -->
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 p-4 bg-gray-50 rounded-md">
                    <div class="space-y-2">
                      <Label for="totalDistance" class="flex items-center font-semibold">
                        Total Distance (km)
                      </Label>
                      <Input 
                        :id="`totalDistance-${expense.id}`" 
                        type="text" 
                        :value="calculateTotalDistance(expense.id)" 
                        readonly
                        class="bg-gray-100 font-bold"
                      />
                    </div>

                    <!-- Calculated Amount (read-only) -->
                    <div class="space-y-2">
                      <Label for="calculated-amount" class="flex items-center font-semibold">
                        Total Amount ($)
                      </Label>
                      <Input 
                        id="calculated-amount" 
                        type="text" 
                        :value="expense.amount" 
                        readonly
                        class="bg-gray-100 font-bold"
                      />
                      <p class="text-xs text-gray-500">Based on ${{ userMileageRate.toFixed(2) }}/km</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Receipt Upload with immediate upload - conditionally shown -->
              <div v-if="requiresReceipt(expense.id)" class="space-y-2 md:col-span-2">
                <Label for="receipt" class="flex items-center">
                  Receipt <span class="text-red-500 ml-1">*</span>
                </Label>
                
                <!-- If no receipt is uploaded yet -->
                <div 
                  v-if="!receiptPaths[expense.id]" 
                  class="border-2 border-dashed rounded-md p-4 text-center transition-colors duration-200"
                  :class="{
                    'border-gray-300 bg-gray-50': !isDragging[expense.id],
                    'border-primary bg-primary/5': isDragging[expense.id]
                  }"
                  @dragenter="(e) => handleDragEnter(e, expense.id)"
                  @dragleave="(e) => handleDragLeave(e, expense.id)"
                  @dragover="handleDragOver"
                  @drop="(e) => handleDrop(e, expense.id)"
                >
                  <input 
                    type="file" 
                    :id="`receipt-${expense.id}`" 
                    class="hidden" 
                    accept="image/*,.pdf,.heic,.heif" 
                    @change="(e) => handleFileUpload(e, expense.id)"
                    required
                  />
                  <label :for="`receipt-${expense.id}`" class="cursor-pointer">
                    <div class="flex flex-col items-center justify-center">
                      <Upload class="h-8 w-8 mb-2" :class="isDragging[expense.id] ? 'text-primary' : 'text-gray-400'" />
                      <p class="text-responsive-sm font-medium">
                        {{ isDragging[expense.id] ? 'Drop file here' : uploadStatus[expense.id] === 'uploading' ? 'Uploading...' : 'Click or drag file here' }}
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

                <!-- If first receipt is uploaded, show success and second receipt option -->
                <div v-else class="space-y-4">
                  <!-- First receipt success -->
                  <div class="border-2 border-green-200 rounded-md p-4">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center">
                        <Check class="h-5 w-5 text-green-500 mr-2" />
                        <div>
                          <p class="text-responsive-sm font-medium">First Receipt uploaded successfully</p>
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

                  <!-- Second receipt upload section -->
                  <div v-if="!secondReceiptPaths[expense.id]">
                    <Label for="secondReceipt" class="flex items-center mb-2">
                      Second Receipt (Optional)
                    </Label>
                    
                    <div 
                      class="border-2 border-dashed rounded-md p-4 text-center transition-colors duration-200"
                      :class="{
                        'border-gray-300 bg-gray-50': !isDragging[expense.id],
                        'border-primary bg-primary/5': isDragging[expense.id]
                      }"
                      @dragenter="(e) => handleDragEnter(e, expense.id)"
                      @dragleave="(e) => handleDragLeave(e, expense.id)"
                      @dragover="handleDragOver"
                      @drop="(e) => handleSecondDrop(e, expense.id)"
                    >
                      <input 
                        type="file" 
                        :id="`secondReceipt-${expense.id}`" 
                        class="hidden" 
                        accept="image/*,.pdf,.heic,.heif" 
                        @change="(e) => handleSecondFileUpload(e, expense.id)"
                      />
                      <label :for="`secondReceipt-${expense.id}`" class="cursor-pointer">
                        <div class="flex flex-col items-center justify-center">
                          <Upload class="h-8 w-8 mb-2" :class="isDragging[expense.id] ? 'text-primary' : 'text-gray-400'" />
                          <p class="text-responsive-sm font-medium">
                            {{ isDragging[expense.id] ? 'Drop second receipt here' : 'Click or drag second receipt here' }}
                          </p>
                          <p class="text-responsive-xs text-gray-500 mt-1">
                            JPG, PNG or PDF (max. 10MB)
                          </p>
                          
                          <!-- Progress bar for second upload -->
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
                  </div>

                  <!-- If second receipt is uploaded -->
                  <div v-else class="border-2 border-green-200 rounded-md p-4">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center">
                        <Check class="h-5 w-5 text-green-500 mr-2" />
                        <div>
                          <p class="text-responsive-sm font-medium">Second Receipt uploaded successfully</p>
                          <p class="text-responsive-xs text-gray-500">
                            {{ expense.receiptTwo?.name || 'File uploaded' }}
                          </p>
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        @click="deleteSecondFile(expense.id)" 
                        type="button"
                        class="text-red-500"
                      >
                        <X class="h-4 w-4" />
                      </Button>
                    </div>
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
      </div>

      <!-- Replace the existing fixed footer with this updated version -->
      <div class="fixed bottom-0 right-0 lg:left-64 left-0 bg-white border-t shadow-lg p-4 z-40">
        <div class="max-w-7xl mx-auto">
          <!-- Desktop View -->
          <div class="hidden md:flex items-center justify-between">
            <!-- Summary Section -->
            <div class="flex items-center space-x-6">
              <div>
                <span class="text-sm text-gray-500">Total Claims:</span>
                <span class="ml-2 font-semibold">{{ totalClaimsCount }}</span>
              </div>
              <div>
                <span class="text-sm text-gray-500">Grand Total:</span>
                <span class="ml-2 font-bold text-primary">${{ grandTotal }}</span>
              </div>
            </div>
            
            <!-- Submit Button -->
            <Button type="submit" class="px-6 flex items-center justify-center" :disabled="loading || categoriesLoading">
              <LoaderCircle v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
              <span>{{ loading ? 'Submitting...' : 'Submit Expenses' }}</span>
            </Button>
          </div>

          <!-- Mobile View -->
          <div class="md:hidden">
            <div class="grid grid-cols-2 gap-2 mb-3">
              <div>
                <span class="text-sm text-gray-500">Claims:</span>
                <span class="ml-1 font-semibold">{{ totalClaimsCount }}</span>
              </div>
              <div>
                <span class="text-sm text-gray-500">Grand Total:</span>
                <span class="ml-2 font-bold text-primary">${{ grandTotal }}</span>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <Button type="submit" class="w-full px-6 flex items-center justify-center" :disabled="loading || categoriesLoading">
                <LoaderCircle v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
                <span>{{ loading ? 'Submitting...' : 'Submit Expenses' }}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Add padding to the bottom of the main content to prevent overlap with fixed footer -->
      <div class="pb-24"></div>
    </form>

    <!-- Add confirmation modal -->
    <div v-if="showConfirmModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 class="text-lg font-medium mb-4">Confirm Submission</h3>
        <p class="mb-6">Are you sure you want to submit {{ totalClaimsCount }} claim{{ totalClaimsCount > 1 ? 's' : '' }}?</p>
        <div class="flex justify-end space-x-2">
          <Button variant="outline" @click="cancelSubmit">Cancel</Button>
          <Button @click="confirmSubmit" :disabled="loading">
            <LoaderCircle v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
            <span>{{ loading ? 'Submitting...' : 'Confirm' }}</span>
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Add these transition styles to the existing style section or create it if not present */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
  max-height: 60px;
  overflow: hidden;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-10px);
}

/* Add these styles to your existing style section */
.border-dashed {
  border-style: dashed;
}

.transition-colors {
  transition-property: background-color, border-color, color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.duration-200 {
  transition-duration: 200ms;
}
</style>