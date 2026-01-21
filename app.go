package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

// App struct
type App struct {
	ctx     context.Context
	service *Service
	mutex   sync.Mutex
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		service: NewService(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	fmt.Println("OpenSpace 应用已启动")
}

// shutdown is called when the app is closing.
func (a *App) shutdown(ctx context.Context) {
	fmt.Println("正在关闭应用...")
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// StartOpenSpaceServer 启动服务（兼容性方法，实际不需要启动服务器）
func (a *App) StartOpenSpaceServer() {
	fmt.Println("服务已就绪（无需启动 HTTP 服务器）")
}

// StopOpenSpaceServer 停止服务（兼容性方法）
func (a *App) StopOpenSpaceServer() {
	fmt.Println("服务已停止")
}

// GetServerStatus 获取服务器状态
func (a *App) GetServerStatus() string {
	// 服务始终可用（直接调用，无需 HTTP 服务器）
	return "running"
}

// GetConfig 获取配置信息
func (a *App) GetConfig() (string, error) {
	config, err := a.service.GetConfig()
	if err != nil {
		return "", fmt.Errorf("failed to get config: %w", err)
	}
	data, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("failed to marshal config: %w", err)
	}
	return string(data), nil
}

// UpdateConfig 更新配置
func (a *App) UpdateConfig(configData string) (string, error) {
	if configData == "" {
		return "", fmt.Errorf("config data cannot be empty")
	}
	config, err := a.service.UpdateConfig(configData)
	if err != nil {
		return "", fmt.Errorf("failed to update config: %w", err)
	}
	data, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("failed to marshal updated config: %w", err)
	}
	return string(data), nil
}

// GetProviders 获取提供者和默认模型
func (a *App) GetProviders() (string, error) {
	providers, err := a.service.GetProviders()
	if err != nil {
		return "", fmt.Errorf("failed to get providers: %w", err)
	}
	data, err := json.Marshal(providers)
	if err != nil {
		return "", fmt.Errorf("failed to marshal providers: %w", err)
	}
	return string(data), nil
}

// ListProviders 获取所有提供者列表
func (a *App) ListProviders() (string, error) {
	providers, err := a.service.ListProviders()
	if err != nil {
		return "", fmt.Errorf("failed to list providers: %w", err)
	}
	data, err := json.Marshal(providers)
	if err != nil {
		return "", fmt.Errorf("failed to marshal providers list: %w", err)
	}
	return string(data), nil
}

// GetProviderAuth 获取提供者认证方法
func (a *App) GetProviderAuth() (string, error) {
	auth, err := a.service.GetProviderAuth()
	if err != nil {
		return "", fmt.Errorf("failed to get provider auth: %w", err)
	}
	data, err := json.Marshal(auth)
	if err != nil {
		return "", fmt.Errorf("failed to marshal auth data: %w", err)
	}
	return string(data), nil
}

// GetProjects 获取所有项目
func (a *App) GetProjects() (string, error) {
	projects, err := a.service.GetProjects()
	if err != nil {
		return "", fmt.Errorf("failed to get projects: %w", err)
	}
	data, err := json.Marshal(projects)
	if err != nil {
		return "", fmt.Errorf("failed to marshal projects: %w", err)
	}
	return string(data), nil
}

// GetCurrentProject 获取当前项目
func (a *App) GetCurrentProject() (string, error) {
	project, err := a.service.GetCurrentProject()
	if err != nil {
		return "", fmt.Errorf("failed to get current project: %w", err)
	}
	data, err := json.Marshal(project)
	if err != nil {
		return "", fmt.Errorf("failed to marshal project: %w", err)
	}
	return string(data), nil
}

// GetVCSInfo 获取 VCS 信息
func (a *App) GetVCSInfo() (string, error) {
	vcs, err := a.service.GetVCSInfo()
	if err != nil {
		return "", fmt.Errorf("failed to get VCS info: %w", err)
	}
	data, err := json.Marshal(vcs)
	if err != nil {
		return "", fmt.Errorf("failed to marshal VCS info: %w", err)
	}
	return string(data), nil
}

// GetPath 获取当前路径
func (a *App) GetPath() (string, error) {
	path, err := a.service.GetPath()
	if err != nil {
		return "", fmt.Errorf("failed to get path info: %w", err)
	}
	data, err := json.Marshal(path)
	if err != nil {
		return "", fmt.Errorf("failed to marshal path info: %w", err)
	}
	return string(data), nil
}

// GetSessions 获取所有会话
func (a *App) GetSessions() (string, error) {
	sessions, err := a.service.GetSessions()
	if err != nil {
		return "", fmt.Errorf("failed to get sessions: %w", err)
	}
	data, err := json.Marshal(sessions)
	if err != nil {
		return "", fmt.Errorf("failed to marshal sessions: %w", err)
	}
	return string(data), nil
}

// GetSessionStatus 获取所有会话状态
func (a *App) GetSessionStatus() (string, error) {
	status, err := a.service.GetSessionStatus()
	if err != nil {
		return "", fmt.Errorf("failed to get session status: %w", err)
	}
	data, err := json.Marshal(status)
	if err != nil {
		return "", fmt.Errorf("failed to marshal session status: %w", err)
	}
	return string(data), nil
}

// GetSessionDetails 获取会话详情
func (a *App) GetSessionDetails(sessionID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	session, err := a.service.GetSession(sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to get session details: %w", err)
	}
	data, err := json.Marshal(session)
	if err != nil {
		return "", fmt.Errorf("failed to marshal session: %w", err)
	}
	return string(data), nil
}

// GetSessionMessages 获取会话消息
func (a *App) GetSessionMessages(sessionID string, limit string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}

	limitInt := 0
	if limit != "" {
		var parsed int
		_, err := fmt.Sscanf(limit, "%d", &parsed)
		if err != nil {
			return "", fmt.Errorf("invalid limit parameter: %w", err)
		}
		limitInt = parsed
	}

	messages, err := a.service.GetSessionMessages(sessionID, limitInt)
	if err != nil {
		return "", fmt.Errorf("failed to get session messages: %w", err)
	}
	data, err := json.Marshal(messages)
	if err != nil {
		return "", fmt.Errorf("failed to marshal messages: %w", err)
	}
	return string(data), nil
}

// GetSessionChildren 获取子会话
func (a *App) GetSessionChildren(sessionID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	children, err := a.service.GetSessionChildren(sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to get session children: %w", err)
	}
	data, err := json.Marshal(children)
	if err != nil {
		return "", fmt.Errorf("failed to marshal children: %w", err)
	}
	return string(data), nil
}

// GetSessionTodo 获取待办事项
func (a *App) GetSessionTodo(sessionID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	todos, err := a.service.GetSessionTodo(sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to get session todos: %w", err)
	}
	data, err := json.Marshal(todos)
	if err != nil {
		return "", fmt.Errorf("failed to marshal todos: %w", err)
	}
	return string(data), nil
}

// GetSessionDiff 获取会话差异
func (a *App) GetSessionDiff(sessionID string, messageID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	diff, err := a.service.GetSessionDiff(sessionID, messageID)
	if err != nil {
		return "", fmt.Errorf("failed to get session diff: %w", err)
	}
	data, err := json.Marshal(diff)
	if err != nil {
		return "", fmt.Errorf("failed to marshal diff: %w", err)
	}
	return string(data), nil
}

// CreateSession 创建新会话
func (a *App) CreateSession(title string, parentID string) (string, error) {
	if title == "" {
		title = "New Session"
	}
	session, err := a.service.CreateSession(title, parentID)
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	data, err := json.Marshal(session)
	if err != nil {
		return "", fmt.Errorf("failed to marshal session: %w", err)
	}
	return string(data), nil
}

// DeleteSession 删除会话
func (a *App) DeleteSession(sessionID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	err := a.service.DeleteSession(sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to delete session: %w", err)
	}
	return `{"success": true}`, nil
}

// UpdateSession 更新会话
func (a *App) UpdateSession(sessionID string, title string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	if title == "" {
		return "", fmt.Errorf("title cannot be empty")
	}
	session, err := a.service.UpdateSession(sessionID, title)
	if err != nil {
		return "", fmt.Errorf("failed to update session: %w", err)
	}
	data, err := json.Marshal(session)
	if err != nil {
		return "", fmt.Errorf("failed to marshal session: %w", err)
	}
	return string(data), nil
}

// SendMessage 发送消息到会话
func (a *App) SendMessage(sessionID string, message string, model string, agent string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	if message == "" {
		return "", fmt.Errorf("message cannot be empty")
	}
	response, err := a.service.SendMessage(sessionID, message, model, agent)
	if err != nil {
		return "", fmt.Errorf("failed to send message: %w", err)
	}
	data, err := json.Marshal(response)
	if err != nil {
		return "", fmt.Errorf("failed to marshal response: %w", err)
	}
	return string(data), nil
}

// SendMessageAsync 异步发送消息
func (a *App) SendMessageAsync(sessionID string, message string, model string, agent string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	if message == "" {
		return "", fmt.Errorf("message cannot be empty")
	}

	// Use the service's async method
	processingID, err := a.service.SendMessageAsync(sessionID, message, model, agent)
	if err != nil {
		return "", fmt.Errorf("failed to send async message: %w", err)
	}

	return fmt.Sprintf(`{"processingId": "%s", "status": "processing"}`, processingID), nil
}

// AbortSession 中断会话
func (a *App) AbortSession(sessionID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	
	// Call service cancellation
	a.service.CancelSession(sessionID)
	
	return `{"success": true}`, nil
}

// SummarizeSession 总结会话
func (a *App) SummarizeSession(sessionID string, providerID string, modelID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	if providerID == "" {
		return "", fmt.Errorf("provider ID cannot be empty")
	}
	if modelID == "" {
		return "", fmt.Errorf("model ID cannot be empty")
	}

	summary, err := a.service.SummarizeSession(sessionID, providerID, modelID)
	if err != nil {
		return "", fmt.Errorf("failed to summarize session: %w", err)
	}
	data, err := json.Marshal(summary)
	if err != nil {
		return "", fmt.Errorf("failed to marshal summary: %w", err)
	}
	return string(data), nil
}

// GetFiles 获取文件列表
func (a *App) GetFiles(path string) (string, error) {
	files, err := a.service.GetFiles(path)
	if err != nil {
		return "", fmt.Errorf("failed to get files: %w", err)
	}
	data, err := json.Marshal(files)
	if err != nil {
		return "", fmt.Errorf("failed to marshal files: %w", err)
	}
	return string(data), nil
}

// FindFilesByName 按名称查找文件
func (a *App) FindFilesByName(query string, fileType string, limit int) (string, error) {
	if query == "" {
		return "", fmt.Errorf("query cannot be empty")
	}
	if limit < 0 {
		return "", fmt.Errorf("limit must be non-negative")
	}
	results, err := a.service.FindFilesByName(query, fileType, limit)
	if err != nil {
		return "", fmt.Errorf("failed to find files: %w", err)
	}
	data, err := json.Marshal(results)
	if err != nil {
		return "", fmt.Errorf("failed to marshal results: %w", err)
	}
	return string(data), nil
}

// FindText 搜索文本
func (a *App) FindText(pattern string) (string, error) {
	if pattern == "" {
		return "", fmt.Errorf("pattern cannot be empty")
	}
	results, err := a.service.FindText(pattern)
	if err != nil {
		return "", fmt.Errorf("failed to find text: %w", err)
	}
	data, err := json.Marshal(results)
	if err != nil {
		return "", fmt.Errorf("failed to marshal results: %w", err)
	}
	return string(data), nil
}

// FindSymbol 查找符号
func (a *App) FindSymbol(query string) (string, error) {
	if query == "" {
		return "", fmt.Errorf("query cannot be empty")
	}
	results, err := a.service.FindSymbol(query)
	if err != nil {
		return "", fmt.Errorf("failed to find symbol: %w", err)
	}
	data, err := json.Marshal(results)
	if err != nil {
		return "", fmt.Errorf("failed to marshal results: %w", err)
	}
	return string(data), nil
}

// GetFileStatus 获取文件状态
func (a *App) GetFileStatus() (string, error) {
	status, err := a.service.GetFileStatus()
	if err != nil {
		return "", fmt.Errorf("failed to get file status: %w", err)
	}
	data, err := json.Marshal(status)
	if err != nil {
		return "", fmt.Errorf("failed to marshal status: %w", err)
	}
	return string(data), nil
}

// GetFileContent 获取文件内容
func (a *App) GetFileContent(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path cannot be empty")
	}
	content, err := a.service.GetFileContent(path)
	if err != nil {
		return "", fmt.Errorf("failed to get file content: %w", err)
	}
	data, err := json.Marshal(content)
	if err != nil {
		return "", fmt.Errorf("failed to marshal content: %w", err)
	}
	return string(data), nil
}

// SaveFileContent 保存文件内容
func (a *App) SaveFileContent(path string, content string) error {
	if path == "" {
		return fmt.Errorf("path cannot be empty")
	}
	if content == "" {
		return fmt.Errorf("content cannot be empty")
	}

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	return os.WriteFile(path, []byte(content), 0644)
}

// RunCommand 执行系统命令
func (a *App) RunCommand(command string) (string, error) {
	if command == "" {
		return "", fmt.Errorf("command cannot be empty")
	}
	output, err := a.service.RunCommand(command)
	if err != nil {
		return output, fmt.Errorf("failed to run command: %w", err)
	}
	return output, nil
}

func (a *App) RunCommandDetailed(command string) (string, error) {
	if command == "" {
		return "", fmt.Errorf("command cannot be empty")
	}

	output, err := a.service.RunCommand(command)
	result := map[string]interface{}{
		"success": err == nil,
		"output":  output,
	}
	if err != nil {
		result["error"] = err.Error()
	}

	data, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		return "", fmt.Errorf("failed to marshal command result: %w", marshalErr)
	}
	return string(data), nil
}

func (a *App) RunCommandDetailedWithCwd(command string, cwd string) (string, error) {
	if command == "" {
		return "", fmt.Errorf("command cannot be empty")
	}

	runResult, err := a.service.RunCommandWithCwd(command, cwd)
	result := map[string]interface{}{
		"success":  err == nil,
		"output":   runResult.Output,
		"cwd":      runResult.Cwd,
		"shell":    runResult.Shell,
		"branch":   runResult.Branch,
		"exitCode": runResult.ExitCode,
	}
	if err != nil {
		result["error"] = err.Error()
	}

	data, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		return "", fmt.Errorf("failed to marshal command result: %w", marshalErr)
	}
	return string(data), nil
}

// GetAgents 获取代理列表
func (a *App) GetAgents() (string, error) {
	agents, err := a.service.GetAgents()
	if err != nil {
		return "", fmt.Errorf("failed to get agents: %w", err)
	}
	data, err := json.Marshal(agents)
	if err != nil {
		return "", fmt.Errorf("failed to marshal agents: %w", err)
	}
	return string(data), nil
}

// GetCommands 获取命令列表
func (a *App) GetCommands() (string, error) {
	commands, err := a.service.GetCommands()
	if err != nil {
		return "", fmt.Errorf("failed to get commands: %w", err)
	}
	data, err := json.Marshal(commands)
	if err != nil {
		return "", fmt.Errorf("failed to marshal commands: %w", err)
	}
	return string(data), nil
}

// SubmitPrompt 提交 TUI 提示
func (a *App) SubmitPrompt() (string, error) {
	// Simplified - return success for now
	return `{"success": true}`, nil
}

// ClearPrompt 清空 TUI 提示
func (a *App) ClearPrompt() (string, error) {
	// Simplified - return success for now
	return `{"success": true}`, nil
}

// RestartServer 重启服务器（兼容性方法）
func (a *App) RestartServer() error {
	// No-op since we don't have a server to restart
	return nil
}

// OpenCurrentDirectory 打开当前目录
func (a *App) OpenCurrentDirectory() error {
	// 获取当前工作目录
	currentDir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("获取当前目录失败: %w", err)
	}

	fmt.Printf("正在打开目录: %s\n", currentDir)

	// 根据操作系统打开文件管理器
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", currentDir)
	case "darwin":
		cmd = exec.Command("open", currentDir)
	case "linux":
		cmd = exec.Command("xdg-open", currentDir)
	default:
		return fmt.Errorf("不支持的操作系统: %s", runtime.GOOS)
	}

	// 启动命令
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("打开目录失败: %w", err)
	}

	fmt.Println("目录打开成功")
	return nil
}
