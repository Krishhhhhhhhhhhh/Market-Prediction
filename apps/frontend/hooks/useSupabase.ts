import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabase: SupabaseClient = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
)

export function useSupabase(): SupabaseClient {
  return supabase
}
