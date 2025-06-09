<script setup lang="ts">
import { ref } from 'vue'
import TopNav from '@/components/TopNav.vue'
import Sidebar from '@/components/Sidebar.vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isSidebarOpen = ref(false)

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const closeSidebar = () => {
  isSidebarOpen.value = false
}

useHead({
  title: route.meta.title || 'Employee Dashboard',
  titleTemplate: (title) => {
    return title ? `${title} - GibClaim` : 'GibClaim'
  }
})
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <Sidebar :isOpen="isSidebarOpen" @closeSidebar="closeSidebar" />
    <div class="flex flex-1 flex-col overflow-hidden bg-muted">
      <TopNav :toggleSidebar="toggleSidebar" />
      <main class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>
  </div>
</template> 