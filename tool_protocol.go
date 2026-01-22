package main

import "strings"

func resolveToolCallingMode(cfg CustomLLMService) string {
	mode := strings.ToLower(strings.TrimSpace(cfg.ToolCalling))
	switch mode {
	case "native":
		if cfg.Provider == "anthropic" {
			return "xml"
		}
		return "native"
	case "xml":
		return "xml"
	case "auto", "":
	default:
	}
	if cfg.Provider == "openai" {
		return "native"
	}
	return "xml"
}

