export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  modules: [
    '@nuxtjs/tailwindcss',
    'shadcn-nuxt',
    '@nuxtjs/supabase',
    'nuxt-pdfmake'
  ],
  shadcn: {
    /**
     * Prefix for all the imported component
     */
    prefix: '',
    /**
     * Directory that the component lives in.
     * @default "./components/ui"
     */
    componentDir: './components/ui'
  },
  vite: {
    optimizeDeps: {
      include: ['cookie']
    },
    define: {
      global: {}
    }
  },
  runtimeConfig: {
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.FROM_EMAIL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,

    // Public (available on client)
    public: {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      siteUrl: process.env.SITE_URL
    }
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/public/*', '/reset_password', '/request_password_reset', '/signup'],
    }
  }
})