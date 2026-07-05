import { useEffect, useState } from 'react'
import type { JwtPayload } from '@supabase/supabase-js'
import { supabase } from '../src/lib/supabase'

export function useUser() {
  const [claims, setClaims] = useState<JwtPayload | null>(null)

  useEffect(() => {
    supabase.auth.getClaims().then(({ data }) => {
      setClaims(data?.claims ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      supabase.auth.getClaims().then(({ data }) => {
        setClaims(data?.claims ?? null)
      })
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signInWithSolana() {
    await supabase.auth.signInWithWeb3({
      chain: 'solana',
      statement: 'I confirm that I want to sign in to prediction market',
    })
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
  }

  return { claims, signInWithSolana, signInWithGoogle }
}
