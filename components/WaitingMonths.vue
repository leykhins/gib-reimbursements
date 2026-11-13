<script setup lang="ts">
import type { WaitingMonth } from '~/lib/utils'

// The queue pages show one month at a time, but claims wait in any month.
// This lists every month with claims waiting, across years, so nothing old
// gets missed. Ported from gibclaim's queue page.

const props = defineProps<{ months: WaitingMonth[]; year: number; month: number }>()
const emit = defineEmits<{ select: [year: number, month: number] }>()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const isCurrent = (m: WaitingMonth) => m.year === props.year && m.month === props.month
</script>

<template>
  <nav v-if="months.length" aria-label="Months with claims waiting on you" class="flex flex-wrap items-center gap-2">
    <span class="text-xs text-muted-foreground">Waiting in</span>
    <button
      v-for="m in months"
      :key="`${m.year}-${m.month}`"
      type="button"
      :aria-current="isCurrent(m) ? 'true' : undefined"
      :class="[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isCurrent(m) ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
      ]"
      @click="emit('select', m.year, m.month)"
    >
      {{ MONTHS[m.month] }} {{ m.year }}
      <span :class="['tabular-nums', isCurrent(m) ? 'opacity-80' : 'text-muted-foreground']">{{ m.count }}</span>
    </button>
  </nav>
</template>
