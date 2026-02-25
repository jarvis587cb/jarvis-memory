package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/pgvector/pgvector-go"
)

type Seed struct {
	ID           string    `json:"id"`
	Content      string    `json:"content"`
	Title        string    `json:"title"`
	Type         string    `json:"type"`
	Confidence   float32   `json:"confidence"`
	Protected    bool      `json:"protected"`
	LastAccessed time.Time `json:"last_accessed"`
	CreatedAt    time.Time `json:"created_at"`
	Embedding    []float32 `json:"embedding,omitempty"`
}

func (db *DB) ListSeeds(ctx context.Context, limit int) ([]Seed, error) {
	query := `SELECT id, content, title, type, confidence, protected, last_accessed, created_at FROM seeds ORDER BY created_at DESC LIMIT $1`
	rows, err := db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list seeds: %w", err)
	}
	defer rows.Close()

	var seeds []Seed
	for rows.Next() {
		var s Seed
		if err := rows.Scan(&s.ID, &s.Content, &s.Title, &s.Type, &s.Confidence, &s.Protected, &s.LastAccessed, &s.CreatedAt); err != nil {
			return nil, err
		}
		seeds = append(seeds, s)
	}
	return seeds, nil
}

func (db *DB) InsertSeed(ctx context.Context, s *Seed, embedding []float32) error {
	query := `
		INSERT INTO seeds (content, title, type, embedding, confidence)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at, last_accessed
	`
	vec := pgvector.NewVector(embedding)
	if s.Confidence <= 0 {
		s.Confidence = 1.0
	}
	err := db.QueryRowContext(ctx, query, s.Content, s.Title, s.Type, vec, s.Confidence).Scan(&s.ID, &s.CreatedAt, &s.LastAccessed)
	if err != nil {
		return fmt.Errorf("failed to insert seed: %w", err)
	}
	return nil
}

func (db *DB) DeleteSeed(ctx context.Context, id string) error {
	// Check if seed is protected
	var protected bool
	err := db.QueryRowContext(ctx, `SELECT protected FROM seeds WHERE id = $1`, id).Scan(&protected)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("seed not found")
		}
		return fmt.Errorf("failed to check seed: %w", err)
	}
	if protected {
		return fmt.Errorf("seed is protected and cannot be deleted")
	}

	query := `DELETE FROM seeds WHERE id = $1`
	_, err = db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete seed: %w", err)
	}
	return nil
}

func (db *DB) UpdateSeed(ctx context.Context, s *Seed, embedding []float32) error {
	query := `
		UPDATE seeds
		SET content = $1, title = $2, type = $3, embedding = $4
		WHERE id = $5
		RETURNING created_at, confidence, last_accessed
	`
	vec := pgvector.NewVector(embedding)
	err := db.QueryRowContext(ctx, query, s.Content, s.Title, s.Type, vec, s.ID).Scan(&s.CreatedAt, &s.Confidence, &s.LastAccessed)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("seed not found")
		}
		return fmt.Errorf("failed to update seed: %w", err)
	}
	return nil
}

func (db *DB) SetSeedConfidence(ctx context.Context, id string, confidence float32) error {
	query := `UPDATE seeds SET confidence = $1 WHERE id = $2`
	result, err := db.ExecContext(ctx, query, confidence, id)
	if err != nil {
		return fmt.Errorf("failed to set confidence: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("seed not found")
	}
	return nil
}

func (db *DB) SetSeedProtected(ctx context.Context, id string, protected bool) error {
	query := `UPDATE seeds SET protected = $1 WHERE id = $2`
	result, err := db.ExecContext(ctx, query, protected, id)
	if err != nil {
		return fmt.Errorf("failed to set protected: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("seed not found")
	}
	return nil
}

type SeedSearchResult struct {
	Seed
	Similarity float32 `json:"similarity"`
}

func (db *DB) SearchSeeds(ctx context.Context, embedding []float32, limit int, threshold float32, since *time.Time, until *time.Time) ([]SeedSearchResult, error) {
	if limit <= 0 {
		limit = 10
	}

	// Build dynamic WHERE clause for time filtering
	timeFilter := ""
	args := []interface{}{pgvector.NewVector(embedding), threshold, limit}
	paramIdx := 4

	if since != nil {
		timeFilter += fmt.Sprintf(" AND created_at >= $%d", paramIdx)
		args = append(args, *since)
		paramIdx++
	}
	if until != nil {
		timeFilter += fmt.Sprintf(" AND created_at <= $%d", paramIdx)
		args = append(args, *until)
		paramIdx++
	}

	// Weighted similarity: raw cosine similarity multiplied by confidence.
	// This ensures low-confidence (decayed) seeds rank lower even if semantically close.
	// We also update last_accessed for returned seeds.
	query := fmt.Sprintf(`
		WITH matched AS (
			SELECT id, content, title, type, confidence, last_accessed, created_at,
			       (1 - (embedding <=> $1)) * confidence AS similarity
			FROM seeds
			WHERE (1 - (embedding <=> $1)) * confidence >= $2%s
			ORDER BY embedding <-> $1
			LIMIT $3
		)
		UPDATE seeds s
		SET last_accessed = NOW()
		FROM matched m
		WHERE s.id = m.id
		RETURNING m.id, m.content, m.title, m.type, m.confidence, m.last_accessed, m.created_at, m.similarity
	`, timeFilter)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query seeds: %w", err)
	}
	defer rows.Close()

	var results []SeedSearchResult
	for rows.Next() {
		var res SeedSearchResult
		if err := rows.Scan(&res.ID, &res.Content, &res.Title, &res.Type, &res.Confidence, &res.LastAccessed, &res.CreatedAt, &res.Similarity); err != nil {
			return nil, err
		}
		results = append(results, res)
	}
	return results, nil
}

type AgentContext struct {
	ID        string          `json:"id"`
	AgentID   string          `json:"agentId"`
	Type      string          `json:"type"`
	Metadata  json.RawMessage `json:"metadata"`
	Summary   string          `json:"summary"`
	CreatedAt time.Time       `json:"created_at"`
	Embedding []float32       `json:"embedding,omitempty"`
}

func (db *DB) InsertAgentContext(ctx context.Context, ac *AgentContext, embedding []float32) error {
	query := `
		INSERT INTO agent_contexts (agent_id, type, metadata, summary, embedding)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`
	vec := pgvector.NewVector(embedding)

	var meta interface{} = ac.Metadata
	if len(ac.Metadata) == 0 {
		meta = nil
	}

	err := db.QueryRowContext(ctx, query, ac.AgentID, ac.Type, meta, ac.Summary, vec).Scan(&ac.ID, &ac.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert agent context: %w", err)
	}
	return nil
}

func (db *DB) GetAgentContexts(ctx context.Context, agentID string) ([]AgentContext, error) {
	query := `SELECT id, agent_id, type, metadata, summary, created_at FROM agent_contexts`
	var args []interface{}

	if agentID != "" {
		query += ` WHERE agent_id = $1`
		args = append(args, agentID)
	}

	query += ` ORDER BY created_at DESC`

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []AgentContext
	for rows.Next() {
		var ac AgentContext
		var meta []byte
		var sum sql.NullString
		if err := rows.Scan(&ac.ID, &ac.AgentID, &ac.Type, &meta, &sum, &ac.CreatedAt); err != nil {
			return nil, err
		}
		if meta != nil {
			ac.Metadata = meta
		}
		if sum.Valid {
			ac.Summary = sum.String
		}
		results = append(results, ac)
	}
	return results, nil
}

func (db *DB) GetAgentContextByID(ctx context.Context, id string) (*AgentContext, error) {
	query := `SELECT id, agent_id, type, metadata, summary, created_at FROM agent_contexts WHERE id = $1`
	var ac AgentContext
	var meta []byte
	var sum sql.NullString
	err := db.QueryRowContext(ctx, query, id).Scan(&ac.ID, &ac.AgentID, &ac.Type, &meta, &sum, &ac.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if meta != nil {
		ac.Metadata = meta
	}
	if sum.Valid {
		ac.Summary = sum.String
	}
	return &ac, nil
}
