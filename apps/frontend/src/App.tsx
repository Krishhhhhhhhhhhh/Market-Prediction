import { useState,useEffect } from 'react'
import { useUser } from '../hooks/useUser'
import { supabase } from './lib/supabase'
import axios from 'axios'


function App() {
  const { claims, signInWithSolana, signInWithGoogle } = useUser()
  const [message, setMessage] = useState("")
  useEffect(()=>{
    console.log(claims);
  }, [claims]);
  

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
            <p>Welcome, {claims?.email}</p>
          <button type="button" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </>
      )
      }
      
      <button type="button" onClick={async () => {
        console.log("button clicked")
        const { data: { session }, error } = await supabase.auth.getSession()
        console.log("session:", session, "error:", error)
        if (!session) {
          console.log("no session, returning early")
          return
        }

        try {
          const res = await axios.post("http://localhost:3000/buy", {}, {
            headers: {
              Authorization: session.access_token,
            },
          })
          console.log("response:", res)
          setMessage(res.data.message)
        } catch (err) {
          console.log("axios error:", err)
        }
      }}>
        Click here to buy</button>
      {message && <p>{message}</p>}
    </div>
  )
}

export default App
