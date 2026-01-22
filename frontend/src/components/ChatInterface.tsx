import React, { useState, useEffect, useRef } from 'react';
import { 
    Box, Paper, Typography, TextField, IconButton, List, ListItem, 
    Avatar, Tooltip, CircularProgress, Divider, Button, Chip, Menu, MenuItem
} from '@mui/material';
import { 
    Send as SendIcon, 
    Stop as StopIcon, 
    Description as FileIcon, 
    SmartToy as BotIcon,
    Person as PersonIcon,
    ContentCopy as CopyIcon,
    Terminal as TerminalIcon,
    Architecture as PlanIcon,
    Build as ActIcon,
    BugReport as DebugIcon
} from '@mui/icons-material';
import { GetSessionMessages, SendMessage, AbortSession, SummarizeSession, GetProviders, GetAgents, FindFilesByName, RunCommandDetailed } from '../../wailsjs/go/main/App';

// --- Interfaces ---

interface ChatInterfaceProps {
    sessionId: string | null;
    onOpenFile?: (path: string) => void;
    onToggleTerminal?: () => void;
}

interface Message {
    id?: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    timestamp: Date;
    model?: string;
    searchResults?: any[]; // For search command results
    rawRequest?: string;
    rawResponse?: string;
    rawTurns?: any[];
}

interface Model {
    id: string;
    name: string;
    provider: string;
}

// --- Helper Components ---

const CodeBlock: React.FC<{ code: string; language?: string; onApply?: () => void }> = ({ code, language, onApply }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Paper elevation={0} sx={{ bgcolor: 'var(--code-bg)', borderRadius: 2, overflow: 'hidden', my: 1, border: '1px solid var(--border-color)', color: 'inherit' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 0.5, bgcolor: 'var(--code-header-bg)', borderBottom: '1px solid var(--border-color)' }}>
                <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                    {language || 'text'}
                </Typography>
                <Box>
                    <Tooltip title={copied ? "Copied!" : "Copy Code"}>
                        <IconButton size="small" onClick={handleCopy} sx={{ color: copied ? 'var(--success)' : 'var(--text-secondary)' }}>
                            <CopyIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {onApply && (
                        <Button size="small" variant="text" sx={{ ml: 1, color: 'var(--accent-color)', fontSize: '0.7rem' }} onClick={onApply}>
                            Apply
                        </Button>
                    )}
                </Box>
            </Box>
            <Box sx={{ p: 2, overflowX: 'auto' }}>
                <pre style={{ margin: 0, fontFamily: "'Fira Code', monospace", fontSize: '0.9rem', color: 'var(--code-text)' }}>
                    {code}
                </pre>
            </Box>
        </Paper>
    );
};

const MessageRenderer: React.FC<{ text: string; onOpenFile?: (path: string) => void; allowDebug?: boolean }> = ({ text, onOpenFile, allowDebug }) => {
    const [showDebug, setShowDebug] = useState(false);
    const [cleanText, setCleanText] = useState('');
    const [debugInfos, setDebugInfos] = useState<string[]>([]);

    useEffect(() => {
        // Extract debug info and clean text
        // Handle both standard XML tags and HTML-escaped tags just in case
        const debugRegex = /(?:<|&lt;)debug_info(?:>|&gt;)([\s\S]*?)(?:<|&lt;)\/debug_info(?:>|&gt;)/g;
        const infos: string[] = [];
        let newText = text;
        let match;
        
        while ((match = debugRegex.exec(text)) !== null) {
            // Unescape content if it looks escaped
            let content = match[1];
            if (content.includes('&quot;') || content.includes('&lt;')) {
                const doc = new DOMParser().parseFromString(content, "text/html");
                content = doc.documentElement.textContent || content;
            }
            infos.push(content);
        }
        
        newText = text.replace(debugRegex, '').trim();
        
        setCleanText(newText);
        setDebugInfos(allowDebug ? infos : []);
        if (!allowDebug) setShowDebug(false);
    }, [text, allowDebug]);

    const unwrapCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

    const parseArgsFirstLevel = (argsInner: string): Record<string, string> => {
        const out: Record<string, string> = {};
        let i = 0;
        while (i < argsInner.length) {
            const openStartRel = argsInner.indexOf('<', i);
            if (openStartRel === -1) break;
            const openStart = openStartRel;
            if (openStart + 1 >= argsInner.length) break;
            if (argsInner[openStart + 1] === '/') {
                i = openStart + 2;
                continue;
            }
            const openEnd = argsInner.indexOf('>', openStart);
            if (openEnd === -1) break;
            let tagName = argsInner.slice(openStart + 1, openEnd).trim();
            const spaceIdx = tagName.search(/[ \t\r\n]/);
            if (spaceIdx >= 0) tagName = tagName.slice(0, spaceIdx);
            if (!tagName) {
                i = openEnd + 1;
                continue;
            }
            const closeTag = `</${tagName}>`;
            const closeStart = argsInner.indexOf(closeTag, openEnd + 1);
            if (closeStart === -1) break;
            const value = argsInner.slice(openEnd + 1, closeStart);
            out[tagName] = unwrapCdata(value);
            i = closeStart + closeTag.length;
        }
        return out;
    };

    const extractTagInner = (s: string, tag: string) => {
        const open = `<${tag}>`;
        const close = `</${tag}>`;
        const start = s.indexOf(open);
        if (start === -1) return null;
        const innerStart = start + open.length;
        const end = s.indexOf(close, innerStart);
        if (end === -1) return null;
        return s.slice(innerStart, end);
    };

    const parseToolCallXml = (toolXmlInner: string) => {
        const name = (/<name>([\s\S]*?)<\/name>/.exec(toolXmlInner)?.[1] || '').trim() || 'Unknown Tool';
        const argsInner = extractTagInner(toolXmlInner, 'args') || '';
        const args = parseArgsFirstLevel(argsInner);
        return { name, args };
    };

    const parseToolResults = (toolResultsText: string) => {
        const blocks = toolResultsText.split('\n---\n').map(b => b.trim()).filter(Boolean);
        return blocks.map((b) => {
            const name = (/^name:\s*(.*)$/m.exec(b)?.[1] || '').trim();
            const callId = (/^call_id:\s*(.*)$/m.exec(b)?.[1] || '').trim();
            const argsMatch = /^args:\s*([\s\S]*?)\nresult:\n/m.exec(b);
            const args = argsMatch ? argsMatch[1].trim() : '';
            const result = /result:\n([\s\S]*)$/.exec(b)?.[1]?.trim() || '';
            return { name, callId, args, result, raw: b };
        });
    };

    // Regex for tool execution (on clean text)
    const renderContent = (content: string) => {
        const elements = [];
        let currentIndex = 0;
        
        const regex = /```(\w+)?\n([\s\S]*?)```|<tool_call>([\s\S]*?)<\/tool_call>|<tool_results>([\s\S]*?)<\/tool_results>|<tool_code>([\s\S]*?)<\/tool_code>(?:\s*<tool_result>([\s\S]*?)<\/tool_result>)?/g;
        
        let match;
        while ((match = regex.exec(content)) !== null) {
            // Text before match
            if (match.index > currentIndex) {
                elements.push(renderText(content.substring(currentIndex, match.index), currentIndex));
            }
            
            if (match[0].startsWith('```')) {
                // Code block
                elements.push(
                    <CodeBlock 
                        key={match.index} 
                        language={match[1]} 
                        code={match[2]} 
                    />
                );
            } else if (match[3]) {
                // Tool Call
                const toolXml = match[3];
                const parsed = parseToolCallXml(toolXml);
                const toolName = parsed.name;
                const args = parsed.args;
                const pathArg = args['path'];

                elements.push(
                    <Paper key={match.index} elevation={0} sx={{ my: 1, border: '1px solid var(--border-color)', bgcolor: 'var(--code-bg)', borderRadius: 1, color: 'inherit' }}>
                        <Box sx={{ px: 2, py: 1, bgcolor: 'var(--code-header-bg)', display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <TerminalIcon fontSize="small" sx={{ color: 'var(--accent-color)' }} />
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 'bold' }}>
                                Tool Call: {toolName}
                            </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {Object.keys(args).length > 0 && (
                                    <Chip size="small" label={`${Object.keys(args).length} args`} sx={{ fontFamily: 'monospace' }} />
                                )}
                                {onOpenFile && pathArg && (toolName === 'read_file' || toolName === 'save_file') && (
                                    <Button size="small" variant="text" sx={{ color: 'var(--accent-color)', fontSize: '0.7rem' }} onClick={() => onOpenFile(pathArg)}>
                                        Open
                                    </Button>
                                )}
                            </Box>
                        </Box>
                        <Box sx={{ p: 2, maxHeight: '240px', overflow: 'auto' }}>
                            {Object.keys(args).length > 0 ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                    {Object.entries(args).map(([k, v]) => (
                                        <Box key={k} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-secondary)', minWidth: '90px' }}>
                                                {k}
                                            </Typography>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
                                                {v}
                                            </Typography>
                                        </Box>
                                    ))}
                                </Box>
                            ) : (
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                                    (no args)
                                </Typography>
                            )}
                        </Box>
                    </Paper>
                );
            } else if (match[4]) {
                // Tool Results
                const toolResults = match[4];
                const parsed = parseToolResults(toolResults);
                elements.push(
                    <Paper key={match.index} elevation={0} sx={{ my: 1, border: '1px dashed var(--success)', bgcolor: 'rgba(76, 175, 80, 0.05)', borderRadius: 1, color: 'inherit' }}>
                        <Box sx={{ px: 2, py: 1, borderBottom: '1px dashed var(--success)', display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TerminalIcon fontSize="small" sx={{ color: 'var(--success)' }} />
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--success)', fontWeight: 'bold' }}>
                                Tool Execution Results
                            </Typography>
                            </Box>
                            {parsed.length > 0 && <Chip size="small" label={`${parsed.length} step`} sx={{ fontFamily: 'monospace' }} />}
                        </Box>
                        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {parsed.length > 0 ? parsed.map((r, idx) => (
                                <Paper key={idx} elevation={0} sx={{ border: '1px solid var(--border-color)', bgcolor: 'var(--code-bg)', borderRadius: 1, overflow: 'hidden', color: 'inherit' }}>
                                    <Box sx={{ px: 2, py: 1, bgcolor: 'var(--code-header-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 'bold' }}>
                                            {r.name || 'tool'}{r.callId ? `  (${r.callId})` : ''}
                                        </Typography>
                                        {r.args && <Chip size="small" label="args" sx={{ fontFamily: 'monospace' }} />}
                                    </Box>
                                    <Box sx={{ p: 2, maxHeight: '240px', overflow: 'auto' }}>
                                        {r.args && (
                                            <Box sx={{ mb: 1 }}>
                                                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                                                    args
                                                </Typography>
                                                <pre style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                                    {r.args}
                                                </pre>
                                            </Box>
                                        )}
                                        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                                            result
                                        </Typography>
                                        <pre style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                            {r.result || r.raw}
                                        </pre>
                                    </Box>
                                </Paper>
                            )) : (
                                <Box sx={{ maxHeight: '200px', overflow: 'auto' }}>
                                    <pre style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                                        {toolResults.trim()}
                                    </pre>
                                </Box>
                            )}
                        </Box>
                    </Paper>
                );
            } else if (match[5]) {
                // Legacy Tool
                const toolCode = match[5];
                const toolResult = match[6];
                
                elements.push(
                    <Paper key={match.index} elevation={0} sx={{ my: 1, border: '1px dashed var(--border-color)', bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1, color: 'inherit' }}>
                        <Box sx={{ px: 2, py: 1, borderBottom: toolResult ? '1px dashed var(--border-color)' : 'none', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TerminalIcon fontSize="small" color="action" />
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                                Executed: {toolCode}
                            </Typography>
                        </Box>
                        {toolResult && (
                            <Box sx={{ p: 2, bgcolor: 'var(--code-bg)', maxHeight: '200px', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                                    {toolResult.trim()}
                                </pre>
                            </Box>
                        )}
                    </Paper>
                );
            }
            
            currentIndex = match.index + match[0].length;
        }
        
        // Remaining text
        if (currentIndex < content.length) {
            elements.push(renderText(content.substring(currentIndex), currentIndex));
        }
        
        return elements;
    };

    const renderText = (text: string, keyPrefix: number) => {
        // ... (existing renderText logic)
        // Process links [text](url)
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const parts = [];
        let lastIdx = 0;
        let match;
        
        while ((match = linkRegex.exec(text)) !== null) {
            if (match.index > lastIdx) {
                parts.push(text.substring(lastIdx, match.index));
            }
            
            const label = match[1];
            const url = match[2];
            
            parts.push(
                <span 
                    key={keyPrefix + match.index} 
                    style={{ 
                        color: 'var(--accent-color)', 
                        cursor: 'pointer', 
                        textDecoration: 'underline' 
                    }}
                    onClick={() => {
                        if (onOpenFile) {
                            const path = url.replace('file://', '');
                            onOpenFile(path);
                        }
                    }}
                >
                    {label}
                </span>
            );
            
            lastIdx = match.index + match[0].length;
        }
        
        if (lastIdx < text.length) {
            parts.push(text.substring(lastIdx));
        }
        
        return <span key={keyPrefix} style={{ whiteSpace: 'pre-wrap' }}>{parts}</span>;
    };

    return (
        <div style={{ lineHeight: 1.6 }}>
            {renderContent(cleanText)}
            
            {allowDebug && debugInfos.length > 0 && (
                <Box sx={{ mt: 2, pt: 1, borderTop: '1px solid var(--border-color)' }}>
                    <Button 
                        size="small" 
                        startIcon={<DebugIcon />} 
                        onClick={() => setShowDebug(!showDebug)}
                        sx={{ textTransform: 'none', color: 'var(--text-secondary)', fontSize: '0.7rem' }}
                    >
                        {showDebug ? `Hide Debug Info (${debugInfos.length})` : `Show Debug Info (${debugInfos.length})`}
                    </Button>
                    {showDebug && debugInfos.map((info, idx) => (
                        <Paper key={idx} elevation={0} sx={{ mt: 1, border: '1px solid var(--border-color)', bgcolor: 'var(--bg-secondary)', borderRadius: 1 }}>
                            <Box sx={{ p: 2, maxHeight: '300px', overflow: 'auto' }}>
                                <pre style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                    {info.trim()}
                                </pre>
                            </Box>
                        </Paper>
                    ))}
                </Box>
            )}
        </div>
    );
};

// --- Main Component ---

const ChatInterface: React.FC<ChatInterfaceProps> = ({ sessionId, onOpenFile, onToggleTerminal }) => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [rawOpenById, setRawOpenById] = useState<Record<string, boolean>>({});
    const [showRawEnabled, setShowRawEnabled] = useState<boolean>(() => {
        try {
            const savedV3 = localStorage.getItem('openspace.showRaw.v3');
            if (savedV3 === null) return true;
            return savedV3 === 'true';
        } catch {
            return true;
        }
    });
    
    const [, setModelStatus] = useState<'idle' | 'processing' | 'error'>('idle');
    const [models, setModels] = useState<Model[]>([]);
    const [selectedModel, setSelectedModel] = useState('');
    
    const [, setAgents] = useState<any[]>([]);
    const [selectedAgent, setSelectedAgent] = useState('');
    const [mode, setMode] = useState<'plan' | 'act'>('act');
    
    // Model menu
    const [modelAnchorEl, setModelAnchorEl] = useState<null | HTMLElement>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        try {
            localStorage.setItem('openspace.showRaw.v3', showRawEnabled ? 'true' : 'false');
        } catch {}
    }, [showRawEnabled]);

    const splitProviderModel = (value: string) => {
        if (value.includes('::')) {
            const [providerId, modelId] = value.split('::', 2);
            return { providerId: providerId || '', modelId: modelId || '' };
        }
        if (value.includes(':')) {
            const [providerId, modelId] = value.split(':', 2);
            return { providerId: providerId || '', modelId: modelId || '' };
        }
        return { providerId: '', modelId: value };
    };

    // Initial Load
    useEffect(() => {
        loadConfig();
    }, []);

    useEffect(() => {
        if (sessionId) {
            loadHistory(sessionId);
        }
    }, [sessionId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    const loadConfig = async () => {
        try {
            const modelsData = await GetProviders();
            const parsedModels = JSON.parse(modelsData);
            // ... parsing logic (simplified for brevity) ...
             const modelsList: Model[] = [];
            if (parsedModels.providers) {
                 parsedModels.providers.forEach((p: any) => {
                     const providerId = p.id || '';
                     const pName = p.name || providerId;
                     if (p.models) {
                         Object.values(p.models).forEach((m: any) => {
                             const modelId = m.id || '';
                             const compositeId = providerId && modelId ? `${providerId}::${modelId}` : (modelId || providerId);
                             const displayName = `${pName}: ${m.name || modelId || compositeId}`;
                             modelsList.push({ id: compositeId, name: displayName, provider: pName });
                         });
                     }
                 });
            }
            setModels(modelsList);
            if (modelsList.length > 0) setSelectedModel(modelsList[0].id);

            const agentsData = await GetAgents();
            const parsedAgents = JSON.parse(agentsData);
            setAgents(parsedAgents || []);
            if (parsedAgents?.length > 0) setSelectedAgent(parsedAgents[0].id);

        } catch (e) {
            console.error("Config load failed", e);
        }
    };

    const loadHistory = async (sid: string) => {
        setLoading(true);
        try {
            const data = await GetSessionMessages(sid, "50");
            const parsed = JSON.parse(data);
            const history: Message[] = parsed.map((item: any) => ({
                id: item.info?.id,
                role: item.info?.role || 'user',
                text: item.parts?.[0]?.text || '',
                timestamp: new Date(item.info?.createdAt || Date.now()),
                model: item.info?.model,
                rawRequest: item.info?.rawRequest,
                rawResponse: item.info?.rawResponse,
                rawTurns: item.info?.rawTurns
            }));
            setMessages(history);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // --- Command Execution ---

    const executeCommand = async (cmd: string, args: string) => {
        // Handle client-side commands
        if (cmd === 'search') {
            setLoading(true);
            try {
                // Try FindFiles first
                const filesData = await FindFilesByName(args, "", 10);
                const files = JSON.parse(filesData);
                
                const searchMsg: Message = {
                    role: 'system',
                    text: `Search results for "${args}":`,
                    timestamp: new Date(),
                    searchResults: files
                };
                setMessages(prev => [...prev, searchMsg]);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
            return true;
        }
        
        if (cmd === 'open') {
             if (onOpenFile) onOpenFile(args.trim());
             return true;
        }

        if (cmd === 'exec' || cmd === 'run' || cmd === 'cmd') {
            setLoading(true);
            try {
                const raw = await RunCommandDetailed(args);
                const parsed = JSON.parse(raw);
                const output = typeof parsed?.output === 'string' ? parsed.output : '';
                const errorText = typeof parsed?.error === 'string' ? parsed.error : '';
                const success = Boolean(parsed?.success);
                const execMsg: Message = {
                    role: 'system',
                    text: `Command: ${args}\n\nOutput:\n\`\`\`\n${output}\n\`\`\`${success ? '' : `\n\nError:\n${errorText}`}`,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, execMsg]);
            } catch (e) {
                console.error(e);
                const errorMsg: Message = {
                    role: 'system',
                    text: `Error executing command "${args}":\n${e}`,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, errorMsg]);
            } finally {
                setLoading(false);
            }
            return true;
        }

        return false;
    };

    const handleStop = async () => {
        if (!sessionId || !loading) return;
        
        try {
            await AbortSession(sessionId);
        } catch (e) {
            console.error("Failed to stop session:", e);
        } finally {
            setLoading(false);
            setModelStatus('idle');
        }
    };

    const handleSend = async () => {
        if (!input.trim() || !sessionId || loading) return;

        // Check for slash commands
        if (input.startsWith('/')) {
            const parts = input.slice(1).split(' ');
            const cmd = parts[0];
            const args = parts.slice(1).join(' ');
            if (await executeCommand(cmd, args)) {
                setInput('');
                return;
            }
        }

        setLoading(true);
        setModelStatus('processing');
        const localUserId = `local_${Date.now()}`;
        const userMsg: Message = { id: localUserId, role: 'user', text: input, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');

        try {
            // Prepend mode to message if it's not Act mode (default)
            // Or use a slash command convention for now since we haven't updated the backend signature yet
            // Actually, let's prepend it as a system instruction in the user message for now
            // "[MODE: PLAN] user message"
            const messageToSend = mode === 'plan' ? `[MODE: PLAN] ${userMsg.text}` : userMsg.text;
            
            const res = await SendMessage(sessionId, messageToSend, selectedModel, selectedAgent);
            const parsed = JSON.parse(res);
            const turns = parsed.info?.rawTurns;
            const rawRequest = Array.isArray(turns) ? turns?.[0]?.request : undefined;
            const assistantMsg: Message = {
                id: parsed.info?.id,
                role: 'assistant',
                text: parsed.parts?.[0]?.text || 'No response',
                timestamp: new Date(),
                model: parsed.info?.model,
                rawResponse: parsed.info?.rawResponse,
                rawTurns: parsed.info?.rawTurns
            };
            setMessages(prev => {
                const updated = prev.map(m => {
                    if (m.id !== localUserId) return m;
                    return {
                        ...m,
                        rawRequest: typeof rawRequest === 'string' ? rawRequest : m.rawRequest,
                        rawTurns: Array.isArray(turns) ? turns : m.rawTurns
                    };
                });
                return [...updated, assistantMsg];
            });
            setModelStatus('idle');
        } catch (e) {
            console.error(e);
            const errText = String(e);
            setMessages(prev => [...prev, { role: 'system', text: `发送失败：${errText}`, timestamp: new Date() }]);
            setModelStatus('error');
        } finally {
            setLoading(false);
        }
    };

    const handleSummarize = async () => {
        if (!sessionId) return;
        const { providerId, modelId } = splitProviderModel(selectedModel);
        if (!providerId || !modelId) {
            setMessages(prev => [...prev, { role: 'system', text: '无法总结：当前未选择有效的 Provider/Model。', timestamp: new Date() }]);
            return;
        }
        try {
            const raw = await SummarizeSession(sessionId, providerId, modelId);
            const parsed = JSON.parse(raw);
            const summaryText = typeof parsed?.summary === 'string' ? parsed.summary : (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
            setMessages(prev => [...prev, { role: 'system', text: `Session Summary:\n\n${summaryText}`, timestamp: new Date() }]);
        } catch (e) {
            console.error(e);
            setMessages(prev => [...prev, { role: 'system', text: `总结失败：${e}`, timestamp: new Date() }]);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        
        // Command menu trigger
        if (e.key === '/' && input === '') {
            // Can open menu here
        }
    };

    const toggleRaw = (msg: Message, fallbackIndex: number) => {
        const key = msg.id || `idx_${fallbackIndex}`;
        setRawOpenById(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const isRawOpen = (msg: Message, fallbackIndex: number) => {
        const key = msg.id || `idx_${fallbackIndex}`;
        return Boolean(rawOpenById[key]);
    };

    const renderRawTurns = (msg: Message) => {
        const turns = Array.isArray(msg.rawTurns) ? msg.rawTurns : [];
        if (!msg.rawRequest && !msg.rawResponse && turns.length === 0) {
            return (
                <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid var(--border-color)' }}>
                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>
                        No raw request/response recorded for this message.
                    </Typography>
                </Box>
            );
        }

        const items: JSX.Element[] = [];

        if (msg.rawRequest) {
            items.push(
                <Box key="raw_request" sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>Raw Request</Typography>
                    <CodeBlock language="json" code={msg.rawRequest} />
                </Box>
            );
        }

        if (msg.rawResponse) {
            items.push(
                <Box key="raw_response" sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>Raw Response</Typography>
                    <CodeBlock language="json" code={msg.rawResponse} />
                </Box>
            );
        }

        if (turns.length > 1) {
            items.push(
                <Box key="raw_turns" sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>Raw Turns ({turns.length})</Typography>
                    {turns.map((t: any, idx: number) => (
                        <Box key={idx} sx={{ mt: 1 }}>
                            <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>
                                Turn {idx + 1} • {t?.provider || ''} {t?.model || ''} • {t?.status || ''}
                            </Typography>
                            {typeof t?.requestHeaders === 'string' && t.requestHeaders.trim() !== '' && (
                                <Box sx={{ mt: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>Request Headers</Typography>
                                    <CodeBlock language="json" code={t.requestHeaders} />
                                </Box>
                            )}
                            {typeof t?.request === 'string' && <CodeBlock language="json" code={t.request} />}
                            {typeof t?.response === 'string' && <CodeBlock language="json" code={t.response} />}
                        </Box>
                    ))}
                </Box>
            );
        }

        return (
            <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid var(--border-color)' }}>
                {items}
            </Box>
        );
    };

    // --- Render ---

    if (!sessionId) {
        return (
            <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                <Typography color="inherit">Select a session to start</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'var(--bg-color)', color: 'var(--text-primary)' }}>
            {/* Toolbar */}
            <Paper
                square
                sx={{
                    p: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                    bgcolor: 'var(--sidebar-bg)',
                    borderBottom: '1px solid var(--border-color)',
                    color: 'inherit'
                }}
            >
                <BotIcon fontSize="small" sx={{ color: 'var(--accent-color)' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'inherit' }}>Chat</Typography>
                <Box sx={{ flex: 1 }} />
                
                <Box sx={{ display: 'flex', bgcolor: 'var(--bg-color)', borderRadius: 1, border: '1px solid var(--border-color)', mr: 1 }}>
                    <Tooltip title="Plan Mode: Analyze and design without executing changes">
                        <Button 
                            size="small" 
                            onClick={() => setMode('plan')}
                            sx={{ 
                                minWidth: 0, 
                                px: 1,
                                py: 0.5,
                                color: mode === 'plan' ? 'var(--accent-color)' : 'var(--text-secondary)',
                                bgcolor: mode === 'plan' ? 'rgba(var(--accent-color-rgb), 0.1)' : 'transparent',
                                borderRadius: '4px 0 0 4px',
                                borderRight: '1px solid var(--border-color)'
                            }}
                        >
                            <PlanIcon fontSize="small" />
                            <Typography variant="caption" sx={{ ml: 0.5, fontWeight: mode === 'plan' ? 'bold' : 'normal' }}>Plan</Typography>
                        </Button>
                    </Tooltip>
                    <Tooltip title="Act Mode: Execute changes and run commands">
                        <Button 
                            size="small" 
                            onClick={() => setMode('act')}
                            sx={{ 
                                minWidth: 0, 
                                px: 1,
                                py: 0.5,
                                color: mode === 'act' ? 'var(--success)' : 'var(--text-secondary)',
                                bgcolor: mode === 'act' ? 'rgba(76, 175, 80, 0.1)' : 'transparent',
                                borderRadius: '0 4px 4px 0'
                            }}
                        >
                            <ActIcon fontSize="small" />
                            <Typography variant="caption" sx={{ ml: 0.5, fontWeight: mode === 'act' ? 'bold' : 'normal' }}>Act</Typography>
                        </Button>
                    </Tooltip>
                </Box>

                <Chip 
                    size="small" 
                    label={models.find(m => m.id === selectedModel)?.name || selectedModel || "No Model"} 
                    color="primary" 
                    variant="outlined" 
                    onClick={(e) => setModelAnchorEl(e.currentTarget)} 
                    sx={{
                        fontSize: '0.7rem',
                        height: 24,
                        cursor: 'pointer',
                        maxWidth: 220,
                        flexShrink: 1,
                        '& .MuiChip-label': {
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }
                    }}
                />
                <Menu
                    anchorEl={modelAnchorEl}
                    open={Boolean(modelAnchorEl)}
                    onClose={() => setModelAnchorEl(null)}
                >
                    {models.map((m) => (
                        <MenuItem 
                            key={m.id} 
                            selected={m.id === selectedModel}
                            onClick={() => {
                                setSelectedModel(m.id);
                                setModelAnchorEl(null);
                            }}
                        >
                            {m.name}
                        </MenuItem>
                    ))}
                </Menu>
                <Tooltip title="Terminal">
                    <IconButton size="small" onClick={() => onToggleTerminal?.()}>
                        <TerminalIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title={showRawEnabled ? "Hide Raw/Debug" : "Show Raw/Debug"}>
                    <Chip
                        size="small"
                        label="RAW"
                        variant="outlined"
                        onClick={() => setShowRawEnabled(v => !v)}
                        sx={{
                            height: 24,
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                            borderColor: showRawEnabled ? 'var(--success)' : 'var(--border-color)',
                            color: showRawEnabled ? 'var(--success)' : 'var(--text-secondary)'
                        }}
                    />
                </Tooltip>
                <IconButton size="small" onClick={handleSummarize}>
<FileIcon fontSize="small" />
                </IconButton>
            </Paper>

            {/* Messages */}
            <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {messages.map((msg, i) => (
                    <Box key={i} sx={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '100%'
                    }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                            <Avatar sx={{ width: 24, height: 24, bgcolor: msg.role === 'user' ? 'secondary.main' : 'primary.main', fontSize: '0.8rem' }}>
                                {msg.role === 'user' ? <PersonIcon fontSize="inherit"/> : <BotIcon fontSize="inherit"/>}
                            </Avatar>
                            <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>
                                {msg.role.toUpperCase()} • {msg.timestamp.toLocaleTimeString()}
                            </Typography>
                            {showRawEnabled && msg.role !== 'system' && (
                                <Button
                                    size="small"
                                    variant="text"
                                    onClick={() => toggleRaw(msg, i)}
                                    sx={{ ml: 1, textTransform: 'none', color: 'var(--text-secondary)', fontSize: '0.7rem' }}
                                >
                                    {isRawOpen(msg, i) ? 'Hide Raw' : 'Show Raw'}
                                </Button>
                            )}
                        </Box>
                        
                        <Paper sx={{ 
                            p: 2, 
                            borderRadius: 2, 
                            maxWidth: '90%', 
                            bgcolor: msg.role === 'user'
                                ? 'rgba(122, 162, 247, 0.1)'
                                : msg.role === 'system'
                                    ? 'var(--code-bg)'
                                    : 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            borderTopRightRadius: msg.role === 'user' ? 0 : 2,
                            borderTopLeftRadius: msg.role === 'assistant' ? 0 : 2,
                            border: '1px solid var(--border-color)'
                        }}>
                            {msg.searchResults ? (
                                <Box sx={{ color: 'inherit' }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'inherit' }}>{msg.text}</Typography>
                                    <List dense>
                                        {msg.searchResults.map((file: string, idx: number) => (
                                            <ListItem key={idx} disablePadding>
                                                <Button 
                                                    startIcon={<FileIcon />} 
                                                    size="small" 
                                                    sx={{ textTransform: 'none', color: 'var(--accent-color)', textAlign: 'left', justifyContent: 'flex-start', width: '100%' }}
                                                    onClick={() => onOpenFile && onOpenFile(file)}
                                                >
                                                    {file}
                                                </Button>
                                            </ListItem>
                                        ))}
                                    </List>
                                </Box>
                            ) : (
                                <Box sx={{ color: 'inherit' }}>
                                    <MessageRenderer text={msg.text} onOpenFile={onOpenFile} allowDebug={showRawEnabled} />
                                </Box>
                            )}
                            {showRawEnabled && isRawOpen(msg, i) && renderRawTurns(msg)}
                        </Paper>
                    </Box>
                ))}
                
                {loading && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'var(--text-secondary)', ml: 2 }}>
                        <CircularProgress size={16} />
                        <Typography variant="caption" color="inherit">Thinking...</Typography>
                    </Box>
                )}
            </Box>

            {/* Input Area */}
            <Box sx={{ p: 2, bgcolor: 'var(--sidebar-bg)', borderTop: '1px solid var(--border-color)', color: 'inherit' }}>
                <Paper 
                    component="form" 
                    onSubmit={(e: React.FormEvent) => {
                        e.preventDefault();
                        // Optional: trigger send on submit if not handled by keydown/click
                        // but usually better to let explicit handlers manage it.
                        // Just preventing default is enough to fix the reload issue.
                    }}
                    sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', bgcolor: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'inherit' }}
                    elevation={0}
                >
                    <IconButton sx={{ p: '10px' }} aria-label="open terminal" onClick={() => onToggleTerminal?.()}>
                        <TerminalIcon />
                    </IconButton>
                    <TextField
                        sx={{ 
                            flex: 1,
                            '& .MuiInputBase-input': { color: 'var(--text-primary)' },
                            '& .MuiInputBase-input::placeholder': { color: 'var(--text-secondary)' }
                        }}
                        placeholder="Type a message or /command..."
                        variant="standard"
                        InputProps={{ disableUnderline: true }}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={loading}
                        multiline
                        maxRows={4}
                    />
                    <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
                    <IconButton color="primary" sx={{ p: '10px' }} onClick={loading ? handleStop : handleSend} disabled={!loading && !input.trim()}>
                        {loading ? <StopIcon /> : <SendIcon />}
                    </IconButton>
                </Paper>
                <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'var(--text-secondary)', textAlign: 'right' }}>
                    Shift + Enter for new line • /search to find files
                </Typography>
            </Box>
        </Box>
    );
};

export default ChatInterface;
