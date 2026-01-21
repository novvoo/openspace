package main

import (
	"encoding/json"
	"fmt"
)

// GetCustomLLMServices 获取所有自定义LLM服务
func (a *App) GetCustomLLMServices() (string, error) {
	services, err := a.service.GetCustomLLMServices()
	if err != nil {
		return "", fmt.Errorf("failed to get custom LLM services: %w", err)
	}
	data, err := json.Marshal(services)
	if err != nil {
		return "", fmt.Errorf("failed to marshal services: %w", err)
	}
	return string(data), nil
}

// AddCustomLLMService 添加新的自定义LLM服务
func (a *App) AddCustomLLMService(configData string) (string, error) {
	if configData == "" {
		return "", fmt.Errorf("config data cannot be empty")
	}
	service, err := a.service.AddCustomLLMService(configData)
	if err != nil {
		return "", fmt.Errorf("failed to add custom LLM service: %w", err)
	}
	data, err := json.Marshal(service)
	if err != nil {
		return "", fmt.Errorf("failed to marshal service: %w", err)
	}
	return string(data), nil
}

// UpdateCustomLLMService 更新自定义LLM服务
func (a *App) UpdateCustomLLMService(serviceID string, configData string) (string, error) {
	if serviceID == "" {
		return "", fmt.Errorf("service ID cannot be empty")
	}
	if configData == "" {
		return "", fmt.Errorf("config data cannot be empty")
	}
	service, err := a.service.UpdateCustomLLMService(serviceID, configData)
	if err != nil {
		return "", fmt.Errorf("failed to update custom LLM service: %w", err)
	}
	data, err := json.Marshal(service)
	if err != nil {
		return "", fmt.Errorf("failed to marshal service: %w", err)
	}
	return string(data), nil
}

// DeleteCustomLLMService 删除自定义LLM服务
func (a *App) DeleteCustomLLMService(serviceID string) (string, error) {
	if serviceID == "" {
		return "", fmt.Errorf("service ID cannot be empty")
	}
	err := a.service.DeleteCustomLLMService(serviceID)
	if err != nil {
		return "", fmt.Errorf("failed to delete custom LLM service: %w", err)
	}
	return `{"success": true}`, nil
}

// TestCustomLLMService 测试自定义LLM服务
func (a *App) TestCustomLLMService(configData string) (string, error) {
	if configData == "" {
		return "", fmt.Errorf("config data cannot be empty")
	}
	result, err := a.service.TestCustomLLMService(configData)
	if err != nil {
		return "", fmt.Errorf("failed to test custom LLM service: %w", err)
	}
	data, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to marshal test result: %w", err)
	}
	return string(data), nil
}

// SendCustomLLMMessage 发送消息到自定义LLM服务
func (a *App) SendCustomLLMMessage(sessionID string, message string, serviceID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("session ID cannot be empty")
	}
	if message == "" {
		return "", fmt.Errorf("message cannot be empty")
	}
	if serviceID == "" {
		return "", fmt.Errorf("service ID cannot be empty")
	}
	response, err := a.service.SendCustomLLMMessage(nil, sessionID, message, serviceID)
	if err != nil {
		return "", fmt.Errorf("failed to send message to custom LLM service: %w", err)
	}
	data, err := json.Marshal(response)
	if err != nil {
		return "", fmt.Errorf("failed to marshal response: %w", err)
	}
	return string(data), nil
}
