import { useState } from 'react'
import { useUser } from '../hooks/useUser'
import { supabase } from './lib/supabase'
import axios from 'axios'


function App() {
  const { claims, signInWithSolana, signInWithGoogle } = useUser()
  const [message, setMessage] = useState("")

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
      <button type="button" onClick={async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const res = await axios.post("http://localhost:3000/buy", {}, {
          headers: {
            Authorization: session.access_token,
          },
        })
        setMessage(res.data.message)
      }}>
        Click here to buy</button>
      {message && <p>{message}</p>}
    </div>
  )
}

export default App
