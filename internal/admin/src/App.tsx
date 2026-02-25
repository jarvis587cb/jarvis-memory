import { useState, useEffect, useCallback, useMemo } from 'react'
import './App.css'

interface Seed {
  id: string
  content: string
  title: string
  type: string
  confidence: number
  protected: boolean
  last_accessed: string
  created_at: string
}

interface AgentContext {
  id: string
  agentId: string
  type: string
  metadata: Record<string, unknown> | null
  summary: string
  created_at: string
}

interface AdminData {
  seeds: Seed[]
  agentContexts: AgentContext[]
}

type Tab = 'seeds' | 'contexts'
type SortDir = 'asc' | 'desc'

interface SortState<K extends string> {
  key: K
  dir: SortDir
}

function useSort<K extends string>(defaultKey: K, defaultDir: SortDir = 'desc') {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir })

  const toggle = useCallback((key: K) => {
    setSort(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return { key, dir: 'desc' }
    })
  }, [])

  return { sort, toggle }
}

function sortItems<T>(items: T[], key: string, dir: SortDir): T[] {
  return [...items].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]

    let cmp = 0
    if (typeof av === 'string' && typeof bv === 'string') {
      // Try date parsing for ISO strings
      const da = Date.parse(av), db = Date.parse(bv)
      if (!isNaN(da) && !isNaN(db)) {
        cmp = da - db
      } else {
        cmp = av.localeCompare(bv, 'de')
      }
    } else if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else if (typeof av === 'boolean' && typeof bv === 'boolean') {
      cmp = (av ? 1 : 0) - (bv ? 1 : 0)
    }

    return dir === 'asc' ? cmp : -cmp
  })
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="sort-icon inactive">⇅</span>
  return <span className="sort-icon active">{dir === 'asc' ? '↑' : '↓'}</span>
}

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === '0001-01-01T00:00:00Z') return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit',
  })
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const level = value >= 0.7 ? 'high' : value >= 0.3 ? 'medium' : 'low'
  return (
    <div className="confidence-bar-wrapper">
      <div className="confidence-bar">
        <div className={`confidence-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="confidence-value">{pct}%</span>
    </div>
  )
}

function MetadataCell({ data }: { data: Record<string, unknown> | null }) {
  const [expanded, setExpanded] = useState(false)

  if (!data || Object.keys(data).length === 0) {
    return <span className="cell-id">—</span>
  }

  return (
    <div>
      <button className="metadata-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▾ Einklappen' : '▸ JSON anzeigen'}
      </button>
      {expanded && (
        <div className="metadata-content">
          {JSON.stringify(data, null, 2)}
        </div>
      )}
    </div>
  )
}

type SeedSortKey = 'id' | 'title' | 'content' | 'type' | 'confidence' | 'protected' | 'last_accessed' | 'created_at'

const seedColumns: { key: SeedSortKey; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Titel' },
  { key: 'content', label: 'Inhalt' },
  { key: 'type', label: 'Typ' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'protected', label: 'Geschützt' },
  { key: 'last_accessed', label: 'Letzter Zugriff' },
  { key: 'created_at', label: 'Erstellt' },
]

function SeedsTable({ seeds }: { seeds: Seed[] }) {
  const { sort, toggle } = useSort<SeedSortKey>('created_at', 'desc')
  const sorted = useMemo(() => sortItems(seeds, sort.key, sort.dir), [seeds, sort])

  if (seeds.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🌱</div>
        <div>Keine Seeds vorhanden</div>
      </div>
    )
  }

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {seedColumns.map(col => (
              <th key={col.key} className="sortable-th" onClick={() => toggle(col.key)}>
                <span className="th-content">
                  {col.label}
                  <SortIcon active={sort.key === col.key} dir={sort.dir} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => (
            <tr key={s.id}>
              <td className="cell-id" title={s.id}>{s.id.slice(0, 8)}</td>
              <td className="cell-title" title={s.title}>{s.title}</td>
              <td className="cell-content" title={s.content}>{s.content}</td>
              <td><span className="badge badge-type">{s.type}</span></td>
              <td><ConfidenceBar value={s.confidence} /></td>
              <td>
                <span className={`badge ${s.protected ? 'badge-protected' : 'badge-unprotected'}`}>
                  {s.protected ? '🔒 Ja' : 'Nein'}
                </span>
              </td>
              <td className="cell-time">{formatDate(s.last_accessed)}</td>
              <td className="cell-time">{formatDate(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ContextSortKey = 'id' | 'agentId' | 'type' | 'summary' | 'created_at'

const contextColumns: { key: ContextSortKey; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'agentId', label: 'Agent ID' },
  { key: 'type', label: 'Typ' },
  { key: 'summary', label: 'Summary' },
  { key: 'created_at', label: 'Erstellt' },
]

function ContextsTable({ contexts }: { contexts: AgentContext[] }) {
  const { sort, toggle } = useSort<ContextSortKey>('created_at', 'desc')
  const sorted = useMemo(() => sortItems(contexts, sort.key, sort.dir), [contexts, sort])

  if (contexts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🧠</div>
        <div>Keine Agent Contexts vorhanden</div>
      </div>
    )
  }

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {contextColumns.map(col => (
              <th key={col.key} className="sortable-th" onClick={() => toggle(col.key)}>
                <span className="th-content">
                  {col.label}
                  <SortIcon active={sort.key === col.key} dir={sort.dir} />
                </span>
              </th>
            ))}
            <th>Metadata</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(c => (
            <tr key={c.id}>
              <td className="cell-id" title={c.id}>{c.id.slice(0, 8)}</td>
              <td className="cell-title" title={c.agentId}>{c.agentId}</td>
              <td><span className="badge badge-type">{c.type}</span></td>
              <td className="cell-summary" title={c.summary}>{c.summary || '—'}</td>
              <td className="cell-time">{formatDate(c.created_at)}</td>
              <td><MetadataCell data={c.metadata} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('seeds')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/data')
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      const json: AdminData = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <div className="admin-app">
        <div className="loading-state">
          <div className="spinner" />
          <div>Daten werden geladen…</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="admin-app">
        <div className="error-state">
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <div>Fehler beim Laden</div>
          <div className="error-msg">{error}</div>
          <button className="retry-btn" onClick={fetchData}>Erneut versuchen</button>
        </div>
      </div>
    )
  }

  const seeds = data?.seeds ?? []
  const contexts = data?.agentContexts ?? []

  return (
    <div className="admin-app">
      <header className="admin-header">
        <h1>🧠 Neural Brain Admin</h1>
        <div className="stats">
          <div className="stat-item">
            <span>Seeds:</span>
            <span className="stat-value">{seeds.length}</span>
          </div>
          <div className="stat-item">
            <span>Contexts:</span>
            <span className="stat-value">{contexts.length}</span>
          </div>
        </div>
      </header>

      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'seeds' ? 'active' : ''}`}
          onClick={() => setActiveTab('seeds')}
        >
          🌱 Seeds <span className="tab-count">{seeds.length}</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'contexts' ? 'active' : ''}`}
          onClick={() => setActiveTab('contexts')}
        >
          🧠 Agent Contexts <span className="tab-count">{contexts.length}</span>
        </button>
      </div>

      {activeTab === 'seeds' && <SeedsTable seeds={seeds} />}
      {activeTab === 'contexts' && <ContextsTable contexts={contexts} />}
    </div>
  )
}

export default App
