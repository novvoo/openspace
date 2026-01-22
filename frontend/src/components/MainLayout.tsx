import React, { useEffect, useMemo, useRef, useState } from 'react';
import FileExplorer from './FileExplorer';
import ChatInterface from './ChatInterface';
import Sidebar from './Sidebar';
import FileEditor from './FileEditor';
import CustomLLMConfig from './CustomLLMConfig';
import TerminalPanel from './TerminalPanel';

const MainLayout: React.FC = () => {
    const [selectedSession, setSelectedSession] = useState<string | null>(null);
    const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
    const [showConfig, setShowConfig] = useState<boolean>(false);
    const [terminalOpen, setTerminalOpen] = useState<boolean>(false);

    const workspaceMainRef = useRef<HTMLDivElement>(null);

    const [explorerWidth, setExplorerWidth] = useState<number>(() => {
        try {
            const v = localStorage.getItem('openspace.layout.explorerWidth');
            const n = v ? Number(v) : NaN;
            return Number.isFinite(n) ? n : 250;
        } catch {
            return 250;
        }
    });

    const [chatWidth, setChatWidth] = useState<number>(() => {
        try {
            const v = localStorage.getItem('openspace.layout.chatWidth');
            const n = v ? Number(v) : NaN;
            return Number.isFinite(n) ? n : 400;
        } catch {
            return 400;
        }
    });

    const [terminalHeight, setTerminalHeight] = useState<number>(() => {
        try {
            const v = localStorage.getItem('openspace.layout.terminalHeight');
            const n = v ? Number(v) : NaN;
            return Number.isFinite(n) ? n : 260;
        } catch {
            return 260;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('openspace.layout.explorerWidth', String(Math.round(explorerWidth)));
        } catch {}
    }, [explorerWidth]);

    useEffect(() => {
        try {
            localStorage.setItem('openspace.layout.chatWidth', String(Math.round(chatWidth)));
        } catch {}
    }, [chatWidth]);

    useEffect(() => {
        try {
            localStorage.setItem('openspace.layout.terminalHeight', String(Math.round(terminalHeight)));
        } catch {}
    }, [terminalHeight]);

    const limits = useMemo(() => {
        return {
            explorerMin: 180,
            chatMin: 280,
            editorMin: 320,
            terminalMin: 140,
            terminalMax: 520
        };
    }, []);

    const getWorkspaceWidth = () => {
        const el = workspaceMainRef.current;
        if (!el) return 0;
        return el.getBoundingClientRect().width;
    };

    const startVerticalDrag = (which: 'explorer' | 'chat') => (ev: React.PointerEvent<HTMLDivElement>) => {
        ev.preventDefault();
        ev.currentTarget.setPointerCapture(ev.pointerId);
        const startX = ev.clientX;
        const startExplorer = explorerWidth;
        const startChat = chatWidth;
        const total = getWorkspaceWidth();

        const onMove = (e: PointerEvent) => {
            const dx = e.clientX - startX;
            if (which === 'explorer') {
                const nextExplorer = startExplorer + dx;
                const maxExplorer = Math.max(limits.explorerMin, total - startChat - limits.editorMin);
                const clamped = Math.min(Math.max(nextExplorer, limits.explorerMin), maxExplorer);
                setExplorerWidth(clamped);
                return;
            }
            const nextChat = startChat - dx;
            const maxChat = Math.max(limits.chatMin, total - startExplorer - limits.editorMin);
            const clamped = Math.min(Math.max(nextChat, limits.chatMin), maxChat);
            setChatWidth(clamped);
        };

        const onUp = (e: PointerEvent) => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            try {
                (ev.currentTarget as any).releasePointerCapture(e.pointerId);
            } catch {}
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const startHorizontalDrag = (ev: React.PointerEvent<HTMLDivElement>) => {
        ev.preventDefault();
        ev.currentTarget.setPointerCapture(ev.pointerId);
        const startY = ev.clientY;
        const startH = terminalHeight;

        const onMove = (e: PointerEvent) => {
            const dy = e.clientY - startY;
            const next = startH - dy;
            const clamped = Math.min(Math.max(next, limits.terminalMin), limits.terminalMax);
            setTerminalHeight(clamped);
        };

        const onUp = (e: PointerEvent) => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            try {
                (ev.currentTarget as any).releasePointerCapture(e.pointerId);
            } catch {}
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const handleShowConfig = () => {
        setShowConfig(true);
    };

    const handleCloseConfig = () => {
        setShowConfig(false);
    };

    return (
        <div className="MainLayout">
            <Sidebar
                onSelectSession={setSelectedSession}
                onShowConfig={handleShowConfig}
            />
            <div className="MainContent">
                <div className="Header">
                    <div className="HeaderLeft">
                        <span>Openspace Client</span>
                    </div>
                    <div className="HeaderRight">
                        {/* 移除了状态指示器和控制按钮 */}
                    </div>
                </div>
                <div className="WorkspaceContainer">
                    <div className="WorkspaceMain" ref={workspaceMainRef}>
                        <div className="ExplorerPanel" style={{ width: `${explorerWidth}px` }}>
                            <FileExplorer onFileClick={setEditingFilePath} />
                        </div>
                        <div className="Resizer ResizerVertical" onPointerDown={startVerticalDrag('explorer')} />
                        <div className="EditorPanel">
                            {showConfig ? (
                                <CustomLLMConfig onClose={handleCloseConfig} />
                            ) : editingFilePath ? (
                                <FileEditor
                                    path={editingFilePath}
                                    onClose={() => setEditingFilePath(null)}
                                />
                            ) : (
                                <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#787c99' }}>
                                    Select a file to edit
                                </div>
                            )}
                        </div>
                        <div className="Resizer ResizerVertical" onPointerDown={startVerticalDrag('chat')} />
                        <div className="ChatPanel" style={{ width: `${chatWidth}px` }}>
                            <ChatInterface
                                sessionId={selectedSession}
                                onOpenFile={(path) => setEditingFilePath(path)}
                                onToggleTerminal={() => setTerminalOpen(v => !v)}
                            />
                        </div>
                    </div>
                    {terminalOpen && <div className="Resizer ResizerHorizontal" onPointerDown={startHorizontalDrag} />}
                    <TerminalPanel open={terminalOpen} onClose={() => setTerminalOpen(false)} height={terminalHeight} />
                </div>
            </div>
        </div>
    );
};

export default MainLayout;
