export function initNavigation(context, viewerApi) {
    if (!context) {
        throw new Error('Navigation context is required');
    }

    const {
        elements: {
            fileList,
            downloadButton,
            deleteButton,
            unsavedChangesModal,
            unsavedChangesFilename,
            unsavedChangesMessage,
            unsavedChangesDetail,
            unsavedChangesSaveButton,
            unsavedChangesDiscardButton,
            unsavedChangesCancelButton,
        } = {},
        setStatus = () => {},
    } = context;

    const state = {
        activeUnsavedPrompt: null,
        editorApi: null,
    };

    function bindEditorApi(editorApi) {
        state.editorApi = editorApi || null;
    }

    function fetchJson(url, options) {
        return defaultFetchJson(url, options);
    }

    async function refreshFiles() {
        const data = await fetchJson(`/api/files${context.buildQuery({})}`);
        if (data?.rootPath) {
            context.setResolvedRootPath(data.rootPath);
        }
        const updatedIndex = context.normaliseFileIndex({
            filesValue: data?.files,
            treeValue: data?.tree,
        });
        context.setFiles(updatedIndex.files);
        context.setFileTree(updatedIndex.tree);
        renderFileList();

        const files = context.getFiles();
        const currentFile = context.getCurrentFile();
        if (!files.find((entry) => entry.relativePath === currentFile)) {
            const firstFile = files.length ? files[0].relativePath : null;
            if (firstFile) {
                await loadFile(firstFile, { replaceHistory: true });
            } else {
                context.setCurrentFile(null);
                state.editorApi?.exitEditMode({ restoreContent: false });
                viewerApi?.render(
                    context.fallbackMarkdownFor(
                        context.getResolvedRootPath() || context.getOriginalPathArgument() || 'the selected path',
                    ),
                    { updateCurrent: true },
                );
                context.updateLocation('', { replace: true });
                context.updateHeader();
            }
        } else {
            context.updateActiveFileHighlight();
            context.updateHeader();
        }
    }

    function renderFileList() {
        if (!fileList) {
            return;
        }

        fileList.innerHTML = '';

        const tree = context.getFileTree();
        const treeToRender = Array.isArray(tree) && tree.length
            ? tree
            : context.buildTreeFromFlatList(context.getFiles());

        if (!treeToRender.length) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'No markdown files yet';
            fileList.appendChild(empty);
            return;
        }

        ensureExpandedForCurrentFile(context.getCurrentFile());

        const visited = new Set();
        const fragment = document.createDocumentFragment();
        treeToRender.forEach((node) => {
            fragment.appendChild(renderTreeNode(node, 0, visited));
        });
        fileList.appendChild(fragment);

        const expanded = context.getExpandedDirectories();
        const known = context.getKnownDirectories();
        const stale = [];
        expanded.forEach((value) => {
            if (!visited.has(value)) {
                stale.push(value);
            }
        });
        stale.forEach((value) => expanded.delete(value));

        known.clear();
        visited.forEach((value) => known.add(value));

        updateActiveFileHighlight();
    }

    function renderTreeNode(node, depth, visited) {
        const item = document.createElement('li');
        item.className = `tree-node ${node.type === 'directory' ? 'directory-node' : 'file-node'}`;

        if (node.type === 'directory') {
            const pathKey = typeof node.relativePath === 'string' ? node.relativePath : '';
            visited.add(pathKey);

            const expandedDirectories = context.getExpandedDirectories();
            const knownDirectories = context.getKnownDirectories();

            if (!knownDirectories.has(pathKey) && !expandedDirectories.has(pathKey)) {
                expandedDirectories.add(pathKey);
            }

            const row = document.createElement('div');
            row.className = 'tree-row directory-row';
            row.style.paddingLeft = `${depth * 16}px`;

            const isExpanded = expandedDirectories.has(pathKey);
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
            if (node.relativePath !== context.getCurrentFile()) {
                void selectFile(node.relativePath);
            }
        });
        item.appendChild(button);
        return item;
    }

    function ensureExpandedForCurrentFile(filePath) {
        if (typeof filePath !== 'string' || !filePath.includes('/')) {
            return;
        }
        const parts = filePath.split('/');
        parts.pop();
        let prefix = '';
        const expandedDirectories = context.getExpandedDirectories();
        parts.forEach((segment) => {
            if (!segment) {
                return;
            }
            prefix = prefix ? `${prefix}/${segment}` : segment;
            expandedDirectories.add(prefix);
        });
    }

    function toggleDirectory(pathKey) {
        if (pathKey === undefined || pathKey === null) {
            return;
        }
        const expandedDirectories = context.getExpandedDirectories();
        if (expandedDirectories.has(pathKey)) {
            expandedDirectories.delete(pathKey);
        } else {
            expandedDirectories.add(pathKey);
        }
        renderFileList();
    }

    function updateActiveFileHighlight() {
        if (!fileList) {
            return;
        }
        const currentFile = context.getCurrentFile();
        fileList.querySelectorAll('.file-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.file === currentFile);
        });
    }

    async function loadFile(file, options = {}) {
        const { skipHistory = false, replaceHistory = false } = options || {};
        if (context.isEditing() || context.isPreviewing()) {
            setStatus('Editing session closed because the file was reloaded.');
            state.editorApi?.exitEditMode();
        } else {
            setStatus('');
        }
        const url = `/api/file${context.buildQuery({ file })}`;
        try {
            const data = await fetchJson(url);
            if (data?.rootPath) {
                context.setResolvedRootPath(data.rootPath);
            }
            const nextFile = data?.file || file;
            context.setCurrentFile(nextFile, { silent: true });
            viewerApi?.render(data?.content || '', { updateCurrent: true });
            context.setHasPendingChanges(false);
            context.updateActiveFileHighlight();
            context.updateHeader();
            context.updateLocation(nextFile, { replace: replaceHistory || skipHistory });
        } catch (error) {
            setStatus(error?.message || 'Failed to load file.');
            console.error('Failed to load file', error);
        }
    }

    async function saveCurrentFileIfNeeded() {
        if (!state.editorApi) {
            return false;
        }
        return state.editorApi.saveCurrentFile();
    }

    async function selectFile(file) {
        if (context.hasPendingChanges()) {
            const decision = await promptUnsavedChanges({ nextFile: file });
            if (decision === 'cancel') {
                return;
            }
            if (decision === 'save') {
                const saved = await saveCurrentFileIfNeeded();
                if (!saved) {
                    return;
                }
            } else if (decision === 'discard') {
                state.editorApi?.exitEditMode();
                setStatus('Changes discarded.');
            }
        } else if (context.isEditing() || context.isPreviewing()) {
            state.editorApi?.exitEditMode();
        }
        await loadFile(file);
    }

    function promptUnsavedChanges(details = {}) {
        if (!unsavedChangesModal) {
            return Promise.resolve('cancel');
        }

        if (state.activeUnsavedPrompt) {
            return state.activeUnsavedPrompt;
        }

        const nextFile = typeof details.nextFile === 'string' ? details.nextFile : '';
        const displayName = context.getCurrentFile() || 'this document';
        if (unsavedChangesFilename) {
            unsavedChangesFilename.textContent = displayName;
        }
        if (unsavedChangesMessage) {
            unsavedChangesMessage.setAttribute('data-current-file', displayName);
        }
        if (unsavedChangesDetail) {
            if (nextFile && nextFile !== context.getCurrentFile()) {
                unsavedChangesDetail.textContent = `Switch to “${nextFile}” without saving?`;
            } else {
                unsavedChangesDetail.textContent = 'What would you like to do?';
            }
        }

        unsavedChangesModal.classList.add('visible');
        document.body.classList.add('modal-open');

        const promise = new Promise((resolve) => {
            const cleanup = () => {
                unsavedChangesModal.classList.remove('visible');
                document.body.classList.remove('modal-open');
                unsavedChangesSaveButton?.removeEventListener('click', onSave);
                unsavedChangesDiscardButton?.removeEventListener('click', onDiscard);
                unsavedChangesCancelButton?.removeEventListener('click', onCancel);
                unsavedChangesModal.removeEventListener('keydown', onKeyDown, true);
                unsavedChangesModal.removeEventListener('click', onOverlayClick);
                state.activeUnsavedPrompt = null;
            };

            const choose = (result) => {
                cleanup();
                resolve(result);
            };

            const onSave = () => choose('save');
            const onDiscard = () => choose('discard');
            const onCancel = () => choose('cancel');
            const onKeyDown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    choose('cancel');
                }
            };
            const onOverlayClick = (event) => {
                if (event.target === unsavedChangesModal) {
                    choose('cancel');
                }
            };

            unsavedChangesSaveButton?.addEventListener('click', onSave);
            unsavedChangesDiscardButton?.addEventListener('click', onDiscard);
            unsavedChangesCancelButton?.addEventListener('click', onCancel);
            unsavedChangesModal.addEventListener('keydown', onKeyDown, true);
            unsavedChangesModal.addEventListener('click', onOverlayClick);

            window.setTimeout(() => {
                if (typeof unsavedChangesSaveButton?.focus === 'function') {
                    unsavedChangesSaveButton.focus();
                } else if (typeof unsavedChangesDiscardButton?.focus === 'function') {
                    unsavedChangesDiscardButton.focus();
                } else {
                    unsavedChangesModal.focus({ preventScroll: true });
                }
            }, 0);
        });

        state.activeUnsavedPrompt = promise;
        return promise;
    }

    function attachActionHandlers() {
        downloadButton?.addEventListener('click', async () => {
            const currentFile = context.getCurrentFile();
            if (!currentFile) {
                return;
            }
            try {
                const data = await fetchJson(`/api/file${context.buildQuery({ file: currentFile })}`);
                const blob = new Blob([data?.content || ''], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = currentFile;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (error) {
                setStatus(error?.message || 'Download failed.');
                console.error('Download failed', error);
            }
        });

        deleteButton?.addEventListener('click', async () => {
            const currentFile = context.getCurrentFile();
            if (!currentFile) {
                return;
            }
            const confirmed = window.confirm(`Delete ${currentFile}?`);
            if (!confirmed) {
                return;
            }
            try {
                await fetchJson(`/api/file${context.buildQuery({ file: currentFile })}`, { method: 'DELETE' });
                setStatus('File deleted.');
                await refreshFiles();
            } catch (error) {
                setStatus(error?.message || 'Delete failed.');
                console.error('Delete failed', error);
            }
        });
    }

    attachActionHandlers();

    return {
        bindEditorApi,
        fetchJson,
        renderFileList,
        refreshFiles,
        loadFile,
        selectFile,
        promptUnsavedChanges,
        updateActiveFileHighlight,
    };
}

async function defaultFetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
    }
    return response.json();
}
