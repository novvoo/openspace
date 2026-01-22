package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type ToolCall struct {
	ID   string
	Name string
	Args map[string]any
}

type ToolResult struct {
	ToolCallID string
	Name       string
	Content    string
	IsError    bool
}

type ToolSpec struct {
	Name        string
	Description string
	Parameters  map[string]any
}

type ToolHandler interface {
	Spec() ToolSpec
	AllowedInPlanMode() bool
	Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error)
}

type ToolRegistry struct {
	handlers map[string]ToolHandler
}

func newToolRegistry() *ToolRegistry {
	r := &ToolRegistry{handlers: map[string]ToolHandler{}}
	r.register(&searchFilesTool{})
	r.register(&readFileTool{})
	r.register(&listFilesTool{})
	r.register(&runCommandTool{})
	r.register(&saveFileTool{})
	r.register(&gitStatusTool{})
	r.register(&gitDiffTool{})
	r.register(&manageTodoTool{})
	return r
}

func (r *ToolRegistry) register(h ToolHandler) {
	r.handlers[h.Spec().Name] = h
}

func (r *ToolRegistry) get(name string) (ToolHandler, bool) {
	h, ok := r.handlers[name]
	return h, ok
}

func (r *ToolRegistry) OpenAITools() []map[string]any {
	tools := make([]map[string]any, 0, len(r.handlers))
	names := make([]string, 0, len(r.handlers))
	for name := range r.handlers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		spec := r.handlers[name].Spec()
		tools = append(tools, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        spec.Name,
				"description": spec.Description,
				"parameters":  spec.Parameters,
			},
		})
	}
	return tools
}

func executeToolCall(ctx context.Context, svc *Service, registry *ToolRegistry, sessionID string, call ToolCall, planMode bool) ToolResult {
	if call.ID == "" {
		call.ID = fmt.Sprintf("toolcall_%d", time.Now().UnixNano())
	}
	h, ok := registry.get(call.Name)
	if !ok {
		return ToolResult{
			ToolCallID: call.ID,
			Name:       call.Name,
			Content:    "Unknown tool: " + call.Name,
			IsError:    true,
		}
	}
	if planMode && !h.AllowedInPlanMode() {
		return ToolResult{
			ToolCallID: call.ID,
			Name:       call.Name,
			Content:    "Tool not allowed in PLAN mode: " + call.Name,
			IsError:    true,
		}
	}
	out, err := h.Execute(ctx, svc, sessionID, call.Args)
	if err != nil {
		return ToolResult{
			ToolCallID: call.ID,
			Name:       call.Name,
			Content:    "Error: " + err.Error(),
			IsError:    true,
		}
	}
	return ToolResult{
		ToolCallID: call.ID,
		Name:       call.Name,
		Content:    out,
		IsError:    false,
	}
}

func buildToolCallTranscriptXML(calls []ToolCall) string {
	var b strings.Builder
	for i, c := range calls {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString("<tool_call>\n  <name>")
		b.WriteString(xmlEscape(strings.TrimSpace(c.Name)))
		b.WriteString("</name>\n  <args>\n")
		keys := make([]string, 0, len(c.Args))
		for k := range c.Args {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			v := toString(c.Args[k])
			b.WriteString("    <")
			b.WriteString(xmlEscape(k))
			b.WriteString(">")
			if strings.ContainsAny(v, "<>&") {
				b.WriteString("<![CDATA[")
				b.WriteString(strings.ReplaceAll(v, "]]>", "]]]]><![CDATA[>"))
				b.WriteString("]]>")
			} else {
				b.WriteString(xmlEscape(v))
			}
			b.WriteString("</")
			b.WriteString(xmlEscape(k))
			b.WriteString(">\n")
		}
		b.WriteString("  </args>\n</tool_call>")
	}
	return b.String()
}

func buildToolResultsTranscript(results []ToolResult) string {
	if len(results) == 0 {
		return ""
	}
	var parts []string
	for _, r := range results {
		argsJSON := "{}"
		parts = append(parts, fmt.Sprintf("STEP: execute_tool\nname: %s\ncall_id: %s\nresult:\n%s", r.Name, r.ToolCallID, r.Content))
		_ = argsJSON
	}
	return strings.Join(parts, "\n---\n")
}

func parseOpenAIToolCalls(message map[string]any) ([]ToolCall, []map[string]any, error) {
	if rawAny, ok := message["tool_calls"]; ok && rawAny != nil {
		var rawSlice []map[string]any
		switch v := rawAny.(type) {
		case []any:
			for _, item := range v {
				if m, ok := item.(map[string]any); ok {
					rawSlice = append(rawSlice, m)
				}
			}
		case []map[string]any:
			rawSlice = append(rawSlice, v...)
		default:
			return nil, nil, nil
		}

		if len(rawSlice) == 0 {
			return nil, nil, nil
		}

		calls := make([]ToolCall, 0, len(rawSlice))
		rawCalls := make([]map[string]any, 0, len(rawSlice))

		for _, m := range rawSlice {
			rawCalls = append(rawCalls, m)
			id, _ := m["id"].(string)

			fn, _ := m["function"].(map[string]any)
			name, _ := fn["name"].(string)
			argsAny := fn["arguments"]

			args := map[string]any{}
			switch a := argsAny.(type) {
			case string:
				if strings.TrimSpace(a) != "" {
					if err := json.Unmarshal([]byte(a), &args); err != nil {
						return nil, nil, fmt.Errorf("failed to parse tool arguments for %s: %w", name, err)
					}
				}
			case map[string]any:
				args = a
			case nil:
			default:
				b, err := json.Marshal(a)
				if err == nil && strings.TrimSpace(string(b)) != "" {
					_ = json.Unmarshal(b, &args)
				}
			}

			if strings.TrimSpace(name) == "" {
				continue
			}
			calls = append(calls, ToolCall{ID: id, Name: name, Args: args})
		}
		return calls, rawCalls, nil
	}

	if fcAny, ok := message["function_call"]; ok && fcAny != nil {
		if fc, ok := fcAny.(map[string]any); ok {
			name, _ := fc["name"].(string)
			argsAny := fc["arguments"]
			args := map[string]any{}
			switch a := argsAny.(type) {
			case string:
				if strings.TrimSpace(a) != "" {
					if err := json.Unmarshal([]byte(a), &args); err != nil {
						return nil, nil, fmt.Errorf("failed to parse function_call arguments for %s: %w", name, err)
					}
				}
			case map[string]any:
				args = a
			}
			if strings.TrimSpace(name) == "" {
				return nil, nil, nil
			}
			return []ToolCall{{ID: "", Name: name, Args: args}}, []map[string]any{{"function_call": fc}}, nil
		}
	}

	return nil, nil, nil
}

func parseXMLToolCallsFromText(text string) ([]ToolCall, error) {
	blocks := extractToolCallBlocks(text)
	if len(blocks) == 0 {
		return nil, nil
	}
	calls := make([]ToolCall, 0, len(blocks))
	for _, block := range blocks {
		call, err := parseToolCallBlock(block)
		if err != nil {
			return nil, err
		}
		calls = append(calls, call)
	}
	return calls, nil
}

func extractToolCallBlocks(text string) []string {
	var blocks []string
	searchFrom := 0
	for {
		start := strings.Index(text[searchFrom:], "<tool_call>")
		if start < 0 {
			break
		}
		start += searchFrom
		end := strings.Index(text[start:], "</tool_call>")
		if end < 0 {
			break
		}
		end += start + len("</tool_call>")
		blocks = append(blocks, text[start:end])
		searchFrom = end
	}
	return blocks
}

func parseToolCallBlock(block string) (ToolCall, error) {
	inner, ok := extractTagInner(block, "tool_call")
	if !ok {
		return ToolCall{}, errors.New("invalid tool_call block")
	}
	name, ok := extractTagValue(inner, "name")
	if !ok || strings.TrimSpace(name) == "" {
		return ToolCall{}, errors.New("missing tool name")
	}
	argsInner, _ := extractTagInner(inner, "args")
	argsRaw := parseArgsFirstLevel(argsInner)
	args := map[string]any{}
	for k, v := range argsRaw {
		args[k] = v
	}
	return ToolCall{
		Name: strings.TrimSpace(name),
		Args: args,
	}, nil
}

func parseArgsFirstLevel(argsInner string) map[string]string {
	out := map[string]string{}
	i := 0
	for {
		openStart := strings.Index(argsInner[i:], "<")
		if openStart < 0 {
			break
		}
		openStart += i
		if openStart+1 >= len(argsInner) {
			break
		}
		if argsInner[openStart+1] == '/' {
			i = openStart + 2
			continue
		}
		openEnd := strings.Index(argsInner[openStart:], ">")
		if openEnd < 0 {
			break
		}
		openEnd += openStart
		tagName := strings.TrimSpace(argsInner[openStart+1 : openEnd])
		if sp := strings.IndexAny(tagName, " \t\r\n"); sp >= 0 {
			tagName = tagName[:sp]
		}
		if tagName == "" {
			i = openEnd + 1
			continue
		}
		closeStart := strings.Index(argsInner[openEnd+1:], "</"+tagName+">")
		if closeStart < 0 {
			break
		}
		closeStart += openEnd + 1
		out[tagName] = argsInner[openEnd+1 : closeStart]
		i = closeStart + len("</"+tagName+">")
	}
	return out
}

func extractTagInner(s, tag string) (string, bool) {
	open := "<" + tag + ">"
	close := "</" + tag + ">"
	start := strings.Index(s, open)
	if start < 0 {
		return "", false
	}
	start += len(open)
	end := strings.Index(s[start:], close)
	if end < 0 {
		return "", false
	}
	end += start
	return s[start:end], true
}

func extractTagValue(s, tag string) (string, bool) {
	inner, ok := extractTagInner(s, tag)
	if !ok {
		return "", false
	}
	return inner, true
}

func xmlEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}

func toString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%v", t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	}
}

func requireStringArg(args map[string]any, key string) (string, error) {
	v, ok := args[key]
	if !ok || v == nil {
		return "", fmt.Errorf("missing required arg: %s", key)
	}
	s, ok := v.(string)
	if ok {
		return s, nil
	}
	return "", fmt.Errorf("arg %s must be a string", key)
}

func optionalBoolArg(args map[string]any, key string, def bool) (bool, error) {
	v, ok := args[key]
	if !ok || v == nil {
		return def, nil
	}
	switch t := v.(type) {
	case bool:
		return t, nil
	case string:
		if strings.EqualFold(strings.TrimSpace(t), "true") {
			return true, nil
		}
		if strings.EqualFold(strings.TrimSpace(t), "false") {
			return false, nil
		}
		return def, fmt.Errorf("arg %s must be true|false", key)
	default:
		return def, fmt.Errorf("arg %s must be true|false", key)
	}
}

type searchFilesTool struct{}

func (t *searchFilesTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "search_files",
		Description: "Search for files by name.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string"},
			},
			"required": []string{"query"},
			"additionalProperties": false,
		},
	}
}

func (t *searchFilesTool) AllowedInPlanMode() bool { return true }

func (t *searchFilesTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	query, err := requireStringArg(args, "query")
	if err != nil {
		return "", err
	}
	ctxTool, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	files, err := svc.FindFilesByNameContext(ctxTool, query, "", 10)
	if err != nil {
		return "", err
	}
	return strings.Join(files, "\n"), nil
}

type readFileTool struct{}

func (t *readFileTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "read_file",
		Description: "Read the content of a file.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{"type": "string"},
			},
			"required": []string{"path"},
			"additionalProperties": false,
		},
	}
}

func (t *readFileTool) AllowedInPlanMode() bool { return true }

func (t *readFileTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	path, err := requireStringArg(args, "path")
	if err != nil {
		return "", err
	}
	content, err := svc.GetFileContent(path)
	if err != nil {
		return "", err
	}
	fileContent, _ := content["content"].(string)
	if len(fileContent) > 5000 {
		fileContent = fileContent[:5000] + "... (truncated)"
	}
	return fileContent, nil
}

type listFilesTool struct{}

func (t *listFilesTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "list_files",
		Description: "List files in a directory.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{"type": "string"},
			},
			"required": []string{"path"},
			"additionalProperties": false,
		},
	}
}

func (t *listFilesTool) AllowedInPlanMode() bool { return true }

func (t *listFilesTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	path, err := requireStringArg(args, "path")
	if err != nil {
		return "", err
	}
	files, err := svc.GetFiles(path)
	if err != nil {
		return "", err
	}
	var result []string
	for _, f := range files {
		name, _ := f["name"].(string)
		typ, _ := f["type"].(string)
		result = append(result, fmt.Sprintf("%s (%s)", name, typ))
	}
	return strings.Join(result, "\n"), nil
}

type runCommandTool struct{}

func (t *runCommandTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "run_command",
		Description: "Execute a shell command.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"command": map[string]any{"type": "string"},
			},
			"required": []string{"command"},
			"additionalProperties": false,
		},
	}
}

func (t *runCommandTool) AllowedInPlanMode() bool { return false }

func (t *runCommandTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	command, err := requireStringArg(args, "command")
	if err != nil {
		return "", err
	}
	ctxTool, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	result, err := svc.RunCommandWithCwdContext(ctxTool, command, "")
	if err != nil {
		return "", fmt.Errorf("%v\nOutput: %s", err, result.Output)
	}
	return result.Output, nil
}

type saveFileTool struct{}

func (t *saveFileTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "save_file",
		Description: "Save content to a file.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path":    map[string]any{"type": "string"},
				"content": map[string]any{"type": "string"},
			},
			"required": []string{"path", "content"},
			"additionalProperties": false,
		},
	}
}

func (t *saveFileTool) AllowedInPlanMode() bool { return false }

func (t *saveFileTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	path, err := requireStringArg(args, "path")
	if err != nil {
		return "", err
	}
	content, err := requireStringArg(args, "content")
	if err != nil {
		return "", err
	}
	if err := svc.SaveFileContent(path, content); err != nil {
		return "", err
	}
	return "File saved successfully", nil
}

type gitStatusTool struct{}

func (t *gitStatusTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "git_status",
		Description: "Check git status.",
		Parameters: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}
}

func (t *gitStatusTool) AllowedInPlanMode() bool { return true }

func (t *gitStatusTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	ctxTool, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := svc.RunCommandWithCwdContext(ctxTool, "git status --short", "")
	if err != nil {
		return "", err
	}
	status := strings.TrimSpace(result.Output)
	if status == "" {
		return "Clean working tree", nil
	}
	return status, nil
}

type gitDiffTool struct{}

func (t *gitDiffTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "git_diff",
		Description: "Check git diff.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"staged": map[string]any{"type": "boolean"},
			},
			"additionalProperties": false,
		},
	}
}

func (t *gitDiffTool) AllowedInPlanMode() bool { return true }

func (t *gitDiffTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	staged, err := optionalBoolArg(args, "staged", false)
	if err != nil {
		return "", err
	}
	ctxTool, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	command := "git diff"
	if staged {
		command = "git diff --cached"
	}
	result, err := svc.RunCommandWithCwdContext(ctxTool, command, "")
	if err != nil {
		return "", err
	}
	diff := strings.TrimSpace(result.Output)
	if diff == "" {
		return "No changes", nil
	}
	return diff, nil
}

type manageTodoTool struct{}

func (t *manageTodoTool) Spec() ToolSpec {
	return ToolSpec{
		Name:        "manage_todo",
		Description: "Manage session todo list.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"action":  map[string]any{"type": "string", "enum": []string{"add", "update", "delete", "list"}},
				"content": map[string]any{"type": "string"},
				"id":      map[string]any{"type": "string"},
				"status":  map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed"}},
			},
			"required": []string{"action"},
			"additionalProperties": false,
		},
	}
}

func (t *manageTodoTool) AllowedInPlanMode() bool { return true }

func (t *manageTodoTool) Execute(ctx context.Context, svc *Service, sessionID string, args map[string]any) (string, error) {
	action, err := requireStringArg(args, "action")
	if err != nil {
		return "", err
	}
	session, err := svc.GetSession(sessionID)
	if err != nil {
		return "", errors.New("session not found")
	}
	todos := session.Todos
	if todos == nil {
		todos = []TodoItem{}
	}
	switch action {
	case "add":
		content, err := requireStringArg(args, "content")
		if err != nil {
			return "", err
		}
		newTodo := TodoItem{
			ID:       fmt.Sprintf("todo_%d", time.Now().UnixNano()),
			Content:  content,
			Status:   "pending",
			Priority: "medium",
		}
		todos = append(todos, newTodo)
		svc.UpdateSessionTodos(sessionID, todos)
		return fmt.Sprintf("Todo added: %s (ID: %s)", content, newTodo.ID), nil
	case "update":
		id, err := requireStringArg(args, "id")
		if err != nil {
			return "", err
		}
		statusAny, hasStatus := args["status"]
		status, _ := statusAny.(string)
		found := false
		for i, t := range todos {
			if t.ID == id {
				if hasStatus && strings.TrimSpace(status) != "" {
					todos[i].Status = status
				}
				found = true
				break
			}
		}
		if !found {
			return "", fmt.Errorf("todo %s not found", id)
		}
		svc.UpdateSessionTodos(sessionID, todos)
		return fmt.Sprintf("Todo updated: %s", id), nil
	case "delete":
		id, err := requireStringArg(args, "id")
		if err != nil {
			return "", err
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
			return "", fmt.Errorf("todo %s not found", id)
		}
		svc.UpdateSessionTodos(sessionID, newTodos)
		return fmt.Sprintf("Todo deleted: %s", id), nil
	case "list":
		if len(todos) == 0 {
			return "No todos in this session.", nil
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
		return strings.Join(list, "\n"), nil
	default:
		return "", errors.New("unknown action. Use add, update, delete, or list.")
	}
}
