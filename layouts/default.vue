<template>
  <div>
    <slot />
  </div>
</template>

<script setup>
const route = useRoute()

useHead({
  title: route.meta.title || 'Gibraltar Reimbursements',
  titleTemplate: (title) => {
    return title ? `${title} - Gibraltar Reimbursements` : 'Gibraltar Reimbursements'
  },
  link: [
    {
      rel: 'preconnect',
      href: 'https://fonts.googleapis.com',
    },
    {
      rel: 'preconnect',
      href: 'https://fonts.gstatic.com',
      crossorigin: '',
    },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap',
    },
  ],
})
</script> 