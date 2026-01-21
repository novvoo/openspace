package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// CustomLLMService represents a custom LLM service configuration
type CustomLLMService struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	BaseURL      string            `json:"baseUrl"`
	APIKey       string            `json:"apiKey"`
	Headers      map[string]string `json:"headers"`
	Models       []string          `json:"models"`
	DefaultModel string            `json:"defaultModel"`
	AuthType     string            `json:"authType"` // "apiKey", "bearer", "none"
	Provider     string            `json:"provider"` // "openai", "anthropic", "ollama"
	Enabled      bool              `json:"enabled"`
	ContextLimit int               `json:"contextLimit,omitempty"` // Max context tokens (approx)
}

// prepareMessages prepares and truncates messages to fit context limit
func (s *Service) prepareMessages(messages []map[string]interface{}, limit int) []map[string]interface{} {
	if limit <= 0 {
		limit = 100000 // Default high limit
	}

	// Calculate rough token count (1 token ~= 4 chars)
	countTokens := func(msgs []map[string]interface{}) int {
		total := 0
		for _, msg := range msgs {
			if content, ok := msg["content"].(string); ok {
				total += len(content) / 4
			}
		}
		return total
	}

	if countTokens(messages) <= limit {
		return messages
	}

	// Truncation strategy:
	// 1. Keep system prompt (usually first message)
	// 2. Keep the first User message (Task definition) if possible
	// 3. Keep last N messages that fit in the remaining budget
	// 4. Discard middle messages

	if len(messages) <= 3 {
		return messages
	}

	result := []map[string]interface{}{}

	// Always keep first message (System Prompt or Initial User Prompt)
	// Note: The actual System Prompt is often added later in callLLMService,
	// so messages[0] here is usually the first User message in the session history.
	firstMsg := messages[0]
	result = append(result, firstMsg)

	currentTokens := len(firstMsg["content"].(string)) / 4

	// Keep second message if it exists (often Assistant's first reply) to maintain context start
	if len(messages) > 1 {
		secondMsg := messages[1]
		secondTokens := len(secondMsg["content"].(string)) / 4
		if currentTokens+secondTokens < limit/2 { // Only keep if it doesn't take up too much space
			result = append(result, secondMsg)
			currentTokens += secondTokens
		}
	}

	// Work backwards from end to fill remaining quota
	var keptTailMessages []map[string]interface{}

	// Start from the end, stop before we hit the messages we already kept at the start
	startIndex := len(result)

	for i := len(messages) - 1; i >= startIndex; i-- {
		msg := messages[i]
		tokens := 0
		if content, ok := msg["content"].(string); ok {
			tokens = len(content) / 4
		}

		if currentTokens+tokens > limit {
			break
		}

		currentTokens += tokens
		keptTailMessages = append([]map[string]interface{}{msg}, keptTailMessages...)
	}

	// If we skipped messages, add a placeholder
	if len(keptTailMessages) < len(messages)-len(result) {
		skippedCount := len(messages) - len(result) - len(keptTailMessages)
		if skippedCount > 0 {
			// Insert a system note about truncation
			result = append(result, map[string]interface{}{
				"role":    "system",
				"content": fmt.Sprintf("[Context Truncation: %d messages from the middle of the conversation have been removed to fit the token limit. Please focus on the latest messages.]", skippedCount),
			})
		}
	}

	result = append(result, keptTailMessages...)
	return result
}

// TestCustomLLMService tests a custom LLM service configuration
func (s *Service) TestCustomLLMService(configData string) (map[string]interface{}, error) {
	var config CustomLLMService
	if err := json.Unmarshal([]byte(configData), &config); err != nil {
		return nil, fmt.Errorf("invalid JSON in config: %w", err)
	}

	// Create test request
	var req *http.Request
	var err error

	if config.Provider == "anthropic" {
		testData := map[string]interface{}{
			"model": config.DefaultModel,
			"messages": []map[string]interface{}{
				{
					"role":    "user",
					"content": "Hello, this is a test message.",
				},
			},
			"max_tokens": 10,
		}

		jsonData, err := json.Marshal(testData)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal test data: %w", err)
		}

		req, err = http.NewRequest("POST", config.BaseURL, strings.NewReader(string(jsonData)))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", config.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else {
		testData := map[string]interface{}{
			"model": config.DefaultModel,
			"messages": []map[string]interface{}{
				{
					"role":    "user",
					"content": "Hello, this is a test message.",
				},
			},
			"max_tokens": 10,
		}

		jsonData, err := json.Marshal(testData)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal test data: %w", err)
		}

		req, err = http.NewRequest("POST", config.BaseURL, strings.NewReader(string(jsonData)))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Content-Type", "application/json")

		// Set authentication
		switch config.AuthType {
		case "apiKey":
			if config.APIKey != "" {
				req.Header.Set("Authorization", "Bearer "+config.APIKey)
			}
		case "bearer":
			if config.APIKey != "" {
				req.Header.Set("Authorization", "Bearer "+config.APIKey)
			}
		case "none":
			// No authentication
		default:
			if config.APIKey != "" {
				req.Header.Set("Authorization", "Bearer "+config.APIKey)
			}
		}
	}

	// Add custom headers
	for key, value := range config.Headers {
		req.Header.Set(key, value)
	}

	// Make request
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Check status code
	if resp.StatusCode >= 400 {
		return map[string]interface{}{
			"success": false,
			"status":  resp.StatusCode,
			"error":   string(body),
			"message": "Service test failed",
		}, nil
	}

	// Parse response
	var response map[string]interface{}
	if err := json.Unmarshal(body, &response); err != nil {
		return map[string]interface{}{
			"success": false,
			"status":  resp.StatusCode,
			"error":   "Invalid JSON response",
			"message": "Service test failed",
		}, nil
	}

	return map[string]interface{}{
		"success":  true,
		"status":   resp.StatusCode,
		"response": response,
		"message":  "Service test successful",
	}, nil
}

// SendCustomLLMMessage sends a message using custom LLM service
func (s *Service) SendCustomLLMMessage(ctx context.Context, sessionID string, message string, serviceID string) (map[string]interface{}, error) {
	// Get custom service config
	customServices, ok := s.config["customServices"].([]interface{})
	if !ok {
		return nil, fmt.Errorf("custom services not configured")
	}

	var serviceConfig CustomLLMService
	for _, svc := range customServices {
		svcMap := svc.(map[string]interface{})
		if svcMap["id"] == serviceID {
			serviceJSON, _ := json.Marshal(svcMap)
			json.Unmarshal(serviceJSON, &serviceConfig)
			break
		}
	}

	if serviceConfig.ID == "" {
		return nil, fmt.Errorf("custom service not found: %s", serviceID)
	}

	return s.sendLLMMessageInternal(ctx, sessionID, message, serviceConfig, serviceConfig.DefaultModel)
}

// sendLLMMessageInternal handles the common logic for sending messages via LLM
func (s *Service) sendLLMMessageInternal(ctx context.Context, sessionID string, message string, serviceConfig CustomLLMService, modelID string) (map[string]interface{}, error) {
	targetModel := modelID
	if targetModel == "" {
		targetModel = serviceConfig.DefaultModel
	}

	// Get session
	session, err := s.GetSession(sessionID)
	if err != nil {
		return nil, err
	}

	// Prepare messages for API
	messages := []map[string]interface{}{}
	for _, msg := range session.Messages {
		msgInfo := msg["info"].(map[string]interface{})
		msgParts := msg["parts"].([]interface{})

		if len(msgParts) > 0 {
			textPart := msgParts[0].(map[string]interface{})
			messages = append(messages, map[string]interface{}{
				"role":    msgInfo["role"],
				"content": textPart["text"],
			})
		}
	}

	// Add current message
	messages = append(messages, map[string]interface{}{
		"role":    "user",
		"content": message,
	})

	// Add system prompt for tools
	// Try to load custom prompt from .openspace/prompt.md
	userPrompt := ""
	if wd, err := os.Getwd(); err == nil {
		promptPath := filepath.Join(wd, ".openspace", "prompt.md")
		if content, err := os.ReadFile(promptPath); err == nil {
			userPrompt = "\n\nProject Context:\n" + string(content)
		}
	}

	// Check for Plan Mode in user message
	planMode := false
	if strings.HasPrefix(message, "[MODE: PLAN]") {
		planMode = true
		// Remove the mode tag for the actual message content if needed,
		// but keeping it helps the model know the context too.
	}

	systemPromptContent := `You are OpenSpace, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, best practices, and performance optimization.

====
TOOL USE
====
You have access to a set of tools that are executed upon the user's approval. You can use one tool per message, and will receive the result of that tool use in the user's next message.

To use a tool, you must output a valid XML block like this:

<tool_call>
  <name>tool_name</name>
  <args>
    <arg_name>arg_value</arg_name>
  </args>
</tool_call>

Available Tools:

1. search_files: Search for files by name.
   Args: <query>filename</query>

2. read_file: Read the content of a file.
   Args: <path>path/to/file</path>

3. list_files: List files in a directory.
   Args: <path>directory_path</path>

4. run_command: Execute a shell command.
   Args: <command>shell_command</command>
   - Only use this when necessary. Prefer specialized tools.
   - You must wait for the command to finish and return output.

5. save_file: Save content to a file.
   Args: <path>path/to/file</path> <content>file_content</content>
   - Always read the file first to understand context unless creating a new file.

6. git_status: Check git status.
   Args: (none)

7. git_diff: Check git diff.
   Args: <staged>true|false</staged> (optional, default false)

8. manage_todo: Manage session todo list.
   Args: <action>add|update|delete|list</action> <content>task_description</content> <id>task_id</id> <status>pending|in_progress|completed</status>
   - Use this to keep track of your progress on complex tasks.

Example:
<tool_call>
  <name>save_file</name>
  <args>
    <path>main.go</path>
    <content>package main...</content>
  </args>
</tool_call>

====
RULES
====
1. **Act as an Engineer**: Be precise, technical, and direct. Do not apologize for errors; fix them.
2. **Context Awareness**: You are working in a persistent session. Use 'read_file' to understand the code before editing.
3. **Iterative Process**:
   - ANALYZE: Understand the task and codebase.
   - PLAN: Break down complex tasks.
   - EXECUTE: Use tools to make changes.
4. **Formatting**: Always use the XML tool call format exactly.
`

	if planMode {
		systemPromptContent += `
====
PLAN MODE
====
You are currently in PLAN MODE.
- Focus on information gathering, asking questions, and architecting a solution.
- DO NOT execute tools that modify files or run side-effect commands yet.
- Use 'read_file', 'search_files', 'list_files' to explore.
- When you have a solid plan, ask the user to switch to ACT MODE.
`
	} else {
		systemPromptContent += `
====
ACT MODE
====
You are currently in ACT MODE.
- Focus on implementing the solution.
- You can use all available tools to modify files and run commands.
- Verify your changes after implementation.
`
	}

	systemPrompt := map[string]interface{}{
		"role":    "system",
		"content": systemPromptContent + userPrompt,
	}
	// Prepend system prompt
	messages = append([]map[string]interface{}{systemPrompt}, messages...)

	// Make request
	responseText, rawTurns, err := s.callLLMService(ctx, sessionID, serviceConfig, messages, targetModel)
	if err != nil {
		return nil, err
	}

	// Update session with new messages
	s.sessionMux.Lock()
	defer s.sessionMux.Unlock()

	now := time.Now().UnixMilli()
	messageID := fmt.Sprintf("msg_%d", now)

	// Add user message
	userInfo := map[string]interface{}{
		"role":      "user",
		"createdAt": now,
		"id":        messageID,
	}
	if len(rawTurns) > 0 {
		if req, ok := rawTurns[0]["request"].(string); ok {
			userInfo["rawRequest"] = req
		}
		userInfo["rawTurns"] = rawTurns
	}
	userMsg := map[string]interface{}{
		"info": userInfo,
		"parts": []map[string]interface{}{
			{
				"type": "text",
				"text": message,
			},
		},
	}
	session.Messages = append(session.Messages, userMsg)

	// Add assistant response
	assistantInfo := map[string]interface{}{
		"role":      "assistant",
		"createdAt": now + 100,
		"id":        fmt.Sprintf("msg_%d", now+100),
		"model":     targetModel,
		"service":   serviceConfig.ID,
	}
	if len(rawTurns) > 0 {
		if resp, ok := rawTurns[len(rawTurns)-1]["response"].(string); ok {
			assistantInfo["rawResponse"] = resp
		}
		assistantInfo["rawTurns"] = rawTurns
	}
	assistantMsg := map[string]interface{}{
		"info": assistantInfo,
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

	// Save session
	if err := s.saveSessions(); err != nil {
		fmt.Printf("Warning: Failed to save session: %v\n", err)
	}

	return assistantMsg, nil
}

// GetCustomLLMServices returns all custom LLM services
func (s *Service) GetCustomLLMServices() ([]CustomLLMService, error) {
	customServices, ok := s.config["customServices"].([]interface{})
	if !ok {
		return []CustomLLMService{}, nil
	}

	var services []CustomLLMService
	for _, svc := range customServices {
		svcMap := svc.(map[string]interface{})
		serviceJSON, _ := json.Marshal(svcMap)
		var service CustomLLMService
		json.Unmarshal(serviceJSON, &service)
		services = append(services, service)
	}

	return services, nil
}

// AddCustomLLMService adds a new custom LLM service
func (s *Service) AddCustomLLMService(configData string) (CustomLLMService, error) {
	var service CustomLLMService
	if err := json.Unmarshal([]byte(configData), &service); err != nil {
		return service, fmt.Errorf("invalid JSON in config: %w", err)
	}

	// Validate required fields
	if service.ID == "" {
		return service, fmt.Errorf("service ID is required")
	}
	if service.Name == "" {
		return service, fmt.Errorf("service name is required")
	}
	if service.BaseURL == "" {
		return service, fmt.Errorf("base URL is required")
	}
	if service.DefaultModel == "" {
		return service, fmt.Errorf("default model is required")
	}

	// Get existing custom services
	customServices, ok := s.config["customServices"].([]interface{})
	if !ok {
		customServices = []interface{}{}
	}

	// Check for duplicate ID
	for _, svc := range customServices {
		svcMap := svc.(map[string]interface{})
		if svcMap["id"] == service.ID {
			return service, fmt.Errorf("service with ID '%s' already exists", service.ID)
		}
	}

	// Add new service
	serviceJSON, _ := json.Marshal(service)
	var serviceMap map[string]interface{}
	json.Unmarshal(serviceJSON, &serviceMap)
	customServices = append(customServices, serviceMap)

	// Update config
	s.config["customServices"] = customServices

	// Save config
	if err := s.saveConfig(s.config); err != nil {
		return service, fmt.Errorf("failed to save config: %w", err)
	}

	return service, nil
}

// UpdateCustomLLMService updates an existing custom LLM service
func (s *Service) UpdateCustomLLMService(serviceID string, configData string) (CustomLLMService, error) {
	var service CustomLLMService
	if err := json.Unmarshal([]byte(configData), &service); err != nil {
		return service, fmt.Errorf("invalid JSON in config: %w", err)
	}

	// Validate required fields
	if service.ID != serviceID {
		return service, fmt.Errorf("service ID mismatch")
	}
	if service.Name == "" {
		return service, fmt.Errorf("service name is required")
	}
	if service.BaseURL == "" {
		return service, fmt.Errorf("base URL is required")
	}
	if service.DefaultModel == "" {
		return service, fmt.Errorf("default model is required")
	}

	// Get existing custom services
	customServices, ok := s.config["customServices"].([]interface{})
	if !ok {
		return service, fmt.Errorf("no custom services configured")
	}

	// Find and update service
	found := false
	for i, svc := range customServices {
		svcMap := svc.(map[string]interface{})
		if svcMap["id"] == serviceID {
			serviceJSON, _ := json.Marshal(service)
			var serviceMap map[string]interface{}
			json.Unmarshal(serviceJSON, &serviceMap)
			customServices[i] = serviceMap
			found = true
			break
		}
	}

	if !found {
		return service, fmt.Errorf("service not found: %s", serviceID)
	}

	// Update config
	s.config["customServices"] = customServices

	// Save config
	if err := s.saveConfig(s.config); err != nil {
		return service, fmt.Errorf("failed to save config: %w", err)
	}

	return service, nil
}

// DeleteCustomLLMService deletes a custom LLM service
func (s *Service) DeleteCustomLLMService(serviceID string) error {
	// Get existing custom services
	customServices, ok := s.config["customServices"].([]interface{})
	if !ok {
		return fmt.Errorf("no custom services configured")
	}

	// Find and remove service
	found := false
	for i, svc := range customServices {
		svcMap := svc.(map[string]interface{})
		if svcMap["id"] == serviceID {
			customServices = append(customServices[:i], customServices[i+1:]...)
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("service not found: %s", serviceID)
	}

	// Update config
	s.config["customServices"] = customServices

	// Save config
	if err := s.saveConfig(s.config); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

// callLLMService calls the LLM service API with tool loop
func (s *Service) callLLMService(ctx context.Context, sessionID string, config CustomLLMService, initialMessages []map[string]interface{}, model string) (string, []map[string]interface{}, error) {
	currentMessages := make([]map[string]interface{}, len(initialMessages))
	copy(currentMessages, initialMessages)

	// Apply context compression first
	currentMessages = s.prepareMessages(currentMessages, config.ContextLimit)

	maxTurns := 10
	var fullResponseBuilder strings.Builder
	rawTurns := make([]map[string]interface{}, 0)

	for i := 0; i < maxTurns; i++ {
		// Check context cancellation
		select {
		case <-ctx.Done():
			return "", rawTurns, ctx.Err()
		default:
		}

		var req *http.Request
		var err error
		var rawRequestJSON []byte

		if config.Provider == "anthropic" {
			// Anthropic specific logic
			var systemPrompt string
			var anthropicMessages []map[string]interface{}

			// Extract system prompt and filter messages
			for _, msg := range currentMessages {
				role := msg["role"].(string)
				if role == "system" {
					if content, ok := msg["content"].(string); ok {
						systemPrompt += content + "\n"
					}
				} else {
					anthropicMessages = append(anthropicMessages, msg)
				}
			}

			requestData := map[string]interface{}{
				"model":      model,
				"messages":   anthropicMessages,
				"max_tokens": 4096,
				"system":     strings.TrimSpace(systemPrompt),
			}

			rawRequestJSON, err = json.MarshalIndent(requestData, "", "  ")
			if err != nil {
				return "", rawTurns, fmt.Errorf("failed to marshal request: %w", err)
			}
			jsonData := rawRequestJSON // Use the same data but compact would be better for network

			req, err = http.NewRequestWithContext(ctx, "POST", config.BaseURL, strings.NewReader(string(jsonData)))
			if err != nil {
				return "", rawTurns, fmt.Errorf("failed to create request: %w", err)
			}

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("x-api-key", config.APIKey)
			req.Header.Set("anthropic-version", "2023-06-01")

			// Add custom headers
			for key, value := range config.Headers {
				req.Header.Set(key, value)
			}

		} else {
			// Default (OpenAI compatible) logic
			requestData := map[string]interface{}{
				"model":       model,
				"messages":    currentMessages,
				"temperature": 1,
				"top_p":       0.95,
				"max_tokens":  2048,
			}

			rawRequestJSON, err = json.MarshalIndent(requestData, "", "  ")
			if err != nil {
				return "", rawTurns, fmt.Errorf("failed to marshal request: %w", err)
			}
			jsonData := rawRequestJSON

			req, err = http.NewRequestWithContext(ctx, "POST", config.BaseURL, strings.NewReader(string(jsonData)))
			if err != nil {
				return "", rawTurns, fmt.Errorf("failed to create request: %w", err)
			}

			req.Header.Set("Content-Type", "application/json")

			// Auth
			switch config.AuthType {
			case "apiKey", "bearer":
				if config.APIKey != "" {
					req.Header.Set("Authorization", "Bearer "+config.APIKey)
				}
			case "none":
				// No authentication
			default:
				if config.APIKey != "" {
					req.Header.Set("Authorization", "Bearer "+config.APIKey)
				}
			}

			// Add custom headers
			for key, value := range config.Headers {
				req.Header.Set(key, value)
			}
		}

		// Make request
		client := &http.Client{Timeout: 120 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return "", rawTurns, fmt.Errorf("request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return "", rawTurns, fmt.Errorf("failed to read response: %w", err)
		}

		rawTurns = append(rawTurns, map[string]interface{}{
			"provider": config.Provider,
			"model":    model,
			"url":      config.BaseURL,
			"status":   resp.StatusCode,
			"request":  string(rawRequestJSON),
			"response": string(body),
		})

		rawDebugInfo := fmt.Sprintf("\n\n<debug_info>\n<request>\n%s\n</request>\n<response>\n%s\n</response>\n</debug_info>", string(rawRequestJSON), string(body))

		if resp.StatusCode >= 400 {
			return "", rawTurns, fmt.Errorf("API request failed with status %d: %s%s", resp.StatusCode, string(body), rawDebugInfo)
		}

		// Parse response
		var response map[string]interface{}
		if err := json.Unmarshal(body, &response); err != nil {
			return "", rawTurns, fmt.Errorf("failed to parse response: %w", err)
		}

		// Extract response text
		var responseText string

		if config.Provider == "anthropic" {
			// Anthropic response parsing
			if contentArray, ok := response["content"].([]interface{}); ok && len(contentArray) > 0 {
				if firstBlock, ok := contentArray[0].(map[string]interface{}); ok {
					if text, ok := firstBlock["text"].(string); ok {
						responseText = text
					}
				}
			}
		} else {
			// OpenAI response parsing
			if choices, ok := response["choices"].([]interface{}); ok && len(choices) > 0 {
				if choice, ok := choices[0].(map[string]interface{}); ok {
					if message, ok := choice["message"].(map[string]interface{}); ok {
						if content, ok := message["content"].(string); ok {
							responseText = content
						}
					}
				}
			}
			// Fallback for some compatible APIs that might use 'content' directly or other formats?
			// For now, stick to OpenAI standard.
		}

		if responseText == "" {
			return "", rawTurns, fmt.Errorf("empty response from service (provider: %s)%s", config.Provider, rawDebugInfo)
		}

		// Append to full response
		if fullResponseBuilder.Len() > 0 {
			fullResponseBuilder.WriteString("\n\n")
		}
		fullResponseBuilder.WriteString(responseText)

		// Check for tools
		re := regexp.MustCompile(`(?s)<tool_call>(.*?)</tool_call>`)
		matches := re.FindAllStringSubmatch(responseText, -1)

		if len(matches) == 0 {
			return fullResponseBuilder.String(), rawTurns, nil
		}

		// Append assistant message
		currentMessages = append(currentMessages, map[string]interface{}{
			"role":    "assistant",
			"content": responseText,
		})

		// Execute tools
		var toolResults []string
		for _, match := range matches {
			toolCallXML := match[1]

			// Extract tool name
			nameRe := regexp.MustCompile(`<name>(.*?)</name>`)
			nameMatch := nameRe.FindStringSubmatch(toolCallXML)
			if len(nameMatch) < 2 {
				continue
			}
			toolName := strings.TrimSpace(nameMatch[1])

			// Extract args
			argsMap := make(map[string]string)
			argsRe := regexp.MustCompile(`<(.*?)>(.*?)</\1>`)
			argsMatches := argsRe.FindAllStringSubmatch(toolCallXML, -1)
			for _, am := range argsMatches {
				if am[1] != "name" && am[1] != "args" {
					argsMap[am[1]] = am[2]
				}
			}

			// Execute tool
			result := s.dispatchTool(sessionID, toolName, argsMap)
			toolResults = append(toolResults, fmt.Sprintf("Tool: %s\nResult: %s", toolName, result))
		}

		// Add tool results as user message
		if len(toolResults) > 0 {
			resultsText := "Tool Results:\n" + strings.Join(toolResults, "\n---\n")

			// Append results to full response for visibility
			fullResponseBuilder.WriteString("\n\n")
			fullResponseBuilder.WriteString("<tool_results>\n")
			fullResponseBuilder.WriteString(strings.Join(toolResults, "\n---\n"))
			fullResponseBuilder.WriteString("\n</tool_results>")

			currentMessages = append(currentMessages, map[string]interface{}{
				"role":    "user",
				"content": resultsText + "\n\nPlease continue.",
			})
		}
	}
	// If we exit the loop normally (e.g. context done), return what we have
	return fullResponseBuilder.String(), rawTurns, nil
}

// dispatchTool dispatches a tool call to the appropriate service method
func (s *Service) dispatchTool(sid string, name string, args map[string]string) string {
	sessionID := sid
	switch name {
	case "search_files":
		query := args["query"]
		files, err := s.FindFilesByName(query, "", 10)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		return strings.Join(files, "\n")
	case "read_file":
		path := args["path"]
		content, err := s.GetFileContent(path)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		fileContent := content["content"].(string)
		if len(fileContent) > 5000 {
			fileContent = fileContent[:5000] + "... (truncated)"
		}
		return fileContent
	case "list_files":
		path := args["path"]
		files, err := s.GetFiles(path)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		var result []string
		for _, f := range files {
			result = append(result, fmt.Sprintf("%s (%s)", f["name"], f["type"]))
		}
		return strings.Join(result, "\n")
	case "run_command":
		command := args["command"]
		output, err := s.RunCommand(command)
		if err != nil {
			return fmt.Sprintf("Error: %v\nOutput: %s", err, output)
		}
		return output
	case "save_file":
		path := args["path"]
		content := args["content"]
		err := s.SaveFileContent(path, content)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		return "File saved successfully"
	case "git_status":
		status, err := s.GetGitStatus()
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		if status == "" {
			return "Clean working tree"
		}
		return status
	case "git_diff":
		staged := args["staged"] == "true"
		diff, err := s.GetGitDiff(staged)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		if diff == "" {
			return "No changes"
		}
		return diff
	case "manage_todo":
		action := args["action"]

		session, err := s.GetSession(sessionID)
		if err != nil {
			return fmt.Sprintf("Error: Session not found")
		}

		todos := session.Todos
		if todos == nil {
			todos = []TodoItem{}
		}

		switch action {
		case "add":
			content := args["content"]
			if content == "" {
				return "Error: content is required"
			}
			newTodo := TodoItem{
				ID:       fmt.Sprintf("todo_%d", time.Now().UnixNano()),
				Content:  content,
				Status:   "pending",
				Priority: "medium",
			}
			todos = append(todos, newTodo)
			s.UpdateSessionTodos(sessionID, todos)
			return fmt.Sprintf("Todo added: %s (ID: %s)", content, newTodo.ID)

		case "update":
			id := args["id"]
			status := args["status"]
			if id == "" {
				return "Error: id is required"
			}

			found := false
			for i, t := range todos {
				if t.ID == id {
					if status != "" {
						todos[i].Status = status
					}
					// Optional: update content/priority
					found = true
					break
				}
			}

			if !found {
				return fmt.Sprintf("Error: Todo %s not found", id)
			}

			s.UpdateSessionTodos(sessionID, todos)
			return fmt.Sprintf("Todo updated: %s", id)

		case "delete":
			id := args["id"]
			if id == "" {
				return "Error: id is required"
			}

			newTodos := []TodoItem{}
			found := false
			for _, t := range todos {
				if t.ID != id {
					newTodos = append(newTodos, t)
				} else {
					found = true
				}
			}

			if !found {
				return fmt.Sprintf("Error: Todo %s not found", id)
			}

			s.UpdateSessionTodos(sessionID, newTodos)
			return fmt.Sprintf("Todo deleted: %s", id)

		case "list":
			if len(todos) == 0 {
				return "No todos in this session."
			}
			var list []string
			for _, t := range todos {
				icon := "[ ]"
				if t.Status == "completed" {
					icon = "[x]"
				} else if t.Status == "in_progress" {
					icon = "[/]"
				}
				list = append(list, fmt.Sprintf("%s %s (ID: %s)", icon, t.Content, t.ID))
			}
			return strings.Join(list, "\n")

		default:
			return "Error: Unknown action. Use add, update, delete, or list."
		}
	default:
		return "Unknown tool: " + name
	}
}
