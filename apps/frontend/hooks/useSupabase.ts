import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

export function useSupabase() {
  const [supabase, setSupabase] = useState<SupabaseClient | undefined>()

  useEffect(() => {
    const client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
    )
    setSupabase(client)
  }, [])

  return supabase
}
