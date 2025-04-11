<script setup lang="ts">
import { Menu } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import UserMenu from './UserMenu.vue'
import { useRoute } from 'vue-router'

const props = defineProps<{
  toggleSidebar: () => void
}>()

const route = useRoute()
</script>

<template>
  <header class="sticky top-0 z-40 border-b bg-background">
    <div class="flex h-16 items-center justify-between px-4">
      <div class="flex items-center">
        <Button variant="ghost" size="icon" @click="toggleSidebar" class="md:hidden">
          <Menu class="h-5 w-5" />
        </Button>
        <h2 class="text-responsive-lg font-semibold ml-2 md:ml-0">
          <span v-if="route.path.startsWith('/m')">Manager Dashboard</span>
          <span v-else-if="route.path.startsWith('/a')">Admin Dashboard</span>
          <span v-else-if="route.path.startsWith('/e')">Employee Dashboard</span>
          <span v-else-if="route.path.startsWith('/f')">Accounting Dashboard</span>
          <span v-else>Dashboard</span>
        </h2>
      </div>
      <div class="flex items-center gap-4">
        <UserMenu />
      </div>
    </div>
  </header>
</template>