import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fkmlfcdjwmdqlcihsoas.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrbWxmY2Rqd21kcWxjaWhzb2FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3MjgwNTcsImV4cCI6MjA2NTMwNDA1N30.iy-zty5JKlZdOa6D8Kfq1qZF0AOOjhrCsNsHtUpK2pc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
})