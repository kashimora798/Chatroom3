import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://itjukxjshcobpibmbrzq.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0anVreGpzaGNvYnBpYm1icnpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3MjQ0ODIsImV4cCI6MjA2NTMwMDQ4Mn0.G0OegxZe6R0akrl87bu2O5cq2ewbpwBjXOIRNphwcRE'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
})
