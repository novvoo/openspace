package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// TodoItem represents a task
type TodoItem struct {
	ID       string `json:"id"`
	Content  string `json:"content"`
	Status   string `json:"status"`   // pending, in_progress, completed
	Priority string `json:"priority"` // low, medium, high
}

// Session represents a chat session
type Session struct {
	ID        string                   `json:"id"`
	Title     string                   `json:"title"`
	Summary   string                   `json:"summary,omitempty"` // AI generated summary
	CreatedAt int64                    `json:"createdAt"`
	UpdatedAt int64                    `json:"updatedAt"`
	Messages  []map[string]interface{} `json:"messages"`
	ParentID  string                   `json:"parentId,omitempty"`
	Todos     []TodoItem               `json:"todos,omitempty"` // Session-specific todos
}

// Service provides business logic for OpenSpace
type Service struct {
	sessions     map[string]*Session
	sessionMux   sync.RWMutex
	dataDir      string
	configFile   string
	sessionsFile string
	configMux    sync.RWMutex
	config       map[string]interface{}

	// Cancellation support
	cancelFuncs    map[string]context.CancelFunc
	cancelFuncsMux sync.Mutex
}

func splitProviderModel(model string) (string, string) {
	if strings.Contains(model, "::") {
		parts := strings.SplitN(model, "::", 2)
		if len(parts) == 2 && strings.TrimSpace(parts[0]) != "" && strings.TrimSpace(parts[1]) != "" {
			return parts[0], parts[1]
		}
	}
	if strings.Contains(model, ":") {
		parts := strings.SplitN(model, ":", 2)
		if len(parts) == 2 && strings.TrimSpace(parts[0]) != "" && strings.TrimSpace(parts[1]) != "" {
			return parts[0], parts[1]
		}
	}
	return "", model
}

type CommandRunResult struct {
	Output   string
	Cwd      string
	Shell    string
	Branch   string
	ExitCode int
}

// NewService creates a new service instance
func NewService() *Service {
	home, _ := os.UserHomeDir()
	dataDir := filepath.Join(home, ".openspace", "data")
	configFile := filepath.Join(home, ".openspace", "config.json")
	sessionsFile := filepath.Join(dataDir, "sessions.json")

	// Create data directory if it doesn't exist
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		fmt.Printf("Warning: Failed to create data directory: %v\n", err)
	}

	service := &Service{
		sessions:     make(map[string]*Session),
		dataDir:      dataDir,
		configFile:   configFile,
		sessionsFile: sessionsFile,
		config:       make(map[string]interface{}),
		cancelFuncs:  make(map[string]context.CancelFunc),
	}

	// Load persisted data
	service.loadSessions()
	service.loadConfig()

	return service
}

// loadSessions loads sessions from file
func (s *Service) loadSessions() {
	s.sessionMux.Lock()
	defer s.sessionMux.Unlock()

	if _, err := os.Stat(s.sessionsFile); err != nil {
		return // File doesn't exist, start with empty sessions
	}

	data, err := os.ReadFile(s.sessionsFile)
	if err != nil {
		fmt.Printf("Warning: Failed to load sessions: %v\n", err)
		return
	}

	var sessionsData map[string]*Session
	if err := json.Unmarshal(data, &sessionsData); err != nil {
		fmt.Printf("Warning: Failed to parse sessions file: %v\n", err)
		return
	}

	s.sessions = sessionsData
}

// saveSessions saves sessions to file
func (s *Service) saveSessions() error {
	s.sessionMux.RLock()
	defer s.sessionMux.RUnlock()
	return s.saveSessionsLocked()
}

func (s *Service) saveSessionsLocked() error {
	data, err := json.MarshalIndent(s.sessions, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal sessions: %w", err)
	}

	if err := os.WriteFile(s.sessionsFile, data, 0644); err != nil {
		return fmt.Errorf("failed to save sessions: %w", err)
	}

	return nil
}

// loadConfig loads configuration from file
func (s *Service) loadConfig() {
	if _, err := os.Stat(s.configFile); err != nil {
		// Create default config
		s.config = map[string]interface{}{
			"providers": map[string]interface{}{
				"openspace": map[string]interface{}{
					"apiKey": "public",
				},
			},
		}
		return
	}

	data, err := os.ReadFile(s.configFile)
	if err != nil {
		fmt.Printf("Warning: Failed to load config: %v\n", err)
		return
	}

	if err := json.Unmarshal(data, &s.config); err != nil {
		fmt.Printf("Warning: Failed to parse config file: %v\n", err)
	}
}

// saveConfig saves configuration to file
func (s *Service) saveConfig(config map[string]interface{}) error {
	s.configMux.Lock()
	defer s.configMux.Unlock()

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(s.configFile, data, 0644); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

// GetSessions returns all sessions
func (s *Service) GetSessions() ([]*Session, error) {
	s.sessionMux.RLock()
	defer s.sessionMux.RUnlock()

	sessions := make([]*Session, 0, len(s.sessions))
	for _, session := range s.sessions {
		sessions = append(sessions, session)
	}

	// Sort by updated time (most recent first)
	for i := 0; i < len(sessions)-1; i++ {
		for j := i + 1; j < len(sessions); j++ {
			if sessions[i].UpdatedAt < sessions[j].UpdatedAt {
				sessions[i], sessions[j] = sessions[j], sessions[i]
			}
		}
	}

	return sessions, nil
}

// CreateSession creates a new session
func (s *Service) CreateSession(title string, parentID string) (*Session, error) {
	now := time.Now().UnixMilli()
	sessionID := fmt.Sprintf("session_%d", now)
	if title == "" {
		title = "New Session"
	}

	session := &Session{
		ID:        sessionID,
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
		Messages:  []map[string]interface{}{},
	}

	if parentID != "" {
		session.ParentID = parentID
	}

	s.sessionMux.Lock()
	s.sessions[sessionID] = session
	s.sessionMux.Unlock()

	// Save sessions after creating
	if err := s.saveSessions(); err != nil {
		fmt.Printf("Warning: Failed to save session: %v\n", err)
	}

	return session, nil
}

// GetSession returns a session by ID
func (s *Service) GetSession(sessionID string) (*Session, error) {
	s.sessionMux.RLock()
	defer s.sessionMux.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	return session, nil
}

// UpdateSession updates a session
func (s *Service) UpdateSession(sessionID string, title string) (*Session, error) {
	s.sessionMux.Lock()
	defer s.sessionMux.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	if title != "" {
		session.Title = title
		session.UpdatedAt = time.Now().UnixMilli()
	}

	// Save after update
	if err := s.saveSessionsLocked(); err != nil {
		fmt.Printf("Warning: Failed to save session: %v\n", err)
	}

	return session, nil
}

// DeleteSession deletes a session
func (s *Service) DeleteSession(sessionID string) error {
	s.sessionMux.Lock()
	_, exists := s.sessions[sessionID]
	if !exists {
		s.sessionMux.Unlock()
		return fmt.Errorf("session not found: %s", sessionID)
	}

	delete(s.sessions, sessionID)
	s.sessionMux.Unlock()

	// Save after deletion
	if err := s.saveSessions(); err != nil {
		fmt.Printf("Warning: Failed to save session: %v\n", err)
	}

	return nil
}

// GetSessionMessages returns messages for a session
func (s *Service) GetSessionMessages(sessionID string, limit int) ([]map[string]interface{}, error) {
	s.sessionMux.RLock()
	defer s.sessionMux.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	messages := session.Messages
	if limit > 0 && len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}

	return messages, nil
}

// CancelSession cancels any running operation for the session
func (s *Service) CancelSession(sessionID string) {
	s.cancelFuncsMux.Lock()
	defer s.cancelFuncsMux.Unlock()

	if cancel, exists := s.cancelFuncs[sessionID]; exists {
		cancel()
		delete(s.cancelFuncs, sessionID)
		fmt.Printf("Session %s cancelled\n", sessionID)
	}
}

// SendMessage sends a message to a session
func (s *Service) SendMessage(sessionID string, message string, model string, agent string) (map[string]interface{}, error) {
	// Create cancellation context
	ctx, cancel := context.WithCancel(context.Background())

	s.cancelFuncsMux.Lock()
	// Cancel previous if exists
	if prevCancel, exists := s.cancelFuncs[sessionID]; exists {
		prevCancel()
	}
	s.cancelFuncs[sessionID] = cancel
	s.cancelFuncsMux.Unlock()

	// Ensure cleanup
	defer func() {
		s.cancelFuncsMux.Lock()
		if currentCancel, exists := s.cancelFuncs[sessionID]; exists {
			// Only delete if it's still our cancel func (hasn't been replaced)
			// Comparing function pointers in Go isn't direct, but we can check existence
			// In a simple single-threaded per session model, just deleting is fine.
			// Or we could store a unique ID. For now, just delete.
			delete(s.cancelFuncs, sessionID)
			currentCancel() // Call it just in case
		}
		s.cancelFuncsMux.Unlock()
	}()

	providerID, modelID := splitProviderModel(model)
	if modelID != "" && modelID != model {
		model = modelID
	}

	// Check if this model belongs to a custom service
	if customServicesConfig, exists := s.config["customServices"]; exists {
		if customServices, ok := customServicesConfig.([]interface{}); ok {
			for _, svc := range customServices {
				if svcMap, ok := svc.(map[string]interface{}); ok {
					// Check if service is enabled
					if enabled, ok := svcMap["enabled"].(bool); ok && !enabled {
						continue
					}

					serviceID, _ := svcMap["id"].(string)
					if providerID != "" && serviceID != providerID {
						continue
					}

					// Check if model exists in this service
					if modelsList, ok := svcMap["models"].([]interface{}); ok {
						for _, m := range modelsList {
							if modelStr, ok := m.(string); ok && modelStr == model {
								// Found the service for this model
								return s.SendCustomLLMMessageWithModel(ctx, sessionID, message, serviceID, model)
							}
						}
					}

					if providerID != "" {
						if defaultModel, ok := svcMap["defaultModel"].(string); ok && defaultModel == model {
							return s.SendCustomLLMMessageWithModel(ctx, sessionID, message, serviceID, model)
						}
					}
				}
			}
		}
	}

	// Check "providers" config (Legacy/Standard)
	if providersConfig, exists := s.config["providers"]; exists {
		if providersMap, ok := providersConfig.(map[string]interface{}); ok {
			if providerID != "" {
				if pConfig, exists := providersMap[providerID]; exists {
					if pData, ok := pConfig.(map[string]interface{}); ok {
						providerModel, _ := pData["model"].(string)
						if providerModel == model {
							baseURL, _ := pData["base_url"].(string)
							if baseURL == "" {
								if strings.Contains(strings.ToLower(providerID), "openai") {
									baseURL = "https://api.openai.com/v1/chat/completions"
								} else if strings.Contains(strings.ToLower(providerID), "anthropic") {
									baseURL = "https://api.anthropic.com/v1/messages"
								}
							}

							apiKey, _ := pData["api_key"].(string)
							name, _ := pData["name"].(string)
							if name == "" {
								name = providerID
							}

							customService := CustomLLMService{
								ID:           providerID,
								Name:         name,
								BaseURL:      baseURL,
								APIKey:       apiKey,
								DefaultModel: providerModel,
								AuthType:     "bearer",
								Enabled:      true,
							}

							return s.sendLLMMessageInternal(ctx, sessionID, message, customService, model)
						}
					}
				}
			} else {
				for id, pConfig := range providersMap {
					if pData, ok := pConfig.(map[string]interface{}); ok {
						providerModel, _ := pData["model"].(string)
						if providerModel == model {
							baseURL, _ := pData["base_url"].(string)
							if baseURL == "" {
								if strings.Contains(strings.ToLower(id), "openai") {
									baseURL = "https://api.openai.com/v1/chat/completions"
								} else if strings.Contains(strings.ToLower(id), "anthropic") {
									baseURL = "https://api.anthropic.com/v1/messages"
								}
							}

							apiKey, _ := pData["api_key"].(string)
							name, _ := pData["name"].(string)
							if name == "" {
								name = id
							}

							customService := CustomLLMService{
								ID:           id,
								Name:         name,
								BaseURL:      baseURL,
								APIKey:       apiKey,
								DefaultModel: providerModel,
								AuthType:     "bearer",
								Enabled:      true,
							}

							return s.sendLLMMessageInternal(ctx, sessionID, message, customService, model)
						}
					}
				}
			}
		}
	}

	s.sessionMux.Lock()
	defer s.sessionMux.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	now := time.Now().UnixMilli()
	messageID := fmt.Sprintf("msg_%d", now)

	rawTurns := []map[string]interface{}{}

	rawRequestPayload := map[string]interface{}{
		"provider": "openspace",
		"model":    model,
		"messages": []map[string]interface{}{
			{
				"role":    "user",
				"content": message,
			},
		},
	}
	rawRequestJSON, _ := json.MarshalIndent(rawRequestPayload, "", "  ")

	// Add user message
	userMsg := map[string]interface{}{
		"info": map[string]interface{}{
			"role":      "user",
			"createdAt": now,
			"id":        messageID,
			"rawRequest": func() string {
				if len(rawRequestJSON) == 0 {
					return ""
				}
				return string(rawRequestJSON)
			}(),
			"rawTurns": rawTurns,
		},
		"parts": []map[string]interface{}{
			{
				"type": "text",
				"text": message,
			},
		},
	}
	session.Messages = append(session.Messages, userMsg)

	// Generate a simple response (mock AI response)
	responseText := fmt.Sprintf("I received your message: %s\n\nThis is a mock response from the default provider. To use a real AI, please configure a custom provider in Settings.", message)
	if model == "" {
		model = "mock-model"
	}

	rawResponsePayload := map[string]interface{}{
		"provider": "openspace",
		"model":    model,
		"content":  responseText,
	}
	rawResponseJSON, _ := json.MarshalIndent(rawResponsePayload, "", "  ")
	rawTurns = append(rawTurns, map[string]interface{}{
		"provider":  "openspace",
		"model":     model,
		"status":    "mock",
		"request":   string(rawRequestJSON),
		"response":  string(rawResponseJSON),
		"exitCode":  0,
		"timestamp": now,
	})

	if info, ok := userMsg["info"].(map[string]interface{}); ok {
		info["rawTurns"] = rawTurns
	}

	assistantMsg := map[string]interface{}{
		"info": map[string]interface{}{
			"role":      "assistant",
			"createdAt": now + 100,
			"id":        fmt.Sprintf("msg_%d", now+100),
			"model":     model,
			"rawResponse": func() string {
				if len(rawResponseJSON) == 0 {
					return ""
				}
				return string(rawResponseJSON)
			}(),
			"rawTurns": rawTurns,
		},
		"parts": []map[string]interface{}{
			{
				"type":       "text",
				"text":       responseText,
				"tokenCount": 0,
			},
		},
	}
	session.Messages = append(session.Messages, assistantMsg)
	session.UpdatedAt = now + 100

	// Save after sending message
	if err := s.saveSessionsLocked(); err != nil {
		fmt.Printf("Warning: Failed to save session: %v\n", err)
	}

	return assistantMsg, nil
}

// SendMessageAsync sends a message asynchronously
func (s *Service) SendMessageAsync(sessionID string, message string, model string, agent string) (string, error) {
	// Use goroutine for async processing
	go func() {
		_, err := s.SendMessage(sessionID, message, model, agent)
		if err != nil {
			fmt.Printf("Error in async message processing: %v\n", err)
		}
	}()

	// Return immediately with a processing ID
	return fmt.Sprintf("processing_%d", time.Now().UnixMilli()), nil
}

// GetSessionStatus returns status for all sessions
func (s *Service) GetSessionStatus() (map[string]interface{}, error) {
	s.sessionMux.RLock()
	defer s.sessionMux.RUnlock()

	status := make(map[string]interface{})
	for id := range s.sessions {
		status[id] = map[string]interface{}{
			"state": "idle",
		}
	}

	return status, nil
}

// GetProviders returns providers configuration
func (s *Service) GetProviders() (map[string]interface{}, error) {
	providers := []map[string]interface{}{}
	defaultMap := map[string]interface{}{}

	// 1. Process "providers" (legacy/standard config)
	if providersConfig, exists := s.config["providers"]; exists {
		if providersMap, ok := providersConfig.(map[string]interface{}); ok {
			for providerID, providerConfig := range providersMap {
				if providerData, ok := providerConfig.(map[string]interface{}); ok {
					// Extract models from provider config
					models := map[string]interface{}{}

					if modelID, exists := providerData["model"]; exists {
						if modelStr, ok := modelID.(string); ok && modelStr != "" {
							models[modelStr] = map[string]interface{}{
								"id":   modelStr,
								"name": modelStr,
							}
							// Set as default for this provider
							defaultMap[providerID] = modelStr
						}
					}

					if len(models) > 0 {
						providerName := providerID
						if name, exists := providerData["name"]; exists {
							if nameStr, ok := name.(string); ok {
								providerName = nameStr
							}
						}

						providers = append(providers, map[string]interface{}{
							"id":     providerID,
							"name":   providerName,
							"models": models,
						})
					}
				}
			}
		}
	}

	// 2. Process "customServices"
	if customServicesConfig, exists := s.config["customServices"]; exists {
		if customServices, ok := customServicesConfig.([]interface{}); ok {
			for _, svc := range customServices {
				if svcMap, ok := svc.(map[string]interface{}); ok {
					// Extract fields
					id, _ := svcMap["id"].(string)
					name, _ := svcMap["name"].(string)
					enabled, _ := svcMap["enabled"].(bool)

					if !enabled {
						continue
					}

					// Models
					models := map[string]interface{}{}
					if modelsList, ok := svcMap["models"].([]interface{}); ok {
						for _, m := range modelsList {
							if modelStr, ok := m.(string); ok {
								models[modelStr] = map[string]interface{}{
									"id":   modelStr,
									"name": modelStr,
								}
							}
						}
					}

					// Ensure default model is included
					if defaultModel, ok := svcMap["defaultModel"].(string); ok && defaultModel != "" {
						if _, exists := models[defaultModel]; !exists {
							models[defaultModel] = map[string]interface{}{
								"id":   defaultModel,
								"name": defaultModel,
							}
						}
					}

					if len(models) > 0 {
						providers = append(providers, map[string]interface{}{
							"id":     id,
							"name":   name,
							"models": models,
						})

						// Default model
						if defaultModel, ok := svcMap["defaultModel"].(string); ok && defaultModel != "" {
							defaultMap[id] = defaultModel
						}
					}
				}
			}
		}
	}

	// 3. If no providers found from config, use default OpenSpace Zen
	if len(providers) == 0 {
		return map[string]interface{}{
			"providers": []map[string]interface{}{
				{
					"id":   "openspace",
					"name": "OpenSpace Zen",
					"models": map[string]interface{}{
						"big-pickle": map[string]interface{}{
							"id":   "big-pickle",
							"name": "Big Pickle",
						},
					},
				},
			},
			"default": map[string]interface{}{
				"openspace": "big-pickle",
			},
		}, nil
	}

	return map[string]interface{}{
		"providers": providers,
		"default":   defaultMap,
	}, nil
}

// ListProviders returns list of providers
func (s *Service) ListProviders() ([]map[string]interface{}, error) {
	return []map[string]interface{}{
		{
			"id":   "openspace",
			"name": "OpenSpace Zen",
		},
	}, nil
}

// GetProviderAuth returns provider authentication methods
func (s *Service) GetProviderAuth() (map[string]interface{}, error) {
	return map[string]interface{}{
		"openspace": map[string]interface{}{
			"type": "apiKey",
		},
	}, nil
}

// GetAgents returns list of agents
func (s *Service) GetAgents() ([]map[string]interface{}, error) {
	return []map[string]interface{}{
		{
			"id":   "default",
			"name": "Default Agent",
		},
	}, nil
}

// GetCommands returns list of commands
func (s *Service) GetCommands() ([]map[string]interface{}, error) {
	return []map[string]interface{}{
		{
			"id":          "help",
			"name":        "help",
			"description": "Show help information",
			"category":    "general",
		},
		{
			"id":          "file",
			"name":        "file",
			"description": "File operations",
			"category":    "file",
		},
		{
			"id":          "search",
			"name":        "search",
			"description": "Search in codebase",
			"category":    "search",
		},
	}, nil
}

// GetConfig returns configuration
func (s *Service) GetConfig() (map[string]interface{}, error) {
	return s.config, nil
}

// UpdateConfig updates configuration
func (s *Service) UpdateConfig(configData string) (map[string]interface{}, error) {
	var config map[string]interface{}
	if err := json.Unmarshal([]byte(configData), &config); err != nil {
		return nil, fmt.Errorf("invalid JSON in config: %w", err)
	}

	// Save config to file
	if err := s.saveConfig(config); err != nil {
		return nil, fmt.Errorf("failed to save config: %w", err)
	}

	// Update in-memory config
	s.config = config

	return config, nil
}

// GetCurrentProject returns current project info
func (s *Service) GetCurrentProject() (map[string]interface{}, error) {
	dir, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"path": dir,
		"name": filepath.Base(dir),
	}, nil
}

// GetProjects returns list of projects
func (s *Service) GetProjects() ([]map[string]interface{}, error) {
	return []map[string]interface{}{}, nil
}

// GetVCSInfo returns VCS information
func (s *Service) GetVCSInfo() (map[string]interface{}, error) {
	wd, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	// Try to get git branch
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = wd
	output, err := cmd.Output()
	branch := "main"
	if err == nil {
		branch = strings.TrimSpace(string(output))
		if branch == "" {
			branch = "main"
		}
	}

	return map[string]interface{}{
		"branch": branch,
	}, nil
}

// GetPath returns path information
func (s *Service) GetPath() (map[string]interface{}, error) {
	home, _ := os.UserHomeDir()
	config := filepath.Join(home, ".openspace")
	state := filepath.Join(config, "state")
	worktree, _ := os.Getwd()
	directory, _ := os.Getwd()

	return map[string]interface{}{
		"home":      home,
		"config":    config,
		"state":     state,
		"worktree":  worktree,
		"directory": directory,
	}, nil
}

// GetFiles returns file list for a directory
func (s *Service) GetFiles(path string) ([]map[string]interface{}, error) {
	if path == "" {
		path, _ = os.Getwd()
	}

	// Ensure path is absolute
	if !filepath.IsAbs(path) {
		wd, _ := os.Getwd()
		path = filepath.Join(wd, path)
	}

	// Default ignore list (hardcoded for now, can be improved to read .gitignore)
	ignoredDirs := map[string]bool{
		"node_modules": true,
		".git":         true,
		"dist":         true,
		"build":        true,
		".vscode":      true,
		"coverage":     true,
		".next":        true,
		"target":       true,
		"bin":          true,
		"obj":          true,
		"vendor":       true,
		"tmp":          true,
	}

	// Try to read .gitignore
	gitignorePath := filepath.Join(path, ".gitignore")
	if content, err := os.ReadFile(gitignorePath); err == nil {
		lines := strings.Split(string(content), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				// Very simple parsing: directories ending with /
				if strings.HasSuffix(line, "/") {
					ignoredDirs[strings.TrimSuffix(line, "/")] = true
				} else if !strings.Contains(line, "*") {
					// Exact match (simple)
					ignoredDirs[line] = true
				}
			}
		}
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	files := []map[string]interface{}{}
	for _, entry := range entries {
		// Check ignore list
		if entry.IsDir() && ignoredDirs[entry.Name()] {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		filePath := filepath.Join(path, entry.Name())
		files = append(files, map[string]interface{}{
			"name": entry.Name(),
			"path": filePath,
			"type": func() string {
				if entry.IsDir() {
					return "directory"
				}
				return "file"
			}(),
			"size":  info.Size(),
			"mtime": info.ModTime().Unix(),
		})
	}

	return files, nil
}

// GetFileContent returns file content
func (s *Service) GetFileContent(path string) (map[string]interface{}, error) {
	if path == "" {
		return nil, fmt.Errorf("path parameter is required")
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"path":    path,
		"content": string(content),
	}, nil
}

// SaveFileContent saves content to a file
func (s *Service) SaveFileContent(path string, content string) error {
	if path == "" {
		return fmt.Errorf("path parameter is required")
	}

	// Ensure path is absolute
	if !filepath.IsAbs(path) {
		wd, _ := os.Getwd()
		path = filepath.Join(wd, path)
	}

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	return os.WriteFile(path, []byte(content), 0644)
}

// RunCommand executes a shell command
func (s *Service) RunCommand(command string) (string, error) {
	result, err := s.RunCommandWithCwd(command, "")
	return result.Output, err
}

func (s *Service) RunCommandWithCwd(command string, cwd string) (CommandRunResult, error) {
	return s.RunCommandWithCwdContext(context.Background(), command, cwd)
}

func (s *Service) RunCommandWithCwdContext(ctx context.Context, command string, cwd string) (CommandRunResult, error) {
	if command == "" {
		return CommandRunResult{}, fmt.Errorf("command parameter is required")
	}

	wd, _ := os.Getwd()

	baseDir := wd
	if strings.TrimSpace(cwd) != "" {
		baseDir = cwd
		if !filepath.IsAbs(baseDir) {
			baseDir = filepath.Join(wd, baseDir)
		}
		if info, err := os.Stat(baseDir); err != nil || !info.IsDir() {
			baseDir = wd
		}
	}

	var shell string
	var args []string

	if runtime.GOOS == "windows" {
		if pwshPath, err := exec.LookPath("pwsh"); err == nil {
			shell = pwshPath
			args = []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellCommand(command, baseDir)}
		} else if psPath, err := exec.LookPath("powershell"); err == nil {
			shell = psPath
			args = []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellCommand(command, baseDir)}
		} else {
			shell = "cmd"
			args = []string{"/C", wrapCmdCommand(command, baseDir)}
		}
	} else {
		if bashPath, err := exec.LookPath("bash"); err == nil {
			shell = bashPath
			args = []string{"-lc", wrapPosixShellCommand(command, baseDir)}
		} else {
			shell = "sh"
			args = []string{"-lc", wrapPosixShellCommand(command, baseDir)}
		}
	}

	cmd := exec.CommandContext(ctx, shell, args...)
	hideCommandWindow(cmd)

	cmd.Dir = baseDir
	rawOut, err := cmd.CombinedOutput()
	output := string(rawOut)

	cleanOutput, finalCwd := stripOpenSpaceCwdMarker(output)
	if finalCwd == "" {
		finalCwd = baseDir
	}

	exitCode := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		} else {
			exitCode = 1
		}
	} else {
		exitCode = 0
	}

	branch := detectGitBranch(finalCwd)

	result := CommandRunResult{
		Output:   cleanOutput,
		Cwd:      finalCwd,
		Shell:    detectShellName(shell),
		Branch:   branch,
		ExitCode: exitCode,
	}

	if err != nil {
		return result, fmt.Errorf("command execution failed: %w", err)
	}
	return result, nil
}

const openSpaceCwdMarker = "__OPENSPACE_CWD__="

func stripOpenSpaceCwdMarker(output string) (string, string) {
	normalized := strings.ReplaceAll(output, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")

	cwd := ""
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, openSpaceCwdMarker) {
			cwd = strings.TrimSpace(strings.TrimPrefix(line, openSpaceCwdMarker))
			lines = append(lines[:i], lines[i+1:]...)
			break
		}
	}

	clean := strings.Join(lines, "\n")
	clean = strings.TrimRight(clean, "\n")
	return clean, cwd
}

func wrapPowerShellCommand(userCommand string, cwd string) string {
	return strings.Join([]string{
		"$__openspaceLastExit = 0",
		"try { Set-Location -LiteralPath " + psSingleQuote(cwd) + " } catch {}",
		userCommand,
		"$__openspaceLastExit = $LASTEXITCODE",
		"$__openspaceCwd = (Get-Location).Path",
		"Write-Output (" + psSingleQuote(openSpaceCwdMarker) + " + $__openspaceCwd)",
		"exit $__openspaceLastExit",
	}, "\n")
}

func psSingleQuote(value string) string {
	escaped := strings.ReplaceAll(value, "'", "''")
	return "'" + escaped + "'"
}

func wrapPosixShellCommand(userCommand string, cwd string) string {
	cwdLiteral := shSingleQuote(cwd)
	return strings.Join([]string{
		"cd " + cwdLiteral + " 2>/dev/null || true",
		userCommand,
		"__openspaceExit=$?",
		"__openspaceCwd=\"$(pwd)\"",
		"printf \"\\n" + openSpaceCwdMarker + "%s\\n\" \"$__openspaceCwd\"",
		"exit $__openspaceExit",
	}, "\n")
}

func shSingleQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func wrapCmdCommand(userCommand string, cwd string) string {
	return strings.Join([]string{
		"cd /d " + cmdQuoteArg(cwd),
		userCommand,
		"for /f \"delims=\" %%i in ('cd') do @echo " + openSpaceCwdMarker + "%%i",
	}, " & ")
}

func cmdQuoteArg(value string) string {
	escaped := strings.ReplaceAll(value, `"`, `""`)
	return `"` + escaped + `"`
}

func detectShellName(shellPath string) string {
	base := strings.ToLower(filepath.Base(shellPath))
	switch base {
	case "pwsh", "pwsh.exe":
		return "pwsh"
	case "powershell", "powershell.exe":
		return "powershell"
	case "cmd", "cmd.exe":
		return "cmd"
	case "bash":
		return "bash"
	case "sh":
		return "sh"
	default:
		return base
	}
}

func detectGitBranch(cwd string) string {
	if strings.TrimSpace(cwd) == "" {
		return ""
	}
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	branch := strings.TrimSpace(string(out))
	if branch == "" || branch == "HEAD" {
		return ""
	}
	return branch
}

// GetFileStatus returns file status
func (s *Service) GetFileStatus() (map[string]interface{}, error) {
	return map[string]interface{}{
		"status": "ready",
	}, nil
}

// FindFilesByName searches for files by name
func (s *Service) FindFilesByName(query string, fileType string, limit int) ([]string, error) {
	return s.FindFilesByNameContext(context.Background(), query, fileType, limit)
}

func (s *Service) FindFilesByNameContext(ctx context.Context, query string, fileType string, limit int) ([]string, error) {
	if query == "" {
		return nil, fmt.Errorf("query parameter is required")
	}

	wd, _ := os.Getwd()
	results := []string{}

	// Simple file search implementation
	err := filepath.Walk(wd, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Skip hidden directories
		name := info.Name()
		if info.IsDir() && (len(name) > 0 && name[0] == '.' || name == "node_modules" || name == ".git") {
			return filepath.SkipDir
		}

		// Check if filename contains query
		if !info.IsDir() && containsIgnoreCase(info.Name(), query) {
			rel, _ := filepath.Rel(wd, path)
			results = append(results, rel)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Limit results
	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}

	return results, nil
}

// FindText searches for text in files
func (s *Service) FindText(pattern string) ([]map[string]interface{}, error) {
	if pattern == "" {
		return nil, fmt.Errorf("pattern parameter is required")
	}

	wd, _ := os.Getwd()
	results := []map[string]interface{}{}

	// Compile regex pattern
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid regex pattern: %w", err)
	}

	// Search in files
	err = filepath.Walk(wd, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		// Skip directories and hidden files
		if info.IsDir() || len(info.Name()) > 0 && info.Name()[0] == '.' {
			if info.IsDir() && (info.Name() == "node_modules" || info.Name() == ".git") {
				return filepath.SkipDir
			}
			return nil
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		// Search for pattern
		matches := re.FindAllString(string(content), -1)
		if len(matches) > 0 {
			relPath, _ := filepath.Rel(wd, path)
			results = append(results, map[string]interface{}{
				"file":    relPath,
				"matches": matches,
				"count":   len(matches),
			})
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return results, nil
}

// FindSymbol searches for symbols
func (s *Service) FindSymbol(query string) ([]map[string]interface{}, error) {
	if query == "" {
		return nil, fmt.Errorf("query parameter is required")
	}

	wd, _ := os.Getwd()
	results := []map[string]interface{}{}

	// Simple symbol search - look for function definitions, variables, etc.
	patterns := []string{
		fmt.Sprintf("func\\s+%s\\s*\\(", regexp.QuoteMeta(query)),
		fmt.Sprintf("var\\s+%s\\s*=", regexp.QuoteMeta(query)),
		fmt.Sprintf("const\\s+%s\\s*=", regexp.QuoteMeta(query)),
		fmt.Sprintf("type\\s+%s\\s", regexp.QuoteMeta(query)),
	}

	for _, pattern := range patterns {
		re, err := regexp.Compile(pattern)
		if err != nil {
			continue
		}

		err = filepath.Walk(wd, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}

			// Skip directories and non-source files
			if info.IsDir() || !isSourceFile(info.Name()) {
				if info.IsDir() && (info.Name() == "node_modules" || info.Name() == ".git") {
					return filepath.SkipDir
				}
				return nil
			}

			// Read file content
			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}

			// Search for symbol
			matches := re.FindAllString(string(content), -1)
			if len(matches) > 0 {
				relPath, _ := filepath.Rel(wd, path)
				results = append(results, map[string]interface{}{
					"file":    relPath,
					"symbol":  query,
					"matches": matches,
					"count":   len(matches),
				})
			}

			return nil
		})

		if err != nil {
			continue
		}
	}

	return results, nil
}

// GetSessionChildren returns child sessions
func (s *Service) GetSessionChildren(sessionID string) ([]map[string]interface{}, error) {
	s.sessionMux.RLock()
	defer s.sessionMux.RUnlock()

	children := []map[string]interface{}{}
	for _, session := range s.sessions {
		if session.ParentID == sessionID {
			children = append(children, map[string]interface{}{
				"id":    session.ID,
				"title": session.Title,
				"state": "idle",
			})
		}
	}

	return children, nil
}

// UpdateSessionTodos updates todo items for a session
func (s *Service) UpdateSessionTodos(sessionID string, todos []TodoItem) error {
	s.sessionMux.Lock()
	defer s.sessionMux.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	session.Todos = todos
	session.UpdatedAt = time.Now().UnixMilli()

	return s.saveSessionsLocked()
}

// GetGitStatus returns git status
func (s *Service) GetGitStatus() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	cmd := exec.Command("git", "status", "--short")
	cmd.Dir = wd
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git status failed: %w", err)
	}

	return string(output), nil
}

// GetGitDiff returns git diff
func (s *Service) GetGitDiff(staged bool) (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	args := []string{"diff"}
	if staged {
		args = append(args, "--cached")
	}

	cmd := exec.Command("git", args...)
	cmd.Dir = wd
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git diff failed: %w", err)
	}

	return string(output), nil
}

// GetSessionTodo returns todo items for a session
func (s *Service) GetSessionTodo(sessionID string) ([]map[string]interface{}, error) {
	s.sessionMux.RLock()
	defer s.sessionMux.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	// Use stored todos if available
	if len(session.Todos) > 0 {
		result := []map[string]interface{}{}
		for _, todo := range session.Todos {
			result = append(result, map[string]interface{}{
				"id":       todo.ID,
				"content":  todo.Content,
				"status":   todo.Status,
				"priority": todo.Priority,
			})
		}
		return result, nil
	}

	todos := []map[string]interface{}{}

	// Fallback: Scan all messages for todo items (legacy support)
	for _, msg := range session.Messages {
		parts, ok := msg["parts"].([]interface{})
		if !ok || len(parts) == 0 {
			continue
		}

		textPart, ok := parts[0].(map[string]interface{})
		if !ok {
			continue
		}

		text, ok := textPart["text"].(string)
		if !ok {
			continue
		}

		// Parse todo items from text
		lines := strings.Split(text, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "- [ ] ") || strings.HasPrefix(line, "- [x] ") {
				status := "pending"
				if strings.HasPrefix(line, "- [x] ") {
					status = "completed"
				}

				content := strings.TrimPrefix(line, "- [ ] ")
				content = strings.TrimPrefix(content, "- [x] ")

				todos = append(todos, map[string]interface{}{
					"content":  content,
					"status":   status,
					"priority": "medium",
				})
			}
		}
	}

	return todos, nil
}

// GetSessionDiff returns diff information for a session
func (s *Service) GetSessionDiff(sessionID string, messageID string) (map[string]interface{}, error) {
	// Simplified implementation - return empty diff for now
	return map[string]interface{}{
		"diff": "",
	}, nil
}

// SummarizeSession summarizes a session
func (s *Service) SummarizeSession(sessionID string, providerID string, modelID string) (map[string]interface{}, error) {
	session, err := s.GetSession(sessionID)
	if err != nil {
		return nil, err
	}

	// Try to use LLM for summary if custom services are configured
	if customServicesConfig, exists := s.config["customServices"]; exists {
		if customServices, ok := customServicesConfig.([]interface{}); ok && len(customServices) > 0 {
			var serviceConfig CustomLLMService
			found := false

			// If providerID is specified, look for it
			if providerID != "" {
				for _, svc := range customServices {
					if svcMap, ok := svc.(map[string]interface{}); ok {
						if id, _ := svcMap["id"].(string); id == providerID {
							serviceJSON, _ := json.Marshal(svcMap)
							json.Unmarshal(serviceJSON, &serviceConfig)
							found = true
							break
						}
					}
				}
			}

			// If not found or not specified, use the first enabled service
			if !found {
				for _, svc := range customServices {
					if svcMap, ok := svc.(map[string]interface{}); ok {
						if enabled, ok := svcMap["enabled"].(bool); ok && !enabled {
							continue
						}
						serviceJSON, _ := json.Marshal(svcMap)
						json.Unmarshal(serviceJSON, &serviceConfig)
						found = true
						break
					}
				}
			}

			if found {
				// Use specified model or default
				model := modelID
				if model == "" {
					model = serviceConfig.DefaultModel
				}

				// Construct messages for summary
				messages := []map[string]interface{}{}

				// Add session context (limit to last 50 messages to avoid token limits)
				msgs := session.Messages
				if len(msgs) > 50 {
					msgs = msgs[len(msgs)-50:]
				}

				for _, msg := range msgs {
					role, content, ok := normalizeStoredMessage(msg)
					if !ok {
						continue
					}
					if strings.TrimSpace(role) == "" {
						continue
					}
					messages = append(messages, map[string]interface{}{
						"role":    role,
						"content": content,
					})
				}

				// Add summary request
				messages = append(messages, map[string]interface{}{
					"role":    "user",
					"content": "Please provide a concise summary of the above conversation. Focus on the main topics discussed and any decisions made.",
				})

				// Call LLM
				summary, _, err := s.callLLMService(context.Background(), sessionID, serviceConfig, messages, model, true)
				if err == nil {
					// Save summary to session
					s.sessionMux.Lock()
					session.Summary = summary
					_ = s.saveSessionsLocked()
					s.sessionMux.Unlock()

					return map[string]interface{}{
						"summary":      summary,
						"messageCount": len(session.Messages),
						"provider":     serviceConfig.ID,
						"model":        model,
					}, nil
				}
				// If error, fall back to simple summary
				fmt.Printf("Summary generation failed: %v\n", err)
			}
		}
	}

	// Simple summarization based on message count (Fallback)
	messageCount := len(session.Messages)
	summary := fmt.Sprintf("Session '%s' contains %d messages. (LLM summary unavailable)", session.Title, messageCount)

	return map[string]interface{}{
		"summary":      summary,
		"messageCount": messageCount,
		"provider":     providerID,
		"model":        modelID,
	}, nil
}

// containsIgnoreCase checks if s contains substr (case-insensitive)
func containsIgnoreCase(s, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}

// isSourceFile checks if a file is a source code file
func isSourceFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	sourceExts := []string{".go", ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".cpp", ".c", ".h", ".cs", ".php", ".rb", ".rs"}

	for _, sourceExt := range sourceExts {
		if ext == sourceExt {
			return true
		}
	}
	return false
}
