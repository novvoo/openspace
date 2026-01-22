import React, { useState, useEffect } from 'react';
import { GetFiles, GetPath, OpenCurrentDirectory, FindFilesByName, FindText } from '../../wailsjs/go/main/App';

interface FileNode {
    name: string;
    isDir: boolean;
    path: string;
    match?: string;
}

interface FileExplorerProps {
    onFileClick?: (path: string) => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ onFileClick }) => {
    const [files, setFiles] = useState<FileNode[]>([]);
    const [currentPath, setCurrentPath] = useState('.');
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState<'filename' | 'content'>('filename');
    const [searchResults, setSearchResults] = useState<FileNode[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const loadFiles = async (path: string) => {
        setLoading(true);
        setIsSearching(false);
        try {
            const data = await GetFiles(path);
            if (!data) {
                setFiles([]);
                return;
            }
            const parsed = JSON.parse(data);
            // 转换后端数据格式到前端格式
            const nodes: FileNode[] = (parsed || []).map((item: any) => ({
                name: item.name || '',
                path: item.path || '',
                isDir: item.type === 'directory',
                match: item.match
            })).sort((a: FileNode, b: FileNode) => {
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;
                return a.name.localeCompare(b.name);
            });
            setFiles(nodes);
            setCurrentPath(path);
        } catch (e) {
            console.error('Failed to load files:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (query: string) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setIsSearching(false);
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        setLoading(true);
        try {
            let results: FileNode[] = [];
            if (searchMode === 'filename') {
                const data = await FindFilesByName(query, "", 50);
                if (data) {
                    const paths = JSON.parse(data);
                    results = paths.map((p: string) => ({
                        path: p,
                        name: p.split(/[/\\]/).pop() || p,
                        isDir: false
                    }));
                }
            } else {
                const data = await FindText(query);
                if (data) {
                    const matches = JSON.parse(data);
                    const seenPaths = new Set();
                    results = matches.filter((m: any) => {
                        if (seenPaths.has(m.path)) return false;
                        seenPaths.add(m.path);
                        return true;
                    }).map((m: any) => ({
                        path: m.path,
                        name: m.path.split(/[/\\]/).pop() || m.path,
                        isDir: false,
                        match: m.lines?.[0]?.trim()
                    }));
                }
            }
            setSearchResults(results);
        } catch (e) {
            console.error('Search failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
        setIsSearching(false);
        setSearchResults([]);
    };

    const goUp = () => {
        const parts = currentPath.split(/[\\/]/).filter(p => p !== '');
        if (parts.length > 0) {
            parts.pop();
            const parentPath = parts.length === 0 ? '.' : parts.join('/');
            loadFiles(parentPath);
        }
    };

    const openCurrentDirectory = async () => {
        try {
            await OpenCurrentDirectory();
        } catch (e) {
            console.error('Failed to open directory:', e);
        }
    };

    useEffect(() => {
        const init = async () => {
            try {
                const pathData = await GetPath();
                if (pathData) {
                    const parsed = JSON.parse(pathData);
                    // 使用 directory 或 worktree 字段，如果没有则使用当前目录
                    loadFiles(parsed.directory || parsed.worktree || '.');
                } else {
                    loadFiles('.');
                }
            } catch (e) {
                loadFiles('.');
            }
        };
        init();
    }, []);

    const displayFiles = isSearching ? searchResults : files;

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--sidebar-bg)' }}>
            <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                        {isSearching ? 'SEARCH RESULTS' : 'EXPLORER'}
                    </span>
                    <button
                        onClick={openCurrentDirectory}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)',
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Open Dir
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <input
                            type="text"
                            placeholder={searchMode === 'filename' ? "Search files..." : "Search text..."}
                            value={searchQuery}
                            onChange={(e) => handleSearch(e.target.value)}
                            style={{
                                width: '100%',
                                background: 'var(--input-bg)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                padding: '4px 24px 4px 8px',
                                fontSize: '12px',
                                color: 'var(--text-primary)',
                                outline: 'none'
                            }}
                        />
                        {searchQuery && (
                            <span
                                onClick={clearSearch}
                                style={{
                                    position: 'absolute',
                                    right: '8px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    cursor: 'pointer',
                                    color: 'var(--text-secondary)',
                                    fontSize: '10px'
                                }}
                            >✕</span>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                        onClick={() => { setSearchMode('filename'); if (searchQuery) handleSearch(searchQuery); }}
                        style={{
                            flex: 1,
                            fontSize: '10px',
                            padding: '4px',
                            backgroundColor: searchMode === 'filename' ? 'rgba(64, 150, 255, 0.1)' : 'transparent',
                            border: `1px solid ${searchMode === 'filename' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            borderRadius: '4px',
                            color: searchMode === 'filename' ? 'var(--accent-color)' : 'var(--text-secondary)',
                            cursor: 'pointer'
                        }}
                    >By Name</button>
                    <button
                        onClick={() => { setSearchMode('content'); if (searchQuery) handleSearch(searchQuery); }}
                        style={{
                            flex: 1,
                            fontSize: '10px',
                            padding: '4px',
                            backgroundColor: searchMode === 'content' ? 'rgba(64, 150, 255, 0.1)' : 'transparent',
                            border: `1px solid ${searchMode === 'content' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            borderRadius: '4px',
                            color: searchMode === 'content' ? 'var(--accent-color)' : 'var(--text-secondary)',
                            cursor: 'pointer'
                        }}
                    >By Content</button>
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {!isSearching && currentPath !== '.' && currentPath !== '/' && (
                    <div
                        onClick={goUp}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            marginBottom: '2px'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        <span>📁</span>
                        <span>..</span>
                    </div>
                )}

                {loading && <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)' }}>Searching...</div>}

                {displayFiles.map((file) => (
                    <div
                        key={file.path}
                        className={`FileNode ${file.isDir ? 'is-directory' : 'is-file'}`}
                        onClick={() => {
                            if (file.isDir) {
                                loadFiles(file.path);
                            } else if (onFileClick) {
                                onFileClick(file.path);
                            }
                        }}
                        style={{
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            marginBottom: '2px',
                            backgroundColor: 'transparent'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '14px' }}>{file.isDir ? '📁' : '📄'}</span>
                            <span style={{
                                fontSize: '13px',
                                color: file.isDir ? 'var(--accent-color)' : 'var(--text-primary)',
                                fontWeight: file.isDir ? '600' : 'normal',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>{file.name}</span>
                        </div>
                        {file.match && (
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--text-secondary)',
                                paddingLeft: '22px',
                                marginTop: '2px',
                                fontStyle: 'italic',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {file.match}
                            </div>
                        )}
                        {isSearching && (
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', paddingLeft: '22px', opacity: 0.7 }}>
                                {file.path}
                            </div>
                        )}
                    </div>
                ))}

                {displayFiles.length === 0 && !loading && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>
                        {isSearching ? 'No results found' : 'Empty directory'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FileExplorer;
