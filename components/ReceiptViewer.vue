<!-- components/ReceiptViewer.vue -->
<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2 } from 'lucide-vue-next'
import { getReceiptSignedUrl } from '~/lib/utils'

const client = useSupabaseClient()

const open = defineModel<boolean>('open')
const props = withDefaults(defineProps<{
  url1?: string | null
  url2?: string | null
  title?: string
}>(), {
  title: 'Receipt'
})

const activeTab = ref<'r1' | 'r2'>('r1')
const hasSecond = computed(() => !!props.url2)

const signed1 = ref('')
const signed2 = ref('')
const isImg1 = ref(false)
const isImg2 = ref(false)
const loading1 = ref(false)
const loading2 = ref(false)

async function loadUrls() {
  signed1.value = ''
  signed2.value = ''
  isImg1.value = false
  isImg2.value = false

  if (props.url1) {
    loading1.value = true
    try {
      const { signedUrl, isImage } = await getReceiptSignedUrl(client, props.url1)
      signed1.value = signedUrl || ''
      isImg1.value = !!isImage
    } finally {
      loading1.value = false
    }
  }

  if (props.url2) {
    loading2.value = true
    try {
      const { signedUrl, isImage } = await getReceiptSignedUrl(client, props.url2)
      signed2.value = signedUrl || ''
      isImg2.value = !!isImage
    } finally {
      loading2.value = false
    }
  }
}

watch(() => open?.value, (val) => {
  if (val) {
    activeTab.value = props.url1 ? 'r1' : 'r2'
    loadUrls()
  }
})

watch(() => [props.url1, props.url2], () => {
  if (open?.value) {
    activeTab.value = props.url1 ? 'r1' : 'r2'
    loadUrls()
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{{ props.title }}</DialogTitle>
      </DialogHeader>

      <div class="h-[70vh] overflow-auto">
        <template v-if="hasSecond">
          <Tabs v-model="activeTab" default-value="r1" class="w-full">
            <TabsList class="grid grid-cols-2 w-full bg-primary p-1 rounded-md">
              <TabsTrigger
                value="r1"
                class="text-white data-[state=active]:bg-secondary data-[state=active]:text-white rounded-sm"
              >
                Receipt 1
              </TabsTrigger>
              <TabsTrigger
                value="r2"
                class="text-white data-[state=active]:bg-secondary data-[state=active]:text-white rounded-sm"
              >
                Receipt 2
              </TabsTrigger>
            </TabsList>

            <TabsContent value="r1">
              <div class="h-[64vh] overflow-auto">
                <div v-if="loading1" class="flex items-center justify-center h-full">
                  <Loader2 class="h-8 w-8 animate-spin text-black" />
                </div>
                <img v-else-if="isImg1 && signed1" :src="signed1" class="max-w-full max-h-full object-contain mx-auto" alt="Receipt 1" />
                <iframe v-else-if="signed1" :src="signed1" class="w-full h-full"></iframe>
              </div>
            </TabsContent>

            <TabsContent value="r2">
              <div class="h-[64vh] overflow-auto">
                <div v-if="loading2" class="flex items-center justify-center h-full">
                  <Loader2 class="h-8 w-8 animate-spin text-black" />
                </div>
                <img v-else-if="isImg2 && signed2" :src="signed2" class="max-w-full max-h-full object-contain mx-auto" alt="Receipt 2" />
                <iframe v-else-if="signed2" :src="signed2" class="w-full h-full"></iframe>
              </div>
            </TabsContent>
          </Tabs>
        </template>

        <template v-else>
          <div class="h-[64vh] overflow-auto">
            <div v-if="loading1" class="flex items-center justify-center h-full">
              <Loader2 class="h-8 w-8 animate-spin text-black" />
            </div>
            <img v-else-if="isImg1 && signed1" :src="signed1" class="max-w-full max-h-full object-contain mx-auto" alt="Receipt" />
            <iframe v-else-if="signed1" :src="signed1" class="w-full h-full"></iframe>
          </div>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
