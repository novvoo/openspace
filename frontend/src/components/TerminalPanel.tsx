import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { Close as CloseIcon, DeleteOutline as ClearIcon, Terminal as TerminalIcon } from '@mui/icons-material';
import { GetFiles, GetPath, RunCommandDetailedWithCwd } from '../../wailsjs/go/main/App';

type TerminalEntry = {
    id: string;
    prompt: string;
    command: string;
    output: string;
    status: 'running' | 'done' | 'error';
    startedAt: number;
    finishedAt?: number;
};

interface TerminalPanelProps {
    open: boolean;
    onClose: () => void;
    height?: number;
}

const terminalBanner = `/*  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  */
/* |_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_| */
/* |_|                                                            |_| */
/* |_|                                                            |_| */
/* |_|                                                            |_| */
/* |_|      $$$$$$\\                                               |_| */
/* |_|     $$  __$$\\                                              |_| */
/* |_|     $$ /  $$ | $$$$$$\\   $$$$$$\\  $$$$$$$\\                 |_| */
/* |_|     $$ |  $$ |$$  __$$\\ $$  __$$\\ $$  __$$\\                |_| */
/* |_|     $$ |  $$ |$$ /  $$ |$$$$$$$$ |$$ |  $$ |               |_| */
/* |_|     $$ |  $$ |$$ |  $$ |$$   ____|$$ |  $$ |               |_| */
/* |_|      $$$$$$  |$$$$$$$  |\\$$$$$$$\\ $$ |  $$ |               |_| */
/* |_|      \\______/ $$  ____/  \\_______|\\__|  \\__|               |_| */
/* |_|               $$ |                                         |_| */
/* |_|      $$$$$$\\  $$ |                                         |_| */
/* |_|     $$  __$$\\ \\__|                                         |_| */
/* |_|     $$ /  \\__| $$$$$$\\   $$$$$$\\   $$$$$$$\\  $$$$$$\\       |_| */
/* |_|     \\$$$$$$\\  $$  __$$\\  \\____$$\\ $$  _____|$$  __$$\\      |_| */
/* |_|      \\____$$\\ $$ /  $$ | $$$$$$$ |$$ /      $$$$$$$$ |     |_| */
/* |_|     $$\\   $$ |$$ |  $$ |$$  __$$ |$$ |      $$   ____|     |_| */
/* |_|     \\$$$$$$  |$$$$$$$  |\\$$$$$$$ |\\$$$$$$$\\ \\$$$$$$$\\      |_| */
/* |_|      \\______/ $$  ____/  \\_______| \\_______| \\_______|     |_| */
/* |_|               $$ |                                         |_| */
/* |_|               $$ |                                         |_| */
/* |_|               \\__|                                         |_| */
/* |_|                                                            |_| */
/* |_|                                                            |_| */
/* |_| _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _  _ |_| */
/* |_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_||_| */`;

const TerminalPanel: React.FC<TerminalPanelProps> = ({ open, onClose, height }) => {
    const [input, setInput] = useState('');
    const [entries, setEntries] = useState<TerminalEntry[]>([]);
    const [running, setRunning] = useState(false);
    const [cwd, setCwd] = useState<string>('');
    const [home, setHome] = useState<string>('');
    const [shell, setShell] = useState<string>('');
    const [branch, setBranch] = useState<string>('');
    const outputRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [history, setHistory] = useState<string[]>([]);
    const [, setHistoryIndex] = useState<number | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [suggestVisible, setSuggestVisible] = useState(false);
    const [suggestIndex, setSuggestIndex] = useState(0);

    const prompt = useMemo(() => {
        const normalize = (p: string) => p.replace(/\\/g, '/');
        const trimTrailing = (p: string) => p.replace(/\/+$/, '');

        const normalizedCwd = trimTrailing(normalize(cwd));
        const normalizedHome = trimTrailing(normalize(home));
        const cwdDisplay = normalizedHome && normalizedCwd.toLowerCase().startsWith(normalizedHome.toLowerCase())
            ? `~${normalizedCwd.slice(normalizedHome.length)}`
            : normalizedCwd;

        const isWindows = navigator.userAgent.includes('Windows') || ['pwsh', 'powershell', 'cmd'].includes(shell);
        if (!cwdDisplay) return isWindows ? 'PS>' : '$';

        if (isWindows) {
            return `PS ${cwdDisplay}${branch ? ` [${branch}]` : ''}>`;
        }
        return `${cwdDisplay}${branch ? ` (${branch})` : ''} $`;
    }, [branch, cwd, home, shell]);

    useEffect(() => {
        if (!open) return;
        if (!outputRef.current) return;
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
        inputRef.current?.focus();
    }, [open, entries, running]);

    useEffect(() => {
        if (!open) return;
        (async () => {
            try {
                const raw = await GetPath();
                const parsed = JSON.parse(raw);
                const nextCwd = typeof parsed?.directory === 'string' ? parsed.directory : '';
                const nextHome = typeof parsed?.home === 'string' ? parsed.home : '';
                if (nextCwd) setCwd(nextCwd);
                if (nextHome) setHome(nextHome);
            } catch {
            }
        })();
    }, [open]);

    const appendEntry = (entry: TerminalEntry) => {
        setEntries(prev => [...prev, entry]);
    };

    const updateEntry = (id: string, patch: Partial<TerminalEntry>) => {
        setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    };

    const run = async (command: string) => {
        const trimmed = command.trim();
        if (!trimmed || running) return;

        setRunning(true);
        const startedAt = Date.now();
        const id = `term_${startedAt}`;
        appendEntry({ id, prompt, command: trimmed, output: '', status: 'running', startedAt });

        try {
            const raw = await RunCommandDetailedWithCwd(trimmed, cwd);
            const parsed = JSON.parse(raw);
            const output = typeof parsed?.output === 'string' ? parsed.output : '';
            const ok = Boolean(parsed?.success);
            updateEntry(id, { output, status: ok ? 'done' : 'error', finishedAt: Date.now() });
            if (typeof parsed?.cwd === 'string' && parsed.cwd) setCwd(parsed.cwd);
            if (typeof parsed?.home === 'string' && parsed.home) setHome(parsed.home);
            if (typeof parsed?.shell === 'string' && parsed.shell) setShell(parsed.shell);
            if (typeof parsed?.branch === 'string') setBranch(parsed.branch);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            updateEntry(id, { output: message, status: 'error', finishedAt: Date.now() });
        } finally {
            setRunning(false);
        }
    };

    const handleSubmit = async () => {
        const cmd = input;
        setInput('');
        const trimmed = cmd.trim();
        if (trimmed) {
            setHistory(prev => [...prev, trimmed]);
        }
        setHistoryIndex(null);
        setSuggestVisible(false);
        setSuggestions([]);
        setSuggestIndex(0);
        await run(cmd);
    };

    const applySuggestion = (tokenStart: number, tokenEnd: number, replacement: string) => {
        const before = input.slice(0, tokenStart);
        const after = input.slice(tokenEnd);
        const next = before + replacement + after;
        setInput(next);
        setTimeout(() => {
            const pos = (before + replacement).length;
            inputRef.current?.setSelectionRange(pos, pos);
        }, 0);
    };

    const computePathSuggestions = async (caret: number) => {
        const isWin = navigator.userAgent.includes('Windows') || ['pwsh', 'powershell', 'cmd'].includes(shell);
        const text = input;
        const tokenStart = Math.max(text.lastIndexOf(' ', caret - 1), text.lastIndexOf('\t', caret - 1)) + 1;
        const tokenEnd = caret;
        const token = text.slice(tokenStart, tokenEnd);
        if (!token) return { list: [], tokenStart, tokenEnd };

        const lastSlash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
        const dirPart = lastSlash >= 0 ? token.slice(0, lastSlash + 1) : '';
        const filePart = lastSlash >= 0 ? token.slice(lastSlash + 1) : token;

        const normalize = (p: string) => p.replace(/\\/g, '/');
        const toWin = (p: string) => p.replace(/\//g, '\\');

        let baseDir = '';
        if (dirPart.startsWith('~')) {
            baseDir = normalize(home) + normalize(dirPart.slice(1));
        } else if (/^[A-Za-z]:/.test(dirPart)) {
            baseDir = normalize(dirPart);
        } else if (dirPart.startsWith('/')) {
            baseDir = normalize(dirPart);
        } else {
            baseDir = normalize(cwd) + (dirPart ? normalize(dirPart) : '');
        }
        const requestPath = isWin ? toWin(baseDir) : baseDir;

        try {
            const raw = await GetFiles(requestPath);
            const files = JSON.parse(raw) as Array<{ name: string; type: string }>;
            const list = files
                .filter(f => f.name.toLowerCase().startsWith(filePart.toLowerCase()))
                .map(f => {
                    const name = f.name + (f.type === 'directory' ? (isWin ? '\\' : '/') : '');
                    return (dirPart || '') + name;
                });
            return { list, tokenStart, tokenEnd };
        } catch {
            return { list: [], tokenStart, tokenEnd };
        }
    };

    if (!open) return null;

    return (
        <Paper
            className="TerminalPanel"
            square
            elevation={0}
            sx={{ bgcolor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderTop: '1px solid var(--border-color)', height: height ? `${height}px` : undefined }}
        >
            <Box className="TerminalHeader">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TerminalIcon fontSize="small" sx={{ color: 'var(--accent-color)' }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>Terminal</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Clear">
                        <IconButton size="small" onClick={() => setEntries([])} sx={{ color: 'var(--text-secondary)' }}>
                            <ClearIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Close">
                        <IconButton size="small" onClick={onClose} sx={{ color: 'var(--text-secondary)' }}>
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            <Box
                ref={outputRef}
                className="TerminalOutput"
                sx={{
                    fontFamily: 'monospace',
                    bgcolor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)'
                }}
            >
                {entries.length === 0 ? (
                    <Typography
                        variant="body2"
                        component="pre"
                        sx={{
                            color: 'var(--text-secondary)',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre',
                            m: 0,
                            lineHeight: 1.2,
                            display: 'block'
                        }}
                    >
                        {terminalBanner}
                    </Typography>
                ) : (
                    entries.map(e => (
                        <Box key={e.id} sx={{ mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontFamily: 'monospace',
                                        color: 'var(--text-primary)',
                                        whiteSpace: 'pre-wrap',
                                        overflowWrap: 'anywhere'
                                    }}
                                >
                                    {e.prompt} {e.command}
                                </Typography>
                                {e.status === 'running' && (
                                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>
                                        running…
                                    </Typography>
                                )}
                                {e.status === 'error' && (
                                    <Typography variant="caption" sx={{ color: 'var(--error)' }}>
                                        error
                                    </Typography>
                                )}
                            </Box>
                            {e.output !== '' && (
                                <pre style={{ margin: '4px 0 0 0', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                                    {e.output}
                                </pre>
                            )}
                        </Box>
                    ))
                )}
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 1 }}>
                    <Typography
                        variant="body2"
                        sx={{
                            fontFamily: 'monospace',
                            color: 'var(--text-primary)',
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere'
                        }}
                    >
                        {prompt}
                    </Typography>
                    <Box
                        component="input"
                        ref={inputRef}
                        value={input}
                        disabled={running}
                        onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setInput(ev.target.value)}
                        onKeyDown={(ev: React.KeyboardEvent<HTMLInputElement>) => {
                            if (ev.key === 'Enter') {
                                ev.preventDefault();
                                handleSubmit();
                                return;
                            }
                            if (ev.key === 'Tab') {
                                ev.preventDefault();
                                const caret = inputRef.current?.selectionStart ?? input.length;
                                (async () => {
                                    const { list, tokenStart, tokenEnd } = await computePathSuggestions(caret);
                                    if (list.length === 0) {
                                        setSuggestVisible(false);
                                        setSuggestions([]);
                                        setSuggestIndex(0);
                                        return;
                                    }
                                    if (list.length === 1) {
                                        applySuggestion(tokenStart, tokenEnd, list[0]);
                                        setSuggestVisible(false);
                                        setSuggestions([]);
                                        setSuggestIndex(0);
                                        return;
                                    }
                                    const nextIndex = suggestVisible ? (suggestIndex + 1) % list.length : 0;
                                    setSuggestions(list);
                                    setSuggestVisible(true);
                                    setSuggestIndex(nextIndex);
                                    applySuggestion(tokenStart, tokenEnd, list[nextIndex]);
                                })();
                                return;
                            }
                            if (ev.key === 'ArrowUp') {
                                ev.preventDefault();
                                setHistoryIndex((prev) => {
                                    const nextIndex = prev === null ? history.length - 1 : Math.max(prev - 1, 0);
                                    const nextValue = history[nextIndex] ?? '';
                                    setInput(nextValue);
                                    return nextIndex;
                                });
                                return;
                            }
                            if (ev.key === 'ArrowDown') {
                                ev.preventDefault();
                                setHistoryIndex((prev) => {
                                    if (prev === null) return null;
                                    const nextIndex = prev + 1;
                                    if (nextIndex >= history.length) {
                                        setInput('');
                                        return null;
                                    }
                                    const nextValue = history[nextIndex] ?? '';
                                    setInput(nextValue);
                                    return nextIndex;
                                });
                                return;
                            }
                            if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'l' || ev.key === 'L')) {
                                ev.preventDefault();
                                setEntries([]);
                                setSuggestVisible(false);
                                setSuggestions([]);
                                setSuggestIndex(0);
                                return;
                            }
                        }}
                        sx={{
                            flex: 1,
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            fontFamily: 'monospace',
                            fontSize: '0.9rem',
                            padding: 0
                        }}
                    />
                </Box>
                {suggestVisible && suggestions.length > 0 && (
                    <Box
                        sx={{
                            mt: 0.5,
                            maxHeight: 140,
                            overflowY: 'auto',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            bgcolor: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                        }}
                    >
                        {suggestions.map((s, i) => (
                            <Box
                                key={`${s}-${i}`}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    const caret = inputRef.current?.selectionStart ?? input.length;
                                    computePathSuggestions(caret).then(({ tokenStart, tokenEnd }) => {
                                        applySuggestion(tokenStart, tokenEnd, s);
                                        setSuggestVisible(false);
                                        setSuggestions([]);
                                        setSuggestIndex(0);
                                    });
                                }}
                                sx={{
                                    px: 1,
                                    py: 0.5,
                                    cursor: 'pointer',
                                    bgcolor: i === suggestIndex ? 'var(--bg-tertiary)' : 'transparent'
                                }}
                            >
                                {s}
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
        </Paper>
    );
};

export default TerminalPanel;
