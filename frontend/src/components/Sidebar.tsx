import React, { useState, useEffect } from 'react';
import { GetSessions, GetSessionStatus, CreateSession, DeleteSession } from '../../wailsjs/go/main/App';
import { useTheme } from '../ThemeContext';

interface SidebarProps {
    onSelectSession: (id: string) => void;
    onShowConfig: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onSelectSession, onShowConfig }) => {
    const { theme, toggleTheme } = useTheme();
    const [sessions, setSessions] = useState<any[]>([]);
    const [activeSession, setActiveSession] = useState<string | null>(null);

    const [sessionStatuses, setSessionStatuses] = useState<{ [key: string]: any }>({});

    const loadSessions = async () => {
        try {
            const data = await GetSessions();
            if (!data) {
                setSessions([]);
                return;
            }
            const parsed = JSON.parse(data);
            setSessions(parsed || []);
            loadSessionStatuses();
        } catch (e) {
            console.error('Failed to load sessions:', e);
        }
    };

    const loadSessionStatuses = async () => {
        try {
            const data = await GetSessionStatus();
            if (data) {
                setSessionStatuses(JSON.parse(data));
            }
        } catch (e) {
            console.error('Failed to load session statuses:', e);
        }
    };

    useEffect(() => {
        loadSessions();
        const interval = setInterval(loadSessionStatuses, 10000); // 每10秒更新一次状态
        return () => clearInterval(interval);
    }, []);

    const handleCreateSession = async () => {
        try {
            const resp = await CreateSession('New Session', '');
            if (!resp) return;
            const session = JSON.parse(resp);
            setSessions([session, ...sessions]);
            handleSelect(session.id || session.ID);
        } catch (e) {
            console.error('Create session failed:', e);
        }
    };

    const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this session?')) return;
        try {
            await DeleteSession(id);
            setSessions(prev => prev.filter(s => (s.id || s.ID) !== id));
            if (activeSession === id) {
                setActiveSession(null);
                onSelectSession('');
            }
        } catch (e) {
            console.error('Delete session failed:', e);
            alert('Failed to delete session');
        }
    };

    const handleSelect = (id: string) => {
        setActiveSession(id);
        onSelectSession(id);
    };

    return (
        <div className="Sidebar">
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
                <button
                    className="Button"
                    style={{ width: '100%', marginBottom: '8px' }}
                    onClick={handleCreateSession}
                >
                    + New Session
                </button>
                <button
                    className="Button"
                    style={{ width: '100%', backgroundColor: 'var(--accent-color)' }}
                    onClick={onShowConfig}
                >
                    ⚙️ Settings
                </button>
                <button
                    className="Button"
                    style={{ width: '100%', backgroundColor: 'var(--text-secondary)', marginTop: '8px' }}
                    onClick={toggleTheme}
                >
                    {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
                </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
                <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                    SESSIONS
                </div>
                {sessions.map((s) => {
                    const sid = s.id || s.ID;
                    const title = s.title || s.Title || 'Untitled Session';
                    const createdAt = s.createdAt || s.CreatedAt;
                    const status = sessionStatuses[sid];
                    const isRunning = status && status.state === 'running';

                    return (
                        <div
                            key={sid}
                            className={`ChatItem ${activeSession === sid ? 'active' : ''}`}
                            onClick={() => handleSelect(sid)}
                            style={{ position: 'relative' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{
                                    fontSize: '14px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    flex: 1
                                }}>
                                    {isRunning && <span style={{ color: 'var(--success)', marginRight: '4px' }}>●</span>}
                                    {title}
                                </div>
                                <button
                                    onClick={(e) => handleDeleteSession(e, sid)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--text-secondary)',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        padding: '4px',
                                        opacity: 0.5
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                                    onMouseOut={(e) => e.currentTarget.style.opacity = '0.5'}
                                    title="Delete Session"
                                >
                                    🗑️
                                </button>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                {createdAt ? new Date(createdAt).toLocaleDateString() : 'Unknown date'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Sidebar;
