package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v5"

	"jarvis-memory/internal/db"
	"jarvis-memory/internal/embeddings"
)

type Handler struct {
	db  *db.DB
	emb *embeddings.Service
}

func NewHandler(d *db.DB, e *embeddings.Service) *Handler {
	return &Handler{db: d, emb: e}
}

func (h *Handler) RegisterRoutes(e *echo.Echo) {
	e.GET("/seeds", h.HandleListSeeds)
	e.POST("/seeds", h.HandleCreateSeed)
	e.POST("/seeds/query", h.HandleQuerySeeds)
	e.DELETE("/seeds/:id", h.HandleDeleteSeed)
	e.PUT("/seeds/:id", h.HandleUpdateSeed)
	e.POST("/seeds/:id/confidence", h.HandleSetConfidence)
	e.POST("/seeds/:id/protect", h.HandleSetProtected)
	e.POST("/agent-contexts", h.HandleCreateAgentContext)
	e.GET("/agent-contexts", h.HandleGetAgentContexts)
	e.GET("/agent-contexts/:id", h.HandleGetAgentContext)
}

func (h *Handler) HandleListSeeds(c *echo.Context) error {
	limitStr := c.QueryParam("limit")
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	seeds, err := h.db.ListSeeds(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	for i := range seeds {
		seeds[i].Embedding = nil
	}
	return c.JSON(http.StatusOK, seeds)
}

func (h *Handler) HandleCreateSeed(c *echo.Context) error {
	content := c.FormValue("content")
	title := c.FormValue("title")
	typ := c.FormValue("type")

	if content == "" || title == "" || typ == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "content, title, and type are required"})
	}

	emb, err := h.emb.Embed(content)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to embed content"})
	}

	seed := &db.Seed{
		Content: content,
		Title:   title,
		Type:    typ,
	}

	if err := h.db.InsertSeed(c.Request().Context(), seed, emb); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	seed.Embedding = nil
	return c.JSON(http.StatusCreated, seed)
}

type QuerySeedsRequest struct {
	Query     string  `json:"query"`
	Limit     int     `json:"limit"`
	Threshold float32 `json:"threshold"`
	Since     string  `json:"since"`
	Until     string  `json:"until"`
}

func parseTimeKeyword(keyword string) *time.Time {
	if keyword == "" {
		return nil
	}
	now := time.Now().UTC()
	var t time.Time

	switch keyword {
	case "today":
		t = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case "yesterday":
		t = time.Date(now.Year(), now.Month(), now.Day()-1, 0, 0, 0, 0, time.UTC)
	case "this_week":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		t = time.Date(now.Year(), now.Month(), now.Day()-(weekday-1), 0, 0, 0, 0, time.UTC)
	case "last_week":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		t = time.Date(now.Year(), now.Month(), now.Day()-(weekday-1)-7, 0, 0, 0, 0, time.UTC)
	case "this_month":
		t = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "last_month":
		t = time.Date(now.Year(), now.Month()-1, 1, 0, 0, 0, 0, time.UTC)
	default:
		// Try parsing as ISO 8601
		parsed, err := time.Parse(time.RFC3339, keyword)
		if err != nil {
			// Try date-only format
			parsed, err = time.Parse("2006-01-02", keyword)
			if err != nil {
				return nil
			}
		}
		t = parsed
	}
	return &t
}

func (h *Handler) HandleQuerySeeds(c *echo.Context) error {
	var req QuerySeedsRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid json"})
	}

	if req.Query == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "query is required"})
	}

	emb, err := h.emb.Embed(req.Query)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to embed query"})
	}

	if req.Limit <= 0 {
		req.Limit = 10
	}
	if req.Threshold < 0 {
		req.Threshold = 0.5
	}

	since := parseTimeKeyword(req.Since)
	until := parseTimeKeyword(req.Until)

	results, err := h.db.SearchSeeds(c.Request().Context(), emb, req.Limit, req.Threshold, since, until)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	for i := range results {
		results[i].Embedding = nil
	}

	return c.JSON(http.StatusOK, results)
}

func (h *Handler) HandleDeleteSeed(c *echo.Context) error {
	id := c.Param("id")

	if err := h.db.DeleteSeed(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{"deleted": true})
}

type UpdateSeedRequest struct {
	Content string `json:"content"`
	Title   string `json:"title"`
	Type    string `json:"type"`
}

func (h *Handler) HandleUpdateSeed(c *echo.Context) error {
	id := c.Param("id")

	var req UpdateSeedRequest
	if err := c.Bind(&req); err != nil {
		// Fallback to form values for multipart
		req.Content = c.FormValue("content")
		req.Title = c.FormValue("title")
		req.Type = c.FormValue("type")
	}

	if req.Content == "" || req.Title == "" || req.Type == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "content, title, and type are required"})
	}

	emb, err := h.emb.Embed(req.Content)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to embed content"})
	}

	seed := &db.Seed{
		ID:      id,
		Content: req.Content,
		Title:   req.Title,
		Type:    req.Type,
	}

	if err := h.db.UpdateSeed(c.Request().Context(), seed, emb); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
	}

	seed.Embedding = nil
	return c.JSON(http.StatusOK, seed)
}

type SetConfidenceRequest struct {
	Confidence float32 `json:"confidence"`
}

func (h *Handler) HandleSetConfidence(c *echo.Context) error {
	id := c.Param("id")

	var req SetConfidenceRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid json"})
	}

	if req.Confidence < 0 || req.Confidence > 1 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "confidence must be between 0.0 and 1.0"})
	}

	if err := h.db.SetSeedConfidence(c.Request().Context(), id, req.Confidence); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"id": id, "confidence": req.Confidence})
}

type SetProtectedRequest struct {
	Protected bool `json:"protected"`
}

func (h *Handler) HandleSetProtected(c *echo.Context) error {
	id := c.Param("id")

	var req SetProtectedRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid json"})
	}

	if err := h.db.SetSeedProtected(c.Request().Context(), id, req.Protected); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"id": id, "protected": req.Protected})
}

type CreateAgentContextRequest struct {
	AgentID  string          `json:"agentId"`
	Type     string          `json:"type"`
	Metadata json.RawMessage `json:"metadata"`
	Summary  string          `json:"summary"`
}

func (h *Handler) HandleCreateAgentContext(c *echo.Context) error {
	var req CreateAgentContextRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid json"})
	}

	if req.AgentID == "" || req.Type == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "agentId and type are required"})
	}

	textToEmbed := req.Summary
	if textToEmbed == "" {
		if len(req.Metadata) > 0 {
			textToEmbed = string(req.Metadata)
		} else {
			textToEmbed = req.Type
		}
	}

	emb, err := h.emb.Embed(textToEmbed)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to embed agent context"})
	}

	ac := &db.AgentContext{
		AgentID:  req.AgentID,
		Type:     req.Type,
		Metadata: req.Metadata,
		Summary:  req.Summary,
	}

	if err := h.db.InsertAgentContext(c.Request().Context(), ac, emb); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	ac.Embedding = nil
	return c.JSON(http.StatusCreated, ac)
}

func (h *Handler) HandleGetAgentContexts(c *echo.Context) error {
	agentID := c.QueryParam("agentId")

	results, err := h.db.GetAgentContexts(c.Request().Context(), agentID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	for i := range results {
		results[i].Embedding = nil
	}

	return c.JSON(http.StatusOK, results)
}

func (h *Handler) HandleGetAgentContext(c *echo.Context) error {
	id := c.Param("id")

	ac, err := h.db.GetAgentContextByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	if ac == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "agent context not found"})
	}

	ac.Embedding = nil
	return c.JSON(http.StatusOK, ac)
}
