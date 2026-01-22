import React, { useEffect, useMemo, useState } from 'react';
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Snackbar,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography
} from '@mui/material';
import {
    ChevronRight as ChevronRightIcon,
    ContentCopy as ContentCopyIcon,
    CreateNewFolder as CreateNewFolderIcon,
    Delete as DeleteIcon,
    ExpandMore as ExpandMoreIcon,
    Folder as FolderIcon,
    FolderOpen as FolderOpenIcon,
    InsertDriveFile as FileIcon,
    NoteAdd as NoteAddIcon,
    DriveFileRenameOutline as RenameIcon,
    Search as SearchIcon,
    Close as CloseIcon,
    OpenInNew as OpenInNewIcon,
    Refresh as RefreshIcon
} from '@mui/icons-material';
import { CreateFile, CreateFolder, DeletePath, FindFilesByName, FindText, GetFiles, OpenCurrentDirectory, PickDirectory, RenamePath, RevealInExplorer, SetWorkspaceDirectory } from '../../wailsjs/go/main/App';

interface FileNode {
    name: string;
    isDir: boolean;
    path: string;
    match?: string;
}

interface FileExplorerProps {
    onFileClick?: (path: string) => void;
}

const sortNodes = (nodes: FileNode[]) =>
    nodes.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
    });

const basename = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() || p;

const FileExplorer: React.FC<FileExplorerProps> = ({ onFileClick }) => {
    const [rootPath, setRootPath] = useState<string>('');
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [childrenByPath, setChildrenByPath] = useState<Record<string, FileNode[]>>({});
    const [loadingByPath, setLoadingByPath] = useState<Record<string, boolean>>({});
    const [selectedPath, setSelectedPath] = useState<string>('');

    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState<'filename' | 'content'>('filename');
    const [searchResults, setSearchResults] = useState<FileNode[]>([]);
    const [searching, setSearching] = useState(false);

    const isSearching = searchQuery.trim().length > 0;

    const [contextMenu, setContextMenu] = useState<null | { mouseX: number; mouseY: number; node: FileNode }>(null);
    const [renameDialog, setRenameDialog] = useState<null | { node: FileNode; value: string }>(null);
    const [createDialog, setCreateDialog] = useState<null | { parentDir: string; kind: 'file' | 'folder'; value: string }>(null);
    const [deleteDialog, setDeleteDialog] = useState<null | { node: FileNode }>(null);
    const [toast, setToast] = useState<null | { message: string }>(null);

    const getSep = (p: string) => (p.includes('\\') ? '\\' : '/');
    const normalizeDir = (p: string) => {
        const sep = getSep(p);
        const t = p.replace(/[\\/]+$/, '');
        if (sep === '\\' && /^[A-Za-z]:$/.test(t)) return t + '\\';
        return t || p;
    };
    const dirname = (p: string) => {
        const sep = getSep(p);
        const n = normalizeDir(p);
        const idx = n.lastIndexOf(sep);
        if (idx === -1) return '.';
        const d = n.slice(0, idx);
        if (sep === '\\' && /^[A-Za-z]:$/.test(d)) return d + '\\';
        return d || (sep === '\\' ? '\\' : '/');
    };
    const joinPath = (dir: string, name: string) => {
        const sep = getSep(dir);
        const d = normalizeDir(dir);
        if (sep === '\\' && /^[A-Za-z]:\\$/.test(d)) return d + name;
        return d.endsWith(sep) ? d + name : d + sep + name;
    };

    const openContextMenu = (e: React.MouseEvent, node: FileNode) => {
        e.preventDefault();
        setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, node });
    };

    const closeContextMenu = () => setContextMenu(null);

    const showToast = (message: string) => setToast({ message });

    const loadChildren = async (path: string, force?: boolean) => {
        if (!path) return;
        if (!force && childrenByPath[path]) return;
        if (loadingByPath[path]) return;

        setLoadingByPath(prev => ({ ...prev, [path]: true }));
        try {
            const data = await GetFiles(path);
            const parsed = data ? JSON.parse(data) : [];
            const nodes: FileNode[] = sortNodes(
                (parsed || []).map((item: any) => ({
                    name: item.name || '',
                    path: item.path || '',
                    isDir: item.type === 'directory',
                    match: item.match
                }))
            );
            setChildrenByPath(prev => ({ ...prev, [path]: nodes }));
        } catch (e) {
            setChildrenByPath(prev => ({ ...prev, [path]: [] }));
        } finally {
            setLoadingByPath(prev => ({ ...prev, [path]: false }));
        }
    };

    const refreshRoot = async () => {
        if (!rootPath) return;
        setChildrenByPath(prev => {
            const next = { ...prev };
            delete next[rootPath];
            return next;
        });
        await loadChildren(rootPath, true);
    };

    const openCurrentDirectory = async () => {
        try {
            if (rootPath) {
                await revealInExplorer(rootPath);
                return;
            }
            await OpenCurrentDirectory();
        } catch (e) {
        }
    };

    const pickRootDirectory = async () => {
        try {
            const dir = await PickDirectory();
            if (!dir || !dir.trim()) return;
            await SetWorkspaceDirectory(dir);
            setRootPath(dir);
            setExpanded(new Set([dir]));
            setSelectedPath(dir);
            await loadChildren(dir, true);
        } catch (e: any) {
            showToast(e?.message || '选择文件夹失败');
        }
    };

    const handleSearch = async (q: string) => {
        setSearchQuery(q);
        const query = q.trim();
        if (!query) {
            setSearchResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        try {
            let results: FileNode[] = [];
            if (searchMode === 'filename') {
                const data = await FindFilesByName(query, '', 50);
                if (data) {
                    const paths = JSON.parse(data);
                    results = paths.map((p: string) => ({
                        path: p,
                        name: basename(p),
                        isDir: false
                    }));
                }
            } else {
                const data = await FindText(query);
                if (data) {
                    const matches = JSON.parse(data);
                    const seenPaths = new Set<string>();
                    results = matches
                        .filter((m: any) => {
                            if (seenPaths.has(m.path)) return false;
                            seenPaths.add(m.path);
                            return true;
                        })
                        .map((m: any) => ({
                            path: m.path,
                            name: basename(m.path),
                            isDir: false,
                            match: m.lines?.[0]?.trim()
                        }));
                }
            }
            setSearchResults(results);
        } catch (e) {
            setSearchResults([]);
        } finally {
            setSearching(false);
        }
    };

    useEffect(() => {
        const init = async () => {
            setRootPath('');
            setExpanded(new Set());
            setSelectedPath('');
        };
        init();
    }, []);

    useEffect(() => {
        if (searchQuery.trim() && searchResults.length === 0 && !searching) {
            setSearching(true);
        }
    }, []);

    const treeRootNode: FileNode | null = useMemo(() => {
        if (!rootPath) return null;
        return { name: basename(rootPath), path: rootPath, isDir: true };
    }, [rootPath]);

    const toggleDir = async (path: string) => {
        const next = new Set(expanded);
        if (next.has(path)) {
            next.delete(path);
            setExpanded(next);
            return;
        }
        next.add(path);
        setExpanded(next);
        await loadChildren(path);
    };

    const copyPathToClipboard = async (path: string) => {
        try {
            await navigator.clipboard.writeText(path);
            showToast('已复制路径');
        } catch (e) {
            showToast('复制失败');
        }
    };

    const revealInExplorer = async (path: string) => {
        try {
            await RevealInExplorer(path);
        } catch (e: any) {
            showToast(e?.message || '打开文件管理器失败');
        }
    };

    const refreshParentAfterChange = async (path: string) => {
        const parent = dirname(path);
        const nextExpanded = new Set(expanded);
        if (parent && !nextExpanded.has(parent)) nextExpanded.add(parent);
        setExpanded(nextExpanded);
        setChildrenByPath(prev => {
            const next = { ...prev };
            delete next[parent];
            return next;
        });
        await loadChildren(parent, true);
    };

    const removeCachePrefix = (prefix: string) => {
        const sep = getSep(prefix);
        const pfx = prefix.endsWith(sep) ? prefix : prefix + sep;
        setChildrenByPath(prev => {
            const next: Record<string, FileNode[]> = {};
            for (const [k, v] of Object.entries(prev)) {
                if (k === prefix || k.startsWith(pfx)) continue;
                next[k] = v;
            }
            return next;
        });
    };

    const remapExpandedPrefix = (oldPrefix: string, newPrefix: string) => {
        const sep = getSep(oldPrefix);
        const pfx = oldPrefix.endsWith(sep) ? oldPrefix : oldPrefix + sep;
        setExpanded(prev => {
            const next = new Set<string>();
            for (const p of prev) {
                if (p === oldPrefix) {
                    next.add(newPrefix);
                } else if (p.startsWith(pfx)) {
                    next.add(newPrefix + p.substring(oldPrefix.length));
                } else {
                    next.add(p);
                }
            }
            return next;
        });
        setSelectedPath(prev => {
            if (prev === oldPrefix) return newPrefix;
            if (prev.startsWith(pfx)) return newPrefix + prev.substring(oldPrefix.length);
            return prev;
        });
    };

    const handleRename = () => {
        if (!contextMenu) return;
        setRenameDialog({ node: contextMenu.node, value: contextMenu.node.name });
        closeContextMenu();
    };

    const handleDelete = () => {
        if (!contextMenu) return;
        setDeleteDialog({ node: contextMenu.node });
        closeContextMenu();
    };

    const handleCreate = (kind: 'file' | 'folder') => {
        if (!contextMenu) return;
        const node = contextMenu.node;
        const parentDir = node.isDir ? node.path : dirname(node.path);
        setCreateDialog({ parentDir, kind, value: '' });
        closeContextMenu();
    };

    const confirmRename = async () => {
        if (!renameDialog) return;
        const node = renameDialog.node;
        const newName = renameDialog.value.trim();
        if (!newName) {
            showToast('名称不能为空');
            return;
        }
        if (newName === node.name) {
            setRenameDialog(null);
            return;
        }
        const parent = dirname(node.path);
        const newPath = joinPath(parent, newName);
        try {
            await RenamePath(node.path, newPath);
            const wasExpanded = expanded.has(node.path);
            removeCachePrefix(node.path);
            remapExpandedPrefix(node.path, newPath);
            await refreshParentAfterChange(node.path);
            if (node.isDir && wasExpanded) {
                await loadChildren(newPath, true);
            }
            showToast('已重命名');
            setRenameDialog(null);
        } catch (e: any) {
            showToast(e?.message || '重命名失败');
        }
    };

    const confirmCreate = async () => {
        if (!createDialog) return;
        const name = createDialog.value.trim();
        if (!name) {
            showToast('名称不能为空');
            return;
        }
        const newPath = joinPath(createDialog.parentDir, name);
        try {
            if (createDialog.kind === 'folder') {
                await CreateFolder(newPath);
            } else {
                await CreateFile(newPath);
            }
            await loadChildren(createDialog.parentDir, true);
            const nextExpanded = new Set(expanded);
            nextExpanded.add(createDialog.parentDir);
            setExpanded(nextExpanded);
            showToast(createDialog.kind === 'folder' ? '已创建文件夹' : '已创建文件');
            setCreateDialog(null);
        } catch (e: any) {
            showToast(e?.message || '创建失败');
        }
    };

    const confirmDelete = async () => {
        if (!deleteDialog) return;
        const node = deleteDialog.node;
        try {
            await DeletePath(node.path);
            removeCachePrefix(node.path);
            setExpanded(prev => {
                const next = new Set<string>();
                const sep = getSep(node.path);
                const pfx = node.path.endsWith(sep) ? node.path : node.path + sep;
                for (const p of prev) {
                    if (p === node.path || p.startsWith(pfx)) continue;
                    next.add(p);
                }
                return next;
            });
            if (selectedPath === node.path) setSelectedPath('');
            await refreshParentAfterChange(node.path);
            showToast('已删除');
            setDeleteDialog(null);
        } catch (e: any) {
            showToast(e?.message || '删除失败');
        }
    };

    const renderNode = (node: FileNode, depth: number) => {
        const isOpen = expanded.has(node.path);
        const isLoading = !!loadingByPath[node.path];
        const children = childrenByPath[node.path] || [];
        const isSelected = selectedPath === node.path;

        const onClickRow = async () => {
            setSelectedPath(node.path);
            if (node.isDir) {
                await toggleDir(node.path);
            } else if (onFileClick) {
                onFileClick(node.path);
            }
        };

        return (
            <Box key={node.path}>
                <ListItemButton
                    dense
                    selected={isSelected}
                    onClick={onClickRow}
                    onContextMenu={(e) => openContextMenu(e, node)}
                    sx={{
                        borderRadius: 1,
                        mb: 0.25,
                        pl: 1 + depth * 2,
                        pr: 1,
                        color: 'var(--text-primary)',
                        '&.Mui-selected': {
                            bgcolor: 'rgba(64, 150, 255, 0.12)'
                        },
                        '&.Mui-selected:hover': {
                            bgcolor: 'rgba(64, 150, 255, 0.18)'
                        },
                        '&:hover': {
                            bgcolor: 'var(--hover-bg)'
                        }
                    }}
                >
                    <ListItemIcon sx={{ minWidth: 26, color: node.isDir ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                        {node.isDir ? (isOpen ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />) : <FileIcon fontSize="small" />}
                    </ListItemIcon>
                    <ListItemText
                        primary={
                            <Typography variant="body2" sx={{ fontWeight: node.isDir ? 600 : 400, color: 'inherit' }} noWrap>
                                {node.name}
                            </Typography>
                        }
                    />
                    {node.isDir && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {isLoading && <CircularProgress size={14} sx={{ color: 'var(--text-secondary)' }} />}
                            {isOpen ? <ExpandMoreIcon fontSize="small" sx={{ color: 'var(--text-secondary)' }} /> : <ChevronRightIcon fontSize="small" sx={{ color: 'var(--text-secondary)' }} />}
                        </Box>
                    )}
                </ListItemButton>
                {node.isDir && (
                    <Collapse in={isOpen} timeout="auto" unmountOnExit>
                        <List disablePadding dense sx={{ mt: 0.25 }}>
                            {children.map(child => renderNode(child, depth + 1))}
                            {!isLoading && children.length === 0 && (
                                <Box sx={{ pl: 1 + (depth + 1) * 2, py: 0.75 }}>
                                    <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>
                                        Empty
                                    </Typography>
                                </Box>
                            )}
                        </List>
                    </Collapse>
                )}
            </Box>
        );
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--sidebar-bg)' }}>
            <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid var(--border-color)' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.25 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                        <Typography variant="overline" sx={{ color: 'var(--text-secondary)', letterSpacing: 1 }}>
                            {isSearching ? 'SEARCH' : 'EXPLORER'}
                        </Typography>
                        {rootPath && !isSearching && (
                            <Chip size="small" label={basename(rootPath)} sx={{ fontFamily: 'monospace', bgcolor: 'var(--code-header-bg)', color: 'var(--text-secondary)' }} />
                        )}
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                        {!isSearching && (
                            <Tooltip title="Refresh">
                                <IconButton size="small" onClick={refreshRoot} disabled={!rootPath} sx={{ color: 'var(--text-secondary)' }}>
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                        <Tooltip title={rootPath ? "Open Directory" : "Open Folder"}>
                            <IconButton size="small" onClick={rootPath ? openCurrentDirectory : pickRootDirectory} sx={{ color: 'var(--text-secondary)' }}>
                                <OpenInNewIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                </Stack>

                <TextField
                    size="small"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={searchMode === 'filename' ? 'Search files…' : 'Search text…'}
                    fullWidth
                    disabled={!rootPath}
                    InputProps={{
                        startAdornment: <SearchIcon fontSize="small" style={{ marginRight: 8, color: 'var(--text-secondary)' }} />,
                        endAdornment: searchQuery ? (
                            <IconButton size="small" onClick={() => handleSearch('')} sx={{ color: 'var(--text-secondary)' }}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        ) : undefined
                    }}
                    sx={{
                        '& .MuiOutlinedInput-root': {
                            bgcolor: 'var(--input-bg)',
                            color: 'var(--text-primary)',
                            '& fieldset': { borderColor: 'var(--border-color)' },
                            '&:hover fieldset': { borderColor: 'var(--accent-color)' }
                        },
                        '& .MuiInputBase-input': {
                            fontSize: 12
                        }
                    }}
                />

                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={searchMode}
                        onChange={(_, v) => {
                            if (!v) return;
                            setSearchMode(v);
                            if (searchQuery.trim()) handleSearch(searchQuery);
                        }}
                        disabled={!rootPath}
                        sx={{
                            '& .MuiToggleButton-root': {
                                color: 'var(--text-secondary)',
                                borderColor: 'var(--border-color)',
                                fontSize: 11,
                                px: 1
                            },
                            '& .MuiToggleButton-root.Mui-selected': {
                                color: 'var(--accent-color)',
                                borderColor: 'var(--accent-color)',
                                bgcolor: 'rgba(64, 150, 255, 0.10)'
                            }
                        }}
                    >
                        <ToggleButton value="filename">Name</ToggleButton>
                        <ToggleButton value="content">Content</ToggleButton>
                    </ToggleButtonGroup>
                    {isSearching && (
                        <Button size="small" variant="text" onClick={() => handleSearch('')} sx={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                            Clear
                        </Button>
                    )}
                </Stack>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 1 }}>
                {isSearching ? (
                    <Box>
                        {searching && (
                            <Box sx={{ py: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CircularProgress size={18} sx={{ color: 'var(--text-secondary)' }} />
                            </Box>
                        )}
                        {!searching && searchResults.length === 0 && (
                            <Box sx={{ py: 3, textAlign: 'center' }}>
                                <Typography variant="caption" sx={{ color: 'var(--text-secondary)' }}>
                                    No results
                                </Typography>
                            </Box>
                        )}
                        <List dense disablePadding>
                            {searchResults.map((r) => (
                                <Box key={r.path}>
                                    <ListItemButton
                                        dense
                                        onClick={() => {
                                            setSelectedPath(r.path);
                                            if (onFileClick) onFileClick(r.path);
                                        }}
                                        onContextMenu={(e) => openContextMenu(e, r)}
                                        sx={{
                                            borderRadius: 1,
                                            mb: 0.25,
                                            color: 'var(--text-primary)',
                                            '&:hover': { bgcolor: 'var(--hover-bg)' }
                                        }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 26, color: 'var(--text-secondary)' }}>
                                            <FileIcon fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={<Typography variant="body2" noWrap sx={{ color: 'inherit' }}>{r.name}</Typography>}
                                            secondary={
                                                <Box sx={{ mt: 0.25 }}>
                                                    {r.match && (
                                                        <Typography variant="caption" noWrap sx={{ color: 'var(--text-secondary)', display: 'block' }}>
                                                            {r.match}
                                                        </Typography>
                                                    )}
                                                    <Typography variant="caption" noWrap sx={{ color: 'var(--text-secondary)', opacity: 0.75, fontFamily: 'monospace' }}>
                                                        {r.path}
                                                    </Typography>
                                                </Box>
                                            }
                                        />
                                    </ListItemButton>
                                </Box>
                            ))}
                        </List>
                    </Box>
                ) : (
                    <Box>
                        {!treeRootNode ? (
                            <Box sx={{ py: 3, px: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
                                <Typography variant="body2" sx={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                                    EXPLORER 为空，先打开一个文件夹
                                </Typography>
                                <Button
                                    variant="outlined"
                                    onClick={pickRootDirectory}
                                    sx={{
                                        borderColor: 'var(--border-color)',
                                        color: 'var(--text-primary)',
                                        '&:hover': { borderColor: 'var(--accent-color)' }
                                    }}
                                >
                                    打开文件夹
                                </Button>
                            </Box>
                        ) : (
                            <Box>
                                <Divider sx={{ borderColor: 'var(--border-color)', mb: 1 }} />
                                <List dense disablePadding>
                                    {renderNode(treeRootNode, 0)}
                                </List>
                            </Box>
                        )}
                    </Box>
                )}
            </Box>

            <Menu
                open={contextMenu !== null}
                onClose={closeContextMenu}
                anchorReference="anchorPosition"
                anchorPosition={
                    contextMenu !== null
                        ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
                        : undefined
                }
            >
                {contextMenu?.node && !contextMenu.node.isDir && (
                    <MenuItem
                        onClick={() => {
                            if (onFileClick) onFileClick(contextMenu.node.path);
                            closeContextMenu();
                        }}
                    >
                        打开
                    </MenuItem>
                )}

                {contextMenu?.node && contextMenu.node.isDir && (
                    <MenuItem
                        onClick={async () => {
                            await toggleDir(contextMenu.node.path);
                            closeContextMenu();
                        }}
                    >
                        {expanded.has(contextMenu.node.path) ? '收起' : '展开'}
                    </MenuItem>
                )}

                {contextMenu?.node && contextMenu.node.isDir && (
                    <>
                        <MenuItem onClick={() => handleCreate('file')}>
                            <ListItemIcon sx={{ minWidth: 28 }}>
                                <NoteAddIcon fontSize="small" />
                            </ListItemIcon>
                            新建文件
                        </MenuItem>
                        <MenuItem onClick={() => handleCreate('folder')}>
                            <ListItemIcon sx={{ minWidth: 28 }}>
                                <CreateNewFolderIcon fontSize="small" />
                            </ListItemIcon>
                            新建文件夹
                        </MenuItem>
                        <Divider />
                    </>
                )}

                {contextMenu?.node && (
                    <>
                        <MenuItem
                            onClick={async () => {
                                await copyPathToClipboard(contextMenu.node.path);
                                closeContextMenu();
                            }}
                        >
                            <ListItemIcon sx={{ minWidth: 28 }}>
                                <ContentCopyIcon fontSize="small" />
                            </ListItemIcon>
                            复制路径
                        </MenuItem>
                        <MenuItem
                            onClick={async () => {
                                await revealInExplorer(contextMenu.node.path);
                                closeContextMenu();
                            }}
                        >
                            <ListItemIcon sx={{ minWidth: 28 }}>
                                <OpenInNewIcon fontSize="small" />
                            </ListItemIcon>
                            在资源管理器中显示
                        </MenuItem>
                        <Divider />
                        <MenuItem onClick={handleRename}>
                            <ListItemIcon sx={{ minWidth: 28 }}>
                                <RenameIcon fontSize="small" />
                            </ListItemIcon>
                            重命名
                        </MenuItem>
                        <MenuItem onClick={handleDelete} sx={{ color: 'var(--error, #f44336)' }}>
                            <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                                <DeleteIcon fontSize="small" />
                            </ListItemIcon>
                            删除
                        </MenuItem>
                    </>
                )}
            </Menu>

            <Dialog open={renameDialog !== null} onClose={() => setRenameDialog(null)} fullWidth maxWidth="xs">
                <DialogTitle sx={{ bgcolor: 'var(--sidebar-bg)', color: 'var(--text-primary)' }}>重命名</DialogTitle>
                <DialogContent sx={{ bgcolor: 'var(--sidebar-bg)' }}>
                    <TextField
                        autoFocus
                        margin="dense"
                        fullWidth
                        size="small"
                        label="新名称"
                        value={renameDialog?.value || ''}
                        onChange={(e) => setRenameDialog(prev => (prev ? { ...prev, value: e.target.value } : prev))}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                bgcolor: 'var(--input-bg)',
                                color: 'var(--text-primary)',
                                '& fieldset': { borderColor: 'var(--border-color)' },
                                '&:hover fieldset': { borderColor: 'var(--accent-color)' }
                            },
                            '& .MuiInputLabel-root': { color: 'var(--text-secondary)' }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmRename();
                        }}
                    />
                </DialogContent>
                <DialogActions sx={{ bgcolor: 'var(--sidebar-bg)' }}>
                    <Button onClick={() => setRenameDialog(null)} sx={{ color: 'var(--text-secondary)' }}>取消</Button>
                    <Button onClick={confirmRename} sx={{ color: 'var(--accent-color)' }}>确定</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={createDialog !== null} onClose={() => setCreateDialog(null)} fullWidth maxWidth="xs">
                <DialogTitle sx={{ bgcolor: 'var(--sidebar-bg)', color: 'var(--text-primary)' }}>
                    {createDialog?.kind === 'folder' ? '新建文件夹' : '新建文件'}
                </DialogTitle>
                <DialogContent sx={{ bgcolor: 'var(--sidebar-bg)' }}>
                    <TextField
                        autoFocus
                        margin="dense"
                        fullWidth
                        size="small"
                        label="名称"
                        value={createDialog?.value || ''}
                        onChange={(e) => setCreateDialog(prev => (prev ? { ...prev, value: e.target.value } : prev))}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                bgcolor: 'var(--input-bg)',
                                color: 'var(--text-primary)',
                                '& fieldset': { borderColor: 'var(--border-color)' },
                                '&:hover fieldset': { borderColor: 'var(--accent-color)' }
                            },
                            '& .MuiInputLabel-root': { color: 'var(--text-secondary)' }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmCreate();
                        }}
                    />
                </DialogContent>
                <DialogActions sx={{ bgcolor: 'var(--sidebar-bg)' }}>
                    <Button onClick={() => setCreateDialog(null)} sx={{ color: 'var(--text-secondary)' }}>取消</Button>
                    <Button onClick={confirmCreate} sx={{ color: 'var(--accent-color)' }}>确定</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={deleteDialog !== null} onClose={() => setDeleteDialog(null)} fullWidth maxWidth="xs">
                <DialogTitle sx={{ bgcolor: 'var(--sidebar-bg)', color: 'var(--text-primary)' }}>删除</DialogTitle>
                <DialogContent sx={{ bgcolor: 'var(--sidebar-bg)' }}>
                    <Typography variant="body2" sx={{ color: 'var(--text-secondary)' }}>
                        确认删除：{deleteDialog?.node?.name}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ bgcolor: 'var(--sidebar-bg)' }}>
                    <Button onClick={() => setDeleteDialog(null)} sx={{ color: 'var(--text-secondary)' }}>取消</Button>
                    <Button onClick={confirmDelete} sx={{ color: 'var(--error, #f44336)' }}>删除</Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={toast !== null}
                autoHideDuration={2000}
                onClose={() => setToast(null)}
                message={toast?.message || ''}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />
        </Box>
    );
};

export default FileExplorer;
