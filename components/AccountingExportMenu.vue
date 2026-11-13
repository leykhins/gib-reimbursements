<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, Download, FileText, FileStack, Loader2, Sheet } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

// One export menu per employee on the accounting expenses page, so each
// export says what it contains. Ported from gibclaim's AccountingExport.
//  - New claims: a PDF of processed claims never downloaded before
//  - All claims: a PDF of every processed claim, downloaded or not
//  - CSV: every claim shown for the employee, for a spreadsheet

// `generating` spins this menu; `disabled` holds every menu while any PDF builds
const props = defineProps<{ claims: any[]; generating: boolean; disabled?: boolean }>()
const emit = defineEmits<{ pdf: [includeDownloaded: boolean]; csv: [] }>()

const processed = computed(() => props.claims.filter(c => c.status === 'completed'))
const fresh = computed(() => processed.value.filter(c => !c.pdf_downloaded_at).length)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        class="border-white/40 bg-white/20 hover:bg-white/30 disabled:opacity-50"
        :disabled="generating || disabled"
        :aria-label="fresh ? `Export, ${fresh} new` : 'Export'"
        @click.stop
      >
        <Loader2 v-if="generating" class="mr-1 h-4 w-4 animate-spin" />
        <Download v-else class="mr-1 h-4 w-4" />
        Export
        <span v-if="fresh" class="ml-1.5 rounded bg-orange-500 px-1.5 text-[0.6875rem] font-semibold text-white">{{ fresh }} new</span>
        <ChevronDown class="ml-1 h-3.5 w-3.5 opacity-70" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-72" @click.stop>
      <DropdownMenuItem :disabled="!fresh" class="items-start gap-2" @select="emit('pdf', false)">
        <FileText class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="flex flex-col">
          <span>Export new claims</span>
          <span class="text-xs text-muted-foreground">{{ fresh ? `PDF of ${plural(fresh, 'processed claim')} not yet downloaded` : 'Every processed claim is in a PDF already' }}</span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem :disabled="!processed.length" class="items-start gap-2" @select="emit('pdf', true)">
        <FileStack class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="flex flex-col">
          <span>Export all claims</span>
          <span class="text-xs text-muted-foreground">{{ processed.length ? `PDF of ${processed.length === 1 ? 'the processed claim' : `all ${processed.length} processed claims`}, including downloaded ones` : 'No processed claims yet' }}</span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="items-start gap-2" @select="emit('csv')">
        <Sheet class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="flex flex-col">
          <span>Export CSV</span>
          <span class="text-xs text-muted-foreground">{{ plural(claims.length, 'claim') }} shown, for a spreadsheet</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
