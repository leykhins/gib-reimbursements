<!-- components/ReceiptViewer.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { getReceiptSignedUrl } from '~/lib/utils'
import Lightbox, { type LightboxItem } from '~/components/Lightbox.vue'

const client = useSupabaseClient()

const open = defineModel<boolean>('open')
const props = withDefaults(defineProps<{
  url1?: string | null
  url2?: string | null
  title?: string
}>(), {
  title: 'Receipt'
})

const items = ref<LightboxItem[]>([])
const index = ref(0)
const loading = ref(false)
let request = 0

/** Browsers show images and PDFs. Anything else is offered as a download. */
function canFrame(path: string) {
  return /\.pdf$/i.test(path)
}

async function loadUrls() {
  const token = ++request
  const paths = [props.url1, props.url2].filter((p): p is string => !!p)
  index.value = 0
  items.value = []
  if (!paths.length) return

  loading.value = true
  try {
    const loaded = await Promise.all(paths.map(async (path, i) => {
      const { signedUrl, isImage } = await getReceiptSignedUrl(client, path)
      return {
        src: signedUrl || '',
        isImage,
        canFrame: isImage || canFrame(path),
        label: paths.length > 1 ? `Receipt ${i + 1}` : 'Receipt',
        failed: !signedUrl,
      } satisfies LightboxItem
    }))
    // A newer claim was opened while these were loading.
    if (token !== request) return
    items.value = loaded
  } finally {
    if (token === request) loading.value = false
  }
}

watch(() => open.value, (val) => {
  if (val) loadUrls()
})

watch(() => [props.url1, props.url2], () => {
  if (open.value) loadUrls()
})
</script>

<template>
  <Lightbox
    v-model:open="open"
    v-model:index="index"
    :items="items"
    :title="props.title"
    :loading="loading"
  />
</template>
