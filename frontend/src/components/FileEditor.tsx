import React, { useState, useEffect } from 'react';
import { GetFileContent, SaveFileContent } from '../../wailsjs/go/main/App';
import Editor from '@monaco-editor/react';
import { useTheme } from '../ThemeContext';

interface FileEditorProps {
    path: string;
    onClose: () => void;
}

const FileEditor: React.FC<FileEditorProps> = ({ path, onClose }) => {
    const { theme } = useTheme();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Determine language from file extension
    const getLanguageFromPath = (filePath: string) => {
        const ext = filePath.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'js':
            case 'jsx':
                return 'javascript';
            case 'ts':
            case 'tsx':
                return 'typescript';
            case 'py':
                return 'python';
            case 'go':
                return 'go';
            case 'html':
                return 'html';
            case 'css':
                return 'css';
            case 'json':
                return 'json';
            case 'md':
                return 'markdown';
            case 'sql':
                return 'sql';
            case 'java':
                return 'java';
            case 'c':
            case 'cpp':
            case 'h':
                return 'cpp';
            case 'rust':
            case 'rs':
                return 'rust';
            case 'yaml':
            case 'yml':
                return 'yaml';
            case 'xml':
                return 'xml';
            case 'sh':
            case 'bash':
                return 'shell';
            default:
                return 'plaintext';
        }
    };

    useEffect(() => {
        const loadContent = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await GetFileContent(path);
                if (data) {
                    const parsed = JSON.parse(data);
                    setContent(parsed.content || '');
                }
            } catch (e: any) {
                console.error('Failed to load file content:', e);
                setError('Failed to load file content');
            } finally {
                setLoading(false);
            }
        };
        loadContent();
    }, [path]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            await SaveFileContent(path, content);
            // You might want to use a toast here instead of alert in a real app
            // but keeping existing behavior for now
            alert('File saved successfully!');
        } catch (e: any) {
            console.error('Failed to save file:', e);
            setError('Failed to save file');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div style={{ padding: '20px', color: 'var(--text-secondary)' }}>Loading file content...</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-color)' }}>
            <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--sidebar-bg)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>Editing:</span>
                    <span style={{ fontSize: '13px', color: 'var(--accent-color)' }}>{path}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                            padding: '4px 12px',
                            backgroundColor: 'var(--accent-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                        }}
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '4px 12px',
                            backgroundColor: 'transparent',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
            {error && (
                <div style={{ padding: '8px 16px', backgroundColor: 'rgba(244, 67, 54, 0.1)', color: '#f44336', fontSize: '12px' }}>
                    {error}
                </div>
            )}
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <Editor
                    height="100%"
                    language={getLanguageFromPath(path)}
                    value={content}
                    theme={theme === 'dark' ? 'vs-dark' : 'light'}
                    onChange={(value) => setContent(value || '')}
                    options={{
                        minimap: { enabled: true },
                        fontSize: 14,
                        wordWrap: 'on',
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        padding: { top: 16, bottom: 16 }
                    }}
                />
            </div>
        </div>
    );
};

export default FileEditor;
