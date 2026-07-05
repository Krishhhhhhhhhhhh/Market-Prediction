import { useUser } from '../hooks/useUser'
import { supabase } from './lib/supabase'

function App() {
  const { claims, signInWithSolana, signInWithGoogle } = useUser()

  return (
    <div>
      {!claims ? (
        <>
          <p>Not signed in</p>
          <button type="button" onClick={signInWithSolana}>
            Sign in with Solana
          </button>
          <button type="button" onClick={signInWithGoogle}>
            Sign in with Google
          </button>
        </>
      ) : (
        <>
          <p>Signed in</p>
          <button type="button" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </>
      )}
      {JSON.stringify(claims)}
    </div>
  )
}

export default App
