# 🧠 Jarvis Memory

> Persistent, local AI agent memory with semantic search, confidence scoring, and memory decay.

A lightweight, purely Go-based long-term memory system for AI agents. Uses a local Postgres instance with `pgvector` for HNSW vector search and generates sentence embeddings locally via [`gte-go`](https://github.com/rcarmo/gte-go) (GTE-Small, 384 dimensions).

**100% local & private** — no API keys, no external services, no blockchain.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Semantic Search** | Find memories by meaning via cosine similarity (pgvector HNSW index) |
| 🎯 **Confidence Scoring** | Each seed has a confidence value (0.0–1.0) that weights search results |
| 📉 **Memory Decay** | Old, low-confidence seeds automatically lose relevance on each restart |
| 🔄 **Auto-Recall** | Automatically queries relevant memories before each AI turn (OpenClaw hook) |
| 💾 **Auto-Capture** | Automatically saves conversations after each AI turn (OpenClaw hook) |
| ✏️ **Full CRUD** | Create, Read, Update, Delete seeds via REST API |
| 🖥️ **Admin Panel** | React dashboard with Seeds & Agent Contexts tables, manual sorting, and confidence indicators |
| 🐳 **Dockerized** | One-command setup with Docker Compose (Go app + Postgres/pgvector) |
| 🔒 **100% Local** | No API keys, no external services, complete privacy |

---

## 📋 Prerequisites

- 🐳 **Docker** & **Docker Compose**
- 🐍 **Python 3.8+** (for one-time model download & conversion)
- 🔧 **Go 1.25+** (optional, only if building outside Docker)

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/cabroe/jarvis-memory.git
cd jarvis-memory

# Download embedding model + start containers
make all

# Or step by step:
# make setup   → downloads & converts GTE-Small model
# make run     → starts Docker Compose (app + db)
```

The API is now running at **http://localhost:8080** 🎉

---

## 🧪 Testing

```bash
# Quick connection test
make test

# Or manually
./scripts/jarvis-memory.sh test
```

Open the Admin Dashboard: **http://localhost:8080/admin**

---

## 📡 API Endpoints

**Base URL:** `http://localhost:8080`
**Auth:** None required 🔓

### 🌱 Seeds (Memory Storage)

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `POST` | `/seeds` | 💾 Create a new seed | `multipart/form-data`: `content`, `title`, `type` |
| `POST` | `/seeds/query` | 🔍 Semantic search | JSON: `{"query": "...", "limit": 10, "threshold": 0.5}` |
| `PUT` | `/seeds/:id` | ✏️ Update seed (re-embeds) | JSON: `{"content": "...", "title": "...", "type": "..."}` |
| `DELETE` | `/seeds/:id` | 🗑️ Delete a seed | — |
| `POST` | `/seeds/:id/confidence` | ⚖️ Set confidence | JSON: `{"confidence": 0.75}` |

### 🤖 Agent Contexts

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `POST` | `/agent-contexts` | 📝 Create agent context | JSON: `{"agentId": "...", "type": "...", "metadata": {...}, "summary": "..."}` |
| `GET` | `/agent-contexts` | 📋 List all (optional `?agentId=` filter) | — |
| `GET` | `/agent-contexts/:id` | 🔎 Get specific context by ID | — |

### 🖥️ Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin` | 📊 Admin dashboard (SPA) for monitoring Seeds and Agent Contexts |
| `GET` | `/admin/api/data` | 📡 JSON data source for the admin dashboard |

---

## 💡 Usage Examples

### 💾 Save a Memory
```bash
./scripts/jarvis-memory.sh save "The capital of France is Paris." "France Facts" "semantic"
```

### 🔍 Semantic Search
```bash
./scripts/jarvis-memory.sh search "What is the capital of France?" 5 0.5
```

### ✏️ Update a Seed
```bash
curl -X PUT http://localhost:8080/seeds/<UUID> \
  -H "Content-Type: application/json" \
  -d '{"content":"Updated content","title":"New Title","type":"semantic"}'
```

### 🗑️ Delete a Seed
```bash
curl -X DELETE http://localhost:8080/seeds/<UUID>
# → {"deleted": true}
```

### ⚖️ Set Confidence
```bash
curl -X POST http://localhost:8080/seeds/<UUID>/confidence \
  -H "Content-Type: application/json" \
  -d '{"confidence": 0.3}'
```

### 🤖 Create Agent Context
```bash
./scripts/jarvis-memory.sh context-create "jarvis" "episodic" '{"mood":"curious"}' "First boot"
```

### 📋 List Agent Contexts
```bash
./scripts/jarvis-memory.sh context-list "jarvis"
```

---

## 🎯 Confidence & Decay System

### How It Works

Each seed has a **confidence** value (default: `1.0`). This value is used as a **weight multiplier** during search:

```
weighted_similarity = cosine_similarity(query, seed) × confidence
```

Seeds with low confidence rank lower in results, even if semantically similar.

### 📉 Automatic Decay

On every server startup, the system runs a decay pass:

- **Target:** Seeds older than **90 days** with confidence **< 0.3**
- **Effect:** Confidence is reduced by **10%** (multiplied by 0.9)
- **Floor:** Confidence never drops below **0.01** (seeds are never fully erased automatically)

### 📊 Last Accessed Tracking

Every time a seed appears in search results, its `last_accessed` timestamp is updated. This enables future decay strategies based on usage frequency.

---

## 🔄 OpenClaw Hooks

The skill includes hooks for automatic memory management:

| Hook | File | Purpose |
|------|------|---------|
| 🔍 **Auto-Recall** | `hooks/pre-tool-use.sh` | Queries memories before AI turn, injects relevant context |
| 💾 **Auto-Capture** | `hooks/post-tool-use.sh` | Saves conversation after AI turn |

### ⚙️ Configuration

Both features are **enabled by default**. To disable:

```bash
export JARVIS_AUTO_RECALL=false   # 🔇 Disable auto-recall
export JARVIS_AUTO_CAPTURE=false  # 🔇 Disable auto-capture
```

### 📦 Install as OpenClaw Skill

```bash
make skill
# → Copies SKILL.md, scripts/, hooks/ to ~/.openclaw/workspace/skills/jarvis-memory/
```

---

## 🗄️ Database Schema

### `seeds` Table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `content` | `TEXT` | — | Memory content |
| `title` | `TEXT` | — | Short title |
| `type` | `VARCHAR(50)` | — | Memory type |
| `embedding` | `vector(384)` | — | GTE-Small embedding |
| `confidence` | `REAL` | `1.0` | Decay weight (0.0–1.0) |
| `last_accessed` | `TIMESTAMPTZ` | `CURRENT_TIMESTAMP` | Last search hit |
| `created_at` | `TIMESTAMPTZ` | `CURRENT_TIMESTAMP` | Creation time |

### `agent_contexts` Table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `agent_id` | `VARCHAR(255)` | — | Agent identifier |
| `type` | `VARCHAR(50)` | — | Context type |
| `metadata` | `JSONB` | — | Structured metadata |
| `summary` | `TEXT` | — | Human-readable summary |
| `embedding` | `vector(384)` | — | GTE-Small embedding |
| `created_at` | `TIMESTAMPTZ` | `CURRENT_TIMESTAMP` | Creation time |

### 📇 Indexes

- `seeds_embedding_idx` — HNSW index with `vector_l2_ops` on `seeds.embedding`
- `agent_contexts_embedding_idx` — HNSW index with `vector_l2_ops` on `agent_contexts.embedding`

---

## 📁 Memory Types

| Type | Emoji | Description |
|------|-------|-------------|
| `episodic` | 📖 | Specific events or experiences |
| `semantic` | 🧠 | Facts, knowledge, general truths |
| `procedural` | ⚙️ | How-to knowledge, skills, procedures |
| `working` | 💭 | Temporary, in-progress thoughts |

### 📝 Seed Content Types

`text`, `markdown`, `json`, `csv`, `claude_chat`, `gpt_chat`, `email`, `auto_capture`

---

## 🏗️ Architecture

```
jarvis-memory/
├── 📄 cmd/jarvis-memory/main.go    # 🚀 Entry point (Echo v5 server)
├── 📂 internal/
│   ├── 📂 api/
│   │   └── handlers.go             # 📡 REST API handlers (CRUD + search)
│   ├── 📂 db/
│   │   ├── db.go                   # 🗄️ Connection, migrations, decay
│   │   └── store.go                # 💾 Data access layer (CRUD + search)
│   ├── 📂 admin/
│   │   ├── admin.go                # 🖥️ Admin panel handler & JSON API
│   │   ├── dist/                   # 📦 Built React frontend (embedded)
│   │   └── src/                    # ⚛️ React source code (TypeScript + Vite)
│   └── 📂 embeddings/
│       └── embeddings.go           # 🧮 GTE-Small embedding service
├── 📂 hooks/
│   ├── pre-tool-use.sh             # 🔍 Auto-Recall hook
│   └── post-tool-use.sh            # 💾 Auto-Capture hook
├── 📂 scripts/
│   └── jarvis-memory.sh            # 🛠️ CLI tool
├── 📂 models/                      # 🤖 GTE-Small model files (git-ignored)
├── 🐳 Dockerfile                   # Multi-stage Go build
├── 🐳 docker-compose.yml           # App + Postgres/pgvector
├── 📄 Makefile                     # Build automation
├── 📄 SKILL.md                     # OpenClaw skill definition
└── 📄 go.mod                       # Go module (jarvis-memory)
```

---

## 🐳 Docker Configuration

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `app` | `jarvis-memory-app` (built from Dockerfile) | `8080` | Go API server |
| `db` | `ankane/pgvector:v0.5.1` | `5432` | Postgres with pgvector extension |

### 🔐 Database Credentials

| Variable | Value |
|----------|-------|
| `POSTGRES_USER` | `jarvis` |
| `POSTGRES_PASSWORD` | `memorypass` |
| `POSTGRES_DB` | `jarvis_memory` |

### 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_URL` | `postgres://jarvis:memorypass@localhost:5432/jarvis_memory?sslmode=disable` | Database connection string |
| `GTE_MODEL_PATH` | `models/gte-small.gtemodel` | Path to embedding model |
| `PORT` | `8080` | API server port |
| `JARVIS_AUTO_RECALL` | `true` | Enable/disable auto-recall hook |
| `JARVIS_AUTO_CAPTURE` | `true` | Enable/disable auto-capture hook |

---

## 🛠️ Makefile Commands

| Command | Description |
|---------|-------------|
| `make all` | 📦 Setup model + start containers |
| `make setup` | 🤖 Download & convert GTE-Small model |
| `make run` | 🚀 Start Docker Compose (build + up) |
| `make stop` | ⏹️ Stop Docker Compose |
| `make logs` | 📜 Tail container logs |
| `make test` | 🧪 Test API connection |
| `make clean` | 🧹 Remove venv & temp files |
| `make skill` | 📦 Install as OpenClaw skill |

---

## 📚 Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| 🔧 Language | Go | 1.25+ |
| 🌐 Web Framework | [Echo v5](https://github.com/labstack/echo) | v5.0.4 |
| 🗄️ Database | PostgreSQL + [pgvector](https://github.com/pgvector/pgvector) | v0.5.1 |
| 🧮 Embeddings | [gte-go](https://github.com/rcarmo/gte-go) (GTE-Small) | 384 dims |
| 🐳 Container | Docker + Docker Compose | — |
| 🔌 DB Driver | [lib/pq](https://github.com/lib/pq) | v1.11.2 |
| 📐 Vector Ops | [pgvector-go](https://github.com/pgvector/pgvector-go) | v0.3.0 |

---

## 📜 License

This is a local recreation of the [Vanar Neutron Memory](https://clawhub.ai/naeemmaliki036/vanar-neutron-memory) skill, designed for complete privacy and local-only operation. Built with ❤️ by Carsten.
