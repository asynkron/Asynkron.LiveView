export function setupFileSystem(ctx) {
    const {
        dom: {
            fileList,
        },
    } = ctx;

    function flattenTree(nodes) {
        const result = [];
        if (!Array.isArray(nodes)) {
            return result;
        }

        const stack = [...nodes];
        while (stack.length) {
            const node = stack.shift();
            if (!node || typeof node !== 'object') {
                continue;
            }

            if (node.type === 'file') {
                result.push({
                    name: node.name,
                    relativePath: node.relativePath,
                    size: node.size,
                    updated: node.updated,
                });
                continue;
            }

            if (node.type === 'directory' && Array.isArray(node.children)) {
                stack.unshift(...node.children);
            }
        }

        return result;
    }

    function sortTree(nodes) {
        if (!Array.isArray(nodes)) {
            return;
        }
        nodes.sort((a, b) => {
            if (a.type === b.type) {
                return String(a.name || '').localeCompare(String(b.name || ''));
            }
            return a.type === 'directory' ? -1 : 1;
        });
        nodes.forEach((node) => {
            if (node.type === 'directory') {
                sortTree(node.children);
            }
        });
    }

    function buildTreeFromFlatList(flatList) {
        if (!Array.isArray(flatList) || !flatList.length) {
            return [];
        }

        const root = [];
        const directoryMap = new Map();
        directoryMap.set('', root);

        flatList.forEach((file) => {
            const path = typeof file.relativePath === 'string' ? file.relativePath : '';
            const parts = path.split('/');
            const fileName = parts.pop();
            let currentPath = '';
            let parent = root;

            parts.forEach((part) => {
                if (!part) {
                    return;
                }
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                if (!directoryMap.has(currentPath)) {
                    const directoryNode = {
                        type: 'directory',
                        name: part,
                        relativePath: currentPath,
                        children: [],
                    };
                    directoryMap.set(currentPath, directoryNode.children);
                    parent.push(directoryNode);
                }
                parent = directoryMap.get(currentPath);
            });

            parent.push({
                type: 'file',
                name: fileName,
                relativePath: path,
                size: file.size,
                updated: file.updated,
            });
        });

        sortTree(root);
        return root;
    }

    function normaliseFileIndex({ filesValue, treeValue }) {
        let flat = [];
        let tree = [];

        if (Array.isArray(filesValue)) {
            flat = filesValue;
        } else if (filesValue && Array.isArray(filesValue.files)) {
            flat = filesValue.files;
            if (Array.isArray(filesValue.tree)) {
                tree = filesValue.tree;
            }
        }

        if (!tree.length && Array.isArray(treeValue)) {
            tree = treeValue;
        }

        if (tree.length && !flat.length) {
            flat = flattenTree(tree);
        }

        if (!tree.length && flat.length) {
            tree = buildTreeFromFlatList(flat);
        }

        return { files: flat, tree };
    }

    function fallbackMarkdownFor(path) {
        return `# No markdown files found\n\nThe directory \`${path}\` does not contain any markdown files yet.`;
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `Request failed with status ${response.status}`);
        }
        return response.json();
    }

    function ensureExpandedForCurrentFile(filePath) {
        if (typeof filePath !== 'string' || !filePath.includes('/')) {
            return;
        }
        const parts = filePath.split('/');
        parts.pop();
        let prefix = '';
        parts.forEach((segment) => {
            if (!segment) {
                return;
            }
            prefix = prefix ? `${prefix}/${segment}` : segment;
            ctx.expandedDirectories.add(prefix);
        });
    }

    function renderTreeNode(node, depth, visited) {
        const item = document.createElement('li');
        item.className = `tree-node ${node.type === 'directory' ? 'directory-node' : 'file-node'}`;

        if (node.type === 'directory') {
            const pathKey = typeof node.relativePath === 'string' ? node.relativePath : '';
            visited.add(pathKey);

            if (!ctx.knownDirectories.has(pathKey) && !ctx.expandedDirectories.has(pathKey)) {
                ctx.expandedDirectories.add(pathKey);
            }

            const row = document.createElement('div');
            row.className = 'tree-row directory-row';
            row.style.paddingLeft = `${depth * 16}px`;

            const isExpanded = ctx.expandedDirectories.has(pathKey);
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'tree-toggle';
            toggle.setAttribute('aria-expanded', String(isExpanded));
            toggle.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`);
            toggle.textContent = isExpanded ? '▾' : '▸';
            toggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleDirectory(pathKey);
            });

            const label = document.createElement('button');
            label.type = 'button';
            label.className = 'tree-label directory-label';

            const folderIcon = document.createElement('i');
            folderIcon.className = isExpanded ? 'directory-icon fas fa-folder-open' : 'directory-icon fas fa-folder';
            const labelText = document.createElement('span');
            labelText.textContent = node.name;
            label.appendChild(folderIcon);
            label.appendChild(labelText);

            label.addEventListener('click', (event) => {
                event.preventDefault();
                toggleDirectory(pathKey);
            });

            row.appendChild(toggle);
            row.appendChild(label);
            item.appendChild(row);

            const childrenList = document.createElement('ul');
            childrenList.className = 'tree-children';
            if (!isExpanded) {
                childrenList.classList.add('collapsed');
            }
            const children = Array.isArray(node.children) ? node.children : [];
            children.forEach((child) => {
                childrenList.appendChild(renderTreeNode(child, depth + 1, visited));
            });
            item.appendChild(childrenList);
            return item;
        }

        const button = document.createElement('button');
        button.className = 'file-button';
        button.type = 'button';

        const icon = document.createElement('i');
        icon.className = 'file-icon fab fa-markdown';
        const text = document.createElement('span');
        text.textContent = node.name;

        button.appendChild(icon);
        button.appendChild(text);
        button.dataset.file = node.relativePath;
        button.style.paddingLeft = `${depth * 16 + 24}px`;
        button.addEventListener('click', () => {
            if (node.relativePath !== ctx.currentFile) {
                selectFile(node.relativePath);
            }
        });
        item.appendChild(button);
        return item;
    }

    function renderFileList() {
        if (!fileList) {
            return;
        }

        fileList.innerHTML = '';

        const treeToRender = Array.isArray(ctx.fileTree) && ctx.fileTree.length
            ? ctx.fileTree
            : buildTreeFromFlatList(ctx.files);

        if (!treeToRender.length) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'No markdown files yet';
            fileList.appendChild(empty);
            return;
        }

        ensureExpandedForCurrentFile(ctx.currentFile);

        const visited = new Set();
        const fragment = document.createDocumentFragment();
        treeToRender.forEach((node) => {
            fragment.appendChild(renderTreeNode(node, 0, visited));
        });
        fileList.appendChild(fragment);

        const stale = [];
        ctx.expandedDirectories.forEach((value) => {
            if (!visited.has(value)) {
                stale.push(value);
            }
        });
        stale.forEach((value) => ctx.expandedDirectories.delete(value));

        ctx.knownDirectories.clear();
        visited.forEach((value) => ctx.knownDirectories.add(value));

        updateActiveFileHighlight();
    }

    function toggleDirectory(pathKey) {
        if (!pathKey && pathKey !== '') {
            return;
        }
        if (ctx.expandedDirectories.has(pathKey)) {
            ctx.expandedDirectories.delete(pathKey);
        } else {
            ctx.expandedDirectories.add(pathKey);
        }
        renderFileList();
    }

    function updateActiveFileHighlight() {
        if (!fileList) {
            return;
        }
        fileList.querySelectorAll('.file-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.file === ctx.currentFile);
        });
    }

    async function loadFile(file, options = {}) {
        const { skipHistory = false, replaceHistory = false } = options;
        if (ctx.isEditing || ctx.isPreviewing) {
            ctx.setStatus('Editing session closed because the file was reloaded.');
            ctx.exitEditMode();
        } else {
            ctx.setStatus('');
        }
        const url = `/api/file${ctx.buildQuery({ file })}`;
        try {
            const data = await fetchJson(url);
            ctx.resolvedRootPath = data.rootPath || ctx.resolvedRootPath;
            ctx.currentFile = data.file || file;
            ctx.renderMarkdown(data.content || '', { updateCurrent: true });
            ctx.setHasPendingChanges(false);
            updateActiveFileHighlight();
            ctx.updateHeader();
            ctx.updateLocation(ctx.currentFile, { replace: replaceHistory || skipHistory });
        } catch (err) {
            ctx.setStatus(err.message);
            console.error('Failed to load file', err);
        }
    }

    async function saveCurrentFile() {
        if (!ctx.isEditing || !ctx.currentFile) {
            return false;
        }

        const editor = ctx.ensureEditorInstance ? ctx.ensureEditorInstance() : null;
        if (editor && !ctx.isPreviewing) {
            ctx.draftContent = editor.getValue();
        }

        const contentToSave = ctx.draftContent;
        ctx.setStatus('Saving changes…');

        try {
            await fetchJson(`/api/file${ctx.buildQuery({ file: ctx.currentFile })}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: contentToSave }),
            });
            ctx.currentContent = contentToSave;
            ctx.exitEditMode();
            ctx.setStatus('Changes saved.');
            updateActiveFileHighlight();
            return true;
        } catch (err) {
            ctx.setStatus(err.message);
            console.error('Save failed', err);
            return false;
        }
    }

    async function refreshFiles() {
        const url = `/api/files${ctx.buildQuery({})}`;
        const data = await fetchJson(url);
        ctx.resolvedRootPath = data.rootPath || ctx.resolvedRootPath;
        const updatedIndex = normaliseFileIndex({ filesValue: data.files, treeValue: data.tree });
        ctx.files = updatedIndex.files;
        ctx.fileTree = updatedIndex.tree;
        renderFileList();
        if (!ctx.files.find((entry) => entry.relativePath === ctx.currentFile)) {
            ctx.currentFile = ctx.files.length ? ctx.files[0].relativePath : null;
            if (ctx.currentFile) {
                await loadFile(ctx.currentFile, { replaceHistory: true });
            } else {
                ctx.currentFile = null;
                ctx.exitEditMode({ restoreContent: false });
                ctx.renderMarkdown(
                    fallbackMarkdownFor(ctx.resolvedRootPath || ctx.originalPathArgument || 'the selected path'),
                    { updateCurrent: true }
                );
                ctx.updateLocation('', { replace: true });
                ctx.updateHeader();
            }
        } else {
            updateActiveFileHighlight();
            ctx.updateHeader();
        }
    }

    async function selectFile(file) {
        if (ctx.hasPendingChanges) {
            const decision = await ctx.promptUnsavedChanges({ nextFile: file });
            if (decision === 'cancel') {
                return;
            }
            if (decision === 'save') {
                const saved = await saveCurrentFile();
                if (!saved) {
                    return;
                }
            } else if (decision === 'discard') {
                ctx.exitEditMode();
                ctx.setStatus('Changes discarded.');
            }
        } else if (ctx.isEditing || ctx.isPreviewing) {
            ctx.exitEditMode();
        }
        await loadFile(file);
    }

    function resetViewToFallback(options = {}) {
        const { skipHistory = false } = options;
        ctx.exitEditMode({ restoreContent: false });
        ctx.currentFile = null;
        const fallback = fallbackMarkdownFor(ctx.resolvedRootPath || ctx.originalPathArgument || 'the selected path');
        ctx.renderMarkdown(fallback, { updateCurrent: true });
        updateActiveFileHighlight();
        ctx.updateHeader();
        if (!skipHistory) {
            ctx.updateLocation('', { replace: true });
        }
    }

    function connectWebSocket() {
        if (ctx.websocket) {
            ctx.websocket.close();
        }

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const websocket = new WebSocket(`${protocol}://${window.location.host}/ws`);
        ctx.websocket = websocket;

        websocket.addEventListener('open', () => {
            ctx.setConnectionStatus(true);
            websocket.send(JSON.stringify({ type: 'subscribe', path: ctx.originalPathArgument }));
        });

        websocket.addEventListener('message', async (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'directory_update') {
                    ctx.resolvedRootPath = payload.path || ctx.resolvedRootPath;
                    const updatedIndex = normaliseFileIndex({
                        filesValue: payload.files,
                        treeValue: payload.tree,
                    });
                    ctx.files = updatedIndex.files;
                    ctx.fileTree = updatedIndex.tree;
                    renderFileList();
                    if (!ctx.files.find((entry) => entry.relativePath === ctx.currentFile)) {
                        ctx.currentFile = ctx.files.length ? ctx.files[0].relativePath : null;
                        if (ctx.currentFile) {
                            await loadFile(ctx.currentFile, { replaceHistory: true });
                        } else {
                            ctx.currentFile = null;
                            ctx.exitEditMode({ restoreContent: false });
                            ctx.renderMarkdown(
                                fallbackMarkdownFor(ctx.resolvedRootPath || ctx.originalPathArgument || 'the selected path'),
                                { updateCurrent: true }
                            );
                            ctx.updateLocation('', { replace: true });
                            ctx.updateHeader();
                        }
                    } else {
                        updateActiveFileHighlight();
                        ctx.updateHeader();
                    }
                } else if (payload.type === 'file_changed') {
                    if (payload.file && payload.file === ctx.currentFile) {
                        await loadFile(ctx.currentFile, { replaceHistory: true });
                    }
                }
            } catch (err) {
                console.error('Failed to process websocket event', err);
            }
        });

        const scheduleReconnect = () => {
            if (ctx.reconnectTimer) {
                return;
            }
            ctx.reconnectTimer = window.setTimeout(() => {
                ctx.reconnectTimer = null;
                connectWebSocket();
            }, 1500);
        };

        websocket.addEventListener('close', () => {
            ctx.setConnectionStatus(false);
            scheduleReconnect();
        });

        websocket.addEventListener('error', () => {
            websocket.close();
        });
    }

    const initialIndex = normaliseFileIndex({
        filesValue: ctx.initialFilesValue,
        treeValue: ctx.initialTreeValue,
    });
    ctx.files = initialIndex.files;
    ctx.fileTree = initialIndex.tree;

    ctx.renderFileList = renderFileList;
    ctx.toggleDirectory = toggleDirectory;
    ctx.updateActiveFileHighlight = updateActiveFileHighlight;
    ctx.normaliseFileIndex = normaliseFileIndex;
    ctx.buildTreeFromFlatList = buildTreeFromFlatList;
    ctx.fetchJson = fetchJson;
    ctx.refreshFiles = refreshFiles;
    ctx.loadFile = loadFile;
    ctx.saveCurrentFile = saveCurrentFile;
    ctx.selectFile = selectFile;
    ctx.resetViewToFallback = resetViewToFallback;
    ctx.connectWebSocket = connectWebSocket;
    ctx.fallbackMarkdownFor = fallbackMarkdownFor;
}
