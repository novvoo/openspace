import React, { useState } from 'react';
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
                    <div className="WorkspaceMain">
                        <div className="ExplorerPanel">
                            <FileExplorer onFileClick={setEditingFilePath} />
                        </div>
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
                        <div className="ChatPanel">
                            <ChatInterface
                                sessionId={selectedSession}
                                onOpenFile={(path) => setEditingFilePath(path)}
                                onToggleTerminal={() => setTerminalOpen(v => !v)}
                            />
                        </div>
                    </div>
                    <TerminalPanel open={terminalOpen} onClose={() => setTerminalOpen(false)} />
                </div>
            </div>
        </div>
    );
};

export default MainLayout;
