package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestSendLLMMessageInternal_HandlesStoredPartsShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "hello from llm",
					},
				},
			},
		})
	}))
	t.Cleanup(server.Close)

	tmp := t.TempDir()

	s := &Service{
		sessions:     map[string]*Session{},
		dataDir:      tmp,
		sessionsFile: filepath.Join(tmp, "sessions.json"),
		config:       map[string]interface{}{},
		cancelFuncs:  map[string]context.CancelFunc{},
	}

	s.sessions["s1"] = &Session{
		ID: "s1",
		Messages: []map[string]interface{}{
			{
				"info": map[string]interface{}{
					"role": "user",
				},
				"parts": []map[string]interface{}{
					{
						"type": "text",
						"text": "prior message",
					},
				},
			},
		},
	}

	cfg := CustomLLMService{
		ID:           "svc1",
		Name:         "svc1",
		BaseURL:      server.URL,
		AuthType:     "none",
		Enabled:      true,
		DefaultModel: "gpt-test",
		Provider:     "openai",
	}

	msg, err := s.sendLLMMessageInternal(context.Background(), "s1", "hi", cfg, "gpt-test")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	partsAny, ok := msg["parts"]
	if !ok {
		t.Fatalf("expected parts in response")
	}
	parts, ok := partsAny.([]map[string]interface{})
	if !ok || len(parts) == 0 {
		t.Fatalf("expected parts as []map[string]interface{}, got %T", partsAny)
	}
	text, _ := parts[0]["text"].(string)
	if text != "hello from llm" {
		t.Fatalf("unexpected response text: %q", text)
	}
}

func TestCallLLMService_StoresSanitizedRequestHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "ok",
					},
				},
			},
		})
	}))
	t.Cleanup(server.Close)

	s := &Service{}
	cfg := CustomLLMService{
		ID:           "svc1",
		Name:         "svc1",
		BaseURL:      server.URL,
		AuthType:     "bearer",
		APIKey:       "secret-token",
		Enabled:      true,
		DefaultModel: "gpt-test",
		Provider:     "openai",
		Headers: map[string]string{
			"X-Custom": "value",
		},
	}

	_, rawTurns, err := s.callLLMService(context.Background(), "s1", cfg, []map[string]interface{}{
		{"role": "user", "content": "hi"},
	}, "gpt-test", true)
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if len(rawTurns) == 0 {
		t.Fatalf("expected rawTurns to be recorded")
	}

	rh, _ := rawTurns[0]["requestHeaders"].(string)
	if strings.TrimSpace(rh) == "" {
		t.Fatalf("expected requestHeaders to be non-empty")
	}
	if strings.Contains(rh, "secret-token") {
		t.Fatalf("expected secret token to be redacted, got %s", rh)
	}
}
