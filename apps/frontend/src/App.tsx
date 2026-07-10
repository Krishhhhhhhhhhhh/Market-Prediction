import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import type { Session } from '@supabase/supabase-js'
import { useUser } from '../hooks/useUser'
import { supabase } from './lib/supabase'
import './App.css'

type BookOrder = {
  userId: string
  type: 'buy' | 'sell'
  price: number
  qty: number
  filledQty?: number
  originalOrderId?: string
}

type Market = {
  id: string
  title: string
  description: string
  resolutionDescription: string
  yesOrderbook: unknown
  noOrderbook: unknown
  totalQty: number
  resolution?: 'YES' | 'NO' | null
}

type Position = {
  id: string
  userId: string
  marketId: string
  type: 'YES' | 'NO'
  qty: number
}

type OrderHistory = {
  id: string
  orderType: 'BUY' | 'SELL' | 'SPLIT' | 'MERGE'
  qty: number
  price: number
  userId: string
  marketId: string
  createdAt: string
}

type AccountState = {
  balance: number | null
  positions: Position[]
  history: OrderHistory[]
}

type TradeForm = {
  side: 'yes' | 'no'
  type: 'buy' | 'sell'
  price: number
  qty: number
}

type TransferForm = {
  amount: string
}

const api = axios.create({
  baseURL: 'http://localhost:3000',
})

const initialTradeForm: TradeForm = {
  side: 'yes',
  type: 'buy',
  price: 50,
  qty: 1,
}

const initialTransferForm: TransferForm = { amount: '25.00' }

function centsToUsd(value: number) {
  return `$${(value / 100).toFixed(2)}`
}

function usdToCents(value: number) {
  return value.toFixed(2)
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function normalizeBook(raw: unknown): BookOrder[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is BookOrder => typeof entry === 'object' && entry !== null) as BookOrder[]
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is BookOrder => typeof entry === 'object' && entry !== null) as BookOrder[]
      }
    } catch {
      return []
    }
  }

  return []
}

function aggregateLevels(book: BookOrder[], side: 'buy' | 'sell') {
  const levels = new Map<number, number>()

  for (const order of book) {
    if (order.type !== side) continue
    const remaining = Math.max(order.qty - (order.filledQty ?? 0), 0)
    if (remaining <= 0) continue
    levels.set(order.price, (levels.get(order.price) ?? 0) + remaining)
  }

  return Array.from(levels.entries())
    .map(([price, qty]) => ({ price, qty }))
    .sort((a, b) => (side === 'buy' ? b.price - a.price : a.price - b.price))
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-track" aria-hidden="true">
      <div className="progress-fill" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  )
}

function App() {
  const { claims, signInWithSolana, signInWithGoogle } = useUser()
  const [session, setSession] = useState<Session | null>(null)
  const [markets, setMarkets] = useState<Market[]>([])
  const [selectedMarketId, setSelectedMarketId] = useState<string>('')
  const [account, setAccount] = useState<AccountState>({ balance: null, positions: [], history: [] })
  const [tradeForm, setTradeForm] = useState<TradeForm>(initialTradeForm)
  const [transferForm, setTransferForm] = useState<TransferForm>(initialTransferForm)
  const [splitQty, setSplitQty] = useState('1')
  const [mergeQty, setMergeQty] = useState('1')
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [busy, setBusy] = useState<string>('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    api
      .get<{ markets: Market[] }>('/markets')
      .then(({ data }) => {
        setMarkets(data.markets)
        if (!selectedMarketId && data.markets[0]) {
          setSelectedMarketId(data.markets[0].id)
        }
      })
      .catch(() => setError('Unable to load markets'))
  }, [selectedMarketId])

  useEffect(() => {
    const token = session?.access_token

    if (!token) {
      setAccount({ balance: null, positions: [], history: [] })
      return
    }

    const headers = { Authorization: token }

    Promise.all([
      api.get<{ balance: number }>('/balance', { headers }),
      api.get<{ positions: Position[] }>('/positions', { headers }),
      api.get<{ history: OrderHistory[] }>('/history', { headers }),
    ])
      .then(([balanceResponse, positionsResponse, historyResponse]) => {
        setAccount({
          balance: balanceResponse.data.balance,
          positions: positionsResponse.data.positions,
          history: historyResponse.data.history,
        })
      })
      .catch(() => setError('Unable to load your account data'))
  }, [session])

  const selectedMarket = markets.find((market) => market.id === selectedMarketId) ?? markets[0]
  const yesBook = useMemo(() => normalizeBook(selectedMarket?.yesOrderbook), [selectedMarket])
  const noBook = useMemo(() => normalizeBook(selectedMarket?.noOrderbook), [selectedMarket])
  const yesBids = useMemo(() => aggregateLevels(yesBook, 'buy'), [yesBook])
  const yesAsks = useMemo(() => aggregateLevels(yesBook, 'sell'), [yesBook])
  const noBids = useMemo(() => aggregateLevels(noBook, 'buy'), [noBook])
  const noAsks = useMemo(() => aggregateLevels(noBook, 'sell'), [noBook])

  useEffect(() => {
    if (!selectedMarket) return
    setTradeForm((current) => ({
      ...current,
      side: current.side,
    }))
  }, [selectedMarket])

  async function authHeaders() {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      throw new Error('Sign in to trade')
    }

    return { Authorization: token }
  }

  async function submitTrade() {
    if (!selectedMarket) return
    setBusy('trade')
    setError('')
    setStatus('')

    try {
      const headers = await authHeaders()
      const payload = {
        marketId: selectedMarket.id,
        side: tradeForm.side,
        price: tradeForm.price,
        qty: tradeForm.qty,
      }

      const endpoint = tradeForm.type === 'buy' ? '/buy' : '/sell'
      const { data } = await api.post<{ message: string; orderId?: string }>(endpoint, payload, { headers })
      setStatus(data.message)
      await refreshAccount(headers.Authorization)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Trade failed')
    } finally {
      setBusy('')
    }
  }

  async function submitSplitMerge(path: '/split' | '/merge', qtyValue: string) {
    if (!selectedMarket) return
    setBusy(path)
    setError('')
    setStatus('')

    try {
      const headers = await authHeaders()
      const { data } = await api.post<{ message: string }>(path, {
        marketId: selectedMarket.id,
        qty: Number(qtyValue),
      }, { headers })
      setStatus(data.message)
      await refreshAccount(headers.Authorization)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed')
    } finally {
      setBusy('')
    }
  }

  async function submitTransfer(path: '/onramp' | '/offramp') {
    setBusy(path)
    setError('')
    setStatus('')

    try {
      const headers = await authHeaders()
      const amount = Number(transferForm.amount)
      const { data } = await api.post<{ message: string; amount: number }>(path, { amount }, { headers })
      setStatus(`${data.message}: ${usdToCents(data.amount)}`)
      await refreshAccount(headers.Authorization)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transfer failed')
    } finally {
      setBusy('')
    }
  }

  async function refreshAccount(token: string) {
    const headers = { Authorization: token }
    const [balanceResponse, positionsResponse, historyResponse] = await Promise.all([
      api.get<{ balance: number }>('/balance', { headers }),
      api.get<{ positions: Position[] }>('/positions', { headers }),
      api.get<{ history: OrderHistory[] }>('/history', { headers }),
    ])

    setAccount({
      balance: balanceResponse.data.balance,
      positions: positionsResponse.data.positions,
      history: historyResponse.data.history,
    })
  }

  const openInterest = markets.reduce((sum, market) => sum + market.totalQty, 0)
  const yesHoldings = account.positions.filter((position) => position.type === 'YES').reduce((sum, position) => sum + position.qty, 0)
  const noHoldings = account.positions.filter((position) => position.type === 'NO').reduce((sum, position) => sum + position.qty, 0)
  const activePositions = account.positions.filter((position) => position.qty > 0)
  const recentHistory = [...account.history].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 6)

  const marketScore = selectedMarket ? Math.max(0, Math.min(100, Math.round((selectedMarket.totalQty / Math.max(openInterest || 1, 1)) * 100))) : 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div>
            <span className="eyebrow">Prediction market</span>
            <h1>Polymarket desk</h1>
          </div>
          <p>
            Trade YES and NO positions, split and merge shares, and move cash in or out from a single dark terminal.
          </p>
        </div>

        <div className="auth-card">
          <div className="auth-card__title">Account</div>
          {claims ? (
            <>
              <div className="auth-line">Signed in as {claims.email ?? 'wallet user'}</div>
              <button className="ghost-button" type="button" onClick={() => supabase.auth.signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className="auth-line">Connect to trade and view your balance.</div>
              <div className="stack-buttons">
                <button className="primary-button" type="button" onClick={signInWithSolana}>Sign in with Solana</button>
                <button className="ghost-button" type="button" onClick={signInWithGoogle}>Sign in with Google</button>
              </div>
            </>
          )}
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Balance</span>
            <strong>{account.balance === null ? '—' : centsToUsd(account.balance)}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">YES qty</span>
            <strong>{yesHoldings}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">NO qty</span>
            <strong>{noHoldings}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Markets</span>
            <strong>{markets.length}</strong>
          </div>
        </div>

        <div className="section-panel">
          <div className="section-title-row">
            <h2>Markets</h2>
            <span className="section-pill">{openInterest} total qty</span>
          </div>
          <div className="market-list">
            {markets.map((market) => {
              const active = market.id === selectedMarket?.id
              return (
                <button
                  key={market.id}
                  type="button"
                  className={`market-card ${active ? 'market-card--active' : ''}`}
                  onClick={() => setSelectedMarketId(market.id)}
                >
                  <div className="market-card__top">
                    <span className="market-tag">{market.resolution ?? 'Open'}</span>
                    <span className="market-volume">{market.totalQty} qty</span>
                  </div>
                  <div className="market-card__title">{market.title}</div>
                  <p>{market.description}</p>
                </button>
              )
            })}
          </div>
        </div>
      </aside>

      <main className="main-stage">
        <header className="hero-card">
          <div>
            <span className="eyebrow">Live market</span>
            <h2>{selectedMarket?.title ?? 'Select a market'}</h2>
            <p>{selectedMarket?.resolutionDescription ?? 'Choose a market from the sidebar to view the orderbook and trade ticket.'}</p>
          </div>
          <div className="hero-card__metrics">
            <div>
              <span>Open interest</span>
              <strong>{openInterest}</strong>
            </div>
            <div>
              <span>Market share</span>
              <strong>{marketScore}%</strong>
            </div>
          </div>
        </header>

        <section className="content-grid">
          <div className="panel orderbook-panel">
            <div className="section-title-row">
              <h2>Orderbook</h2>
              <span className="section-pill">YES / NO</span>
            </div>
            <div className="orderbook-grid">
              <div>
                <div className="book-heading book-heading--yes">YES bids</div>
                <div className="book-list">
                  {yesBids.length > 0 ? yesBids.map((level) => (
                    <div key={`yes-bid-${level.price}`} className="book-row">
                      <span>{level.price}</span>
                      <strong>{level.qty}</strong>
                    </div>
                  )) : <div className="empty-state">No bids yet</div>}
                </div>
                <div className="book-heading book-heading--muted">YES asks</div>
                <div className="book-list">
                  {yesAsks.length > 0 ? yesAsks.map((level) => (
                    <div key={`yes-ask-${level.price}`} className="book-row">
                      <span>{level.price}</span>
                      <strong>{level.qty}</strong>
                    </div>
                  )) : <div className="empty-state">No asks yet</div>}
                </div>
              </div>
              <div>
                <div className="book-heading book-heading--no">NO bids</div>
                <div className="book-list">
                  {noBids.length > 0 ? noBids.map((level) => (
                    <div key={`no-bid-${level.price}`} className="book-row">
                      <span>{level.price}</span>
                      <strong>{level.qty}</strong>
                    </div>
                  )) : <div className="empty-state">No bids yet</div>}
                </div>
                <div className="book-heading book-heading--muted">NO asks</div>
                <div className="book-list">
                  {noAsks.length > 0 ? noAsks.map((level) => (
                    <div key={`no-ask-${level.price}`} className="book-row">
                      <span>{level.price}</span>
                      <strong>{level.qty}</strong>
                    </div>
                  )) : <div className="empty-state">No asks yet</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="panel trade-panel">
            <div className="section-title-row">
              <h2>Trade ticket</h2>
              <span className="section-pill">Protected endpoints</span>
            </div>

            <div className="toggle-row">
              <button
                type="button"
                className={tradeForm.type === 'buy' ? 'toggle-button toggle-button--active' : 'toggle-button'}
                onClick={() => setTradeForm((current) => ({ ...current, type: 'buy' }))}
              >
                Buy
              </button>
              <button
                type="button"
                className={tradeForm.type === 'sell' ? 'toggle-button toggle-button--active' : 'toggle-button'}
                onClick={() => setTradeForm((current) => ({ ...current, type: 'sell' }))}
              >
                Sell
              </button>
            </div>

            <div className="toggle-row compact">
              <button
                type="button"
                className={tradeForm.side === 'yes' ? 'toggle-button toggle-button--active toggle-button--yes' : 'toggle-button'}
                onClick={() => setTradeForm((current) => ({ ...current, side: 'yes' }))}
              >
                YES
              </button>
              <button
                type="button"
                className={tradeForm.side === 'no' ? 'toggle-button toggle-button--active toggle-button--no' : 'toggle-button'}
                onClick={() => setTradeForm((current) => ({ ...current, side: 'no' }))}
              >
                NO
              </button>
            </div>

            <label className="field">
              <span>Price</span>
              <input
                type="number"
                min={1}
                max={99}
                value={tradeForm.price}
                onChange={(event) => setTradeForm((current) => ({ ...current, price: Number(event.target.value) }))}
              />
            </label>

            <label className="field">
              <span>Quantity</span>
              <input
                type="number"
                min={1}
                step={1}
                value={tradeForm.qty}
                onChange={(event) => setTradeForm((current) => ({ ...current, qty: Number(event.target.value) }))}
              />
            </label>

            <div className="ticket-summary">
              <div>
                <span>Est. notional</span>
                <strong>{centsToUsd(tradeForm.price * tradeForm.qty)}</strong>
              </div>
              <div>
                <span>Action</span>
                <strong>{tradeForm.type.toUpperCase()} {tradeForm.side.toUpperCase()}</strong>
              </div>
            </div>

            <button className="action-button" type="button" onClick={submitTrade} disabled={busy === 'trade'}>
              {busy === 'trade' ? 'Submitting...' : `Place ${tradeForm.type}`}
            </button>

            <ProgressBar value={marketScore} />
          </div>

          <div className="panel wallet-panel">
            <div className="section-title-row">
              <h2>Wallet</h2>
              <span className="section-pill">Cents-based ledger</span>
            </div>

            <div className="wallet-grid">
              <label className="field">
                <span>Onramp amount</span>
                <input value={transferForm.amount} onChange={(event) => setTransferForm({ amount: event.target.value })} />
              </label>

              <div className="wallet-actions">
                <button className="action-button action-button--secondary" type="button" onClick={() => submitTransfer('/onramp')} disabled={busy === '/onramp'}>
                  {busy === '/onramp' ? 'Funding...' : 'Onramp'}
                </button>
                <button className="action-button action-button--secondary" type="button" onClick={() => submitTransfer('/offramp')} disabled={busy === '/offramp'}>
                  {busy === '/offramp' ? 'Withdrawing...' : 'Offramp'}
                </button>
              </div>

              <label className="field">
                <span>Split qty</span>
                <input type="number" min={1} step={1} value={splitQty} onChange={(event) => setSplitQty(event.target.value)} />
              </label>

              <div className="wallet-actions">
                <button className="action-button action-button--secondary" type="button" onClick={() => submitSplitMerge('/split', splitQty)} disabled={busy === '/split'}>
                  {busy === '/split' ? 'Splitting...' : 'Split'}
                </button>
                <button className="action-button action-button--secondary" type="button" onClick={() => submitSplitMerge('/merge', mergeQty)} disabled={busy === '/merge'}>
                  {busy === '/merge' ? 'Merging...' : 'Merge'}
                </button>
              </div>

              <label className="field">
                <span>Merge qty</span>
                <input type="number" min={1} step={1} value={mergeQty} onChange={(event) => setMergeQty(event.target.value)} />
              </label>
            </div>

            <div className="summary-strip">
              <div>
                <span>Balance</span>
                <strong>{account.balance === null ? '—' : centsToUsd(account.balance)}</strong>
              </div>
              <div>
                <span>Recent positions</span>
                <strong>{activePositions.length}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="content-grid content-grid--lower">
          <div className="panel">
            <div className="section-title-row">
              <h2>Positions</h2>
              <span className="section-pill">{activePositions.length} open</span>
            </div>
            <div className="table-list">
              {activePositions.length > 0 ? activePositions.map((position) => (
                <div key={position.id} className="table-row">
                  <div>
                    <strong>{position.type}</strong>
                    <span>{position.marketId}</span>
                  </div>
                  <strong>{position.qty}</strong>
                </div>
              )) : <div className="empty-state">No open positions yet.</div>}
            </div>
          </div>

          <div className="panel">
            <div className="section-title-row">
              <h2>Recent activity</h2>
              <span className="section-pill">Latest 6</span>
            </div>
            <div className="table-list">
              {recentHistory.length > 0 ? recentHistory.map((entry) => (
                <div key={entry.id} className="table-row table-row--history">
                  <div>
                    <strong>{entry.orderType}</strong>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <div className="history-meta">
                    <strong>{entry.qty}</strong>
                    <span>{centsToUsd(entry.price)}</span>
                  </div>
                </div>
              )) : <div className="empty-state">No account activity yet.</div>}
            </div>
          </div>
        </section>

        {(status || error) && (
          <div className={error ? 'toast toast--error' : 'toast'}>
            {error || status}
          </div>
        )}
      </main>
    </div>
  )
}

export default App