<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { 
  Home, 
  CircleDollarSign,
  UserRoundCog,
  X,
  FilePlus2
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const route = useRoute()

const navItems = [
  { name: 'Dashboard', icon: Home, path: '/e/' },
  { name: 'Add Expense', icon: FilePlus2, path: '/e/add-expense' },
  { name: 'Expenses', icon: CircleDollarSign, path: '/e/expenses' },
  { name: 'Settings', icon: UserRoundCog, path: '/e/settings' },
]

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'closeSidebar'): void
}>()
</script>

<template>
  <aside 
    :class="[
      'fixed inset-y-0 left-0 z-50 w-64 border-r bg-background transition-transform duration-300 md:static',
      isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
    ]"
  >
    <div class="flex h-16 items-center justify-between border-b px-4">
      <div class="flex items-center">
        <img src="/gibraltar_rock.svg" alt="Gibraltar Rock" class="h-6 w-6" />
        <h1 class="text-responsive-base font-semibold ml-2">GibClaim</h1>
      </div>
      <Button 
        variant="ghost" 
        size="icon" 
        @click="emit('closeSidebar')" 
        class="md:hidden"
      >
        <X class="h-5 w-5" />
      </Button>
    </div>
    <nav class="space-y-1 px-2 py-4">
      <NuxtLink
        v-for="item in navItems"
        :key="item.name"
        :to="item.path"
        :class="[
          'flex items-center rounded-md px-3 py-2 text-responsive-sm font-medium relative',
          route.path === item.path
            ? 'bg-secondary/20 text-secondary border-l-4 border-secondary'
            : 'text-muted-foreground hover:bg-secondary/20 hover:text-secondary'
        ]"
      >
        <component :is="item.icon" class="mr-3 h-5 w-5" />
        {{ item.name }}
      </NuxtLink>
    </nav>
  </aside>
</template>