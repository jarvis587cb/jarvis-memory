package admin

import (
	"context"
	"database/sql"
	"embed"
	"io/fs"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pgvector/pgvector-go"

	"jarvis-memory/internal/db"
)

//go:embed dist/*
var distFS embed.FS

type AdminHandler struct {
	db *db.DB
}

func NewHandler(dbConn *db.DB) *AdminHandler {
	return &AdminHandler{db: dbConn}
}

func (h *AdminHandler) RegisterRoutes(e *echo.Echo) {
	// JSON API for the React frontend
	e.GET("/admin/api/data", h.HandleAdminData)

	// Serve the React SPA from embedded dist/
	distContent, _ := fs.Sub(distFS, "dist")
	fileServer := http.FileServer(http.FS(distContent))

	// Serve static assets (JS, CSS, SVGs)
	e.GET("/assets/*", echo.WrapHandler(fileServer))
	e.GET("/vite.svg", echo.WrapHandler(fileServer))

	// SPA fallback: serve index.html for /admin
	e.GET("/admin", func(c *echo.Context) error {
		indexBytes, err := distFS.ReadFile("dist/index.html")
		if err != nil {
			return c.String(http.StatusInternalServerError, "Admin panel not built")
		}
		return c.HTML(http.StatusOK, string(indexBytes))
	})
}

type AdminData struct {
	Seeds         []db.Seed         `json:"seeds"`
	AgentContexts []db.AgentContext `json:"agentContexts"`
}

func (h *AdminHandler) HandleAdminData(c *echo.Context) error {
	ctx := c.Request().Context()

	seeds, err := h.getLatestSeeds(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load seeds: " + err.Error()})
	}

	contexts, err := h.getLatestAgentContexts(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load agent contexts: " + err.Error()})
	}

	if seeds == nil {
		seeds = []db.Seed{}
	}
	if contexts == nil {
		contexts = []db.AgentContext{}
	}

	return c.JSON(http.StatusOK, AdminData{
		Seeds:         seeds,
		AgentContexts: contexts,
	})
}

func (h *AdminHandler) getLatestSeeds(ctx context.Context) ([]db.Seed, error) {
	query := `SELECT id, content, title, type, confidence, protected, last_accessed, created_at, embedding FROM seeds ORDER BY created_at DESC LIMIT 100`
	rows, err := h.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var seeds []db.Seed
	for rows.Next() {
		var s db.Seed
		var lastAccessed sql.NullTime
		var vec pgvector.Vector
		if err := rows.Scan(&s.ID, &s.Content, &s.Title, &s.Type, &s.Confidence, &s.Protected, &lastAccessed, &s.CreatedAt, &vec); err != nil {
			return nil, err
		}
		s.Embedding = vec.Slice()
		if lastAccessed.Valid {
			s.LastAccessed = lastAccessed.Time
		} else {
			s.LastAccessed = time.Time{}
		}
		seeds = append(seeds, s)
	}
	return seeds, nil
}

func (h *AdminHandler) getLatestAgentContexts(ctx context.Context) ([]db.AgentContext, error) {
	query := `SELECT id, agent_id, type, metadata, summary, created_at, embedding FROM agent_contexts ORDER BY created_at DESC`
	rows, err := h.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []db.AgentContext
	for rows.Next() {
		var ac db.AgentContext
		var meta []byte
		var sum sql.NullString
		var vec pgvector.Vector
		if err := rows.Scan(&ac.ID, &ac.AgentID, &ac.Type, &meta, &sum, &ac.CreatedAt, &vec); err != nil {
			return nil, err
		}
		if meta != nil {
			ac.Metadata = meta
		}
		if sum.Valid {
			ac.Summary = sum.String
		}
		ac.Embedding = vec.Slice()
		results = append(results, ac)
	}
	return results, nil
}
