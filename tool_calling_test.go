package main

import "testing"

func TestParseToolCallBlock_Basic(t *testing.T) {
	block := `<tool_call>
  <name>read_file</name>
  <args>
    <path>README.md</path>
  </args>
</tool_call>`

	call, err := parseToolCallBlock(block)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if call.Name != "read_file" {
		t.Fatalf("expected name read_file, got %q", call.Name)
	}
	if call.Args["path"] != "README.md" {
		t.Fatalf("expected path README.md, got %#v", call.Args["path"])
	}
}

func TestParseToolCallBlock_ContentContainsTags(t *testing.T) {
	block := `<tool_call><name>save_file</name><args><path>a.txt</path><content>hello <b>world</b></content></args></tool_call>`
	call, err := parseToolCallBlock(block)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if call.Name != "save_file" {
		t.Fatalf("expected name save_file, got %q", call.Name)
	}
	if call.Args["path"] != "a.txt" {
		t.Fatalf("expected path a.txt, got %#v", call.Args["path"])
	}
	if call.Args["content"] != "hello <b>world</b>" {
		t.Fatalf("expected content with tags preserved, got %#v", call.Args["content"])
	}
}

func TestParseXMLToolCallsFromText_Multiple(t *testing.T) {
	text := `hello
<tool_call><name>search_files</name><args><query>main</query></args></tool_call>
<tool_call><name>git_status</name><args></args></tool_call>`

	calls, err := parseXMLToolCallsFromText(text)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(calls))
	}
	if calls[0].Name != "search_files" || calls[1].Name != "git_status" {
		t.Fatalf("unexpected names: %#v", []string{calls[0].Name, calls[1].Name})
	}
}

func TestParseOpenAIToolCalls(t *testing.T) {
	msg := map[string]any{
		"tool_calls": []any{
			map[string]any{
				"id": "call_1",
				"function": map[string]any{
					"name":      "read_file",
					"arguments": `{"path":"a.txt"}`,
				},
			},
		},
	}
	calls, raw, err := parseOpenAIToolCalls(msg)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(raw) != 1 {
		t.Fatalf("expected 1 raw call, got %d", len(raw))
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(calls))
	}
	if calls[0].ID != "call_1" || calls[0].Name != "read_file" {
		t.Fatalf("unexpected call: %#v", calls[0])
	}
	if calls[0].Args["path"] != "a.txt" {
		t.Fatalf("expected path a.txt, got %#v", calls[0].Args["path"])
	}
}

func TestParseOpenAIToolCalls_FunctionCallLegacy(t *testing.T) {
	msg := map[string]any{
		"function_call": map[string]any{
			"name":      "git_diff",
			"arguments": `{"staged":true}`,
		},
	}
	calls, _, err := parseOpenAIToolCalls(msg)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(calls))
	}
	if calls[0].Name != "git_diff" {
		t.Fatalf("expected git_diff, got %q", calls[0].Name)
	}
	if calls[0].Args["staged"] != true {
		t.Fatalf("expected staged true, got %#v", calls[0].Args["staged"])
	}
}

func TestParseOpenAIToolCalls_ToolCallsSliceMap(t *testing.T) {
	msg := map[string]any{
		"tool_calls": []map[string]any{
			{
				"id": "call_2",
				"function": map[string]any{
					"name":      "search_files",
					"arguments": map[string]any{"query": "main"},
				},
			},
		},
	}
	calls, _, err := parseOpenAIToolCalls(msg)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(calls))
	}
	if calls[0].Args["query"] != "main" {
		t.Fatalf("expected query main, got %#v", calls[0].Args["query"])
	}
}
