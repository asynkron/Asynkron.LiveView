import './vendor_globals.js';
import { initLayout } from './viewer/layout.js';
import { renderMarkdown, captureHeadingLocations, getHeadingLocation } from './viewer/markdown.js';

// Client-side bootstrap logic for the unified markdown viewer UI.
function bootstrap() {
    const state = window.__INITIAL_STATE__ || {};
    const content = document.getElementById('content');
    const fileName = document.getElementById('file-name');
    const sidebarPath = document.getElementById('sidebar-path');
    const fileList = document.getElementById('file-list');
    const downloadButton = document.getElementById('download-button');
    const deleteButton = document.getElementById('delete-button');
    const editButton = document.getElementById('edit-button');
    const previewButton = document.getElementById('preview-button');
    const saveButton = document.getElementById('save-button');
    const cancelButton = document.getElementById('cancel-button');
    const editorContainer = document.getElementById('editor-container');
    const offlineOverlay = document.getElementById('offline-overlay');
    const unsavedChangesModal = document.getElementById('unsaved-changes-modal');
    const unsavedChangesFilename = document.getElementById('unsaved-changes-filename');
    const unsavedChangesMessage = document.getElementById('unsaved-changes-message');
    const unsavedChangesDetail = document.getElementById('unsaved-changes-detail');
    const unsavedChangesSaveButton = document.getElementById('unsaved-changes-save');
    const unsavedChangesDiscardButton = document.getElementById('unsaved-changes-discard');
    const unsavedChangesCancelButton = document.getElementById('unsaved-changes-cancel');
    const tocList = document.getElementById('toc-list');
    const tocSidebar = document.querySelector('.sidebar--toc');
    const fileSidebar = document.querySelector('.sidebar--files');
    const tocSplitter = document.getElementById('toc-splitter');
    const fileSplitter = document.getElementById('file-splitter');
    const dockviewRoot = document.getElementById('dockview-root');
    const appShell = document.querySelector('.app-shell');
    const rootElement = document.documentElement;
    const viewerSection = document.querySelector('.viewer');
    const terminalPanel = document.getElementById('terminal-panel');
    const terminalContainer = document.getElementById('terminal-container');
    const terminalToggleButton = document.getElementById('terminal-toggle');
    const terminalStatusText = document.getElementById('terminal-status');
    const terminalResizeHandle = document.getElementById('terminal-resize-handle');
    const terminalStorageKey = 'terminalPanelHeight';
    const panelToggleButtons = Array.from(document.querySelectorAll('[data-panel-toggle]'));

    if (content) {
        content.addEventListener('click', handleHeadingActionClick);
    }

    const initialIndex = normaliseFileIndex({
        filesValue: state.files,
        treeValue: state.fileTree,
    });
    let currentFile = state.selectedFile || null;
    let files = initialIndex.files;
    let fileTree = initialIndex.tree;
    let websocket = null;
    let reconnectTimer = null;
    let isEditing = false;
    let isPreviewing = false;
    let editorInstance = null;
    let draftContent = '';
    let currentContent = typeof state.content === 'string' ? state.content : '';
    let hasPendingChanges = false;
    let suppressEditorChangeEvents = false;
    let activeUnsavedPrompt = null;

    const originalPathArgument = state.pathArgument || '';
    let resolvedRootPath = state.rootPath || '';
    const initialFileFromLocation = fileFromSearch(window.location.search);
    const markdownContext = {
        content,
        tocList,
        getCurrentFile: () => currentFile,
        setCurrentContent(value) {
            currentContent = value;
        },
        buildQuery,
    };

    const layout = initLayout({
        dockviewRoot,
        appShell,
        viewerSection,
        tocSidebar,
        fileSidebar,
        terminalPanel,
        tocSplitter,
        fileSplitter,
        rootElement,
        panelToggleButtons,
        getCurrentFile: () => currentFile,
    });
    const dockviewSetup = layout.dockviewSetup;
    const dockviewIsActive = layout.dockviewIsActive;
    document.body.classList.toggle('dockview-active', dockviewIsActive);
    layout.refreshPanelToggleStates();

    if (dockviewIsActive && dockviewRoot) {
        dockviewRoot.addEventListener('pointerdown', layout.handlePointerDown);
        window.addEventListener('pointerup', layout.handlePointerFinish);
        window.addEventListener('pointercancel', layout.handlePointerFinish);
    }
    let headingHighlightLine = null;
    let headingHighlightTimeout = null;
    const expandedDirectories = new Set();
    const knownDirectories = new Set();
    let terminalInstance = null;
    let terminalFitAddon = null;
    let terminalSocket = null;
    let terminalReconnectTimer = null;
    let terminalLibraryRetryTimer = null;
    let terminalCollapsed = false;
    let terminalHeight = null;
    let pendingTerminalFitFrame = null;
    let terminalResizeObserver = null;
    const terminalDecoder = new TextDecoder();
    let terminalLastStatusMessage = '';

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

    function buildTreeFromFlatList(flatList) {
        if (!Array.isArray(flatList) || !flatList.length) {
            return [];
        }

        const root = [];
        const directoryMap = new Map();
        directoryMap.set('', root);

        function ensureDirectory(path, name) {
            if (directoryMap.has(path)) {
                return directoryMap.get(path);
            }

            const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
            const parentChildren = directoryMap.get(parentPath) || root;
            const node = {
                type: 'directory',
                name,
                relativePath: path,
                children: [],
            };
            parentChildren.push(node);
            directoryMap.set(path, node.children);
            return node.children;
        }

        flatList.forEach((file) => {
            if (!file || typeof file.relativePath !== 'string') {
                return;
            }

            const segments = file.relativePath.split('/');
            const fileName = segments.pop();
            let currentPath = '';
            segments.forEach((segment) => {
                if (!segment) {
                    return;
                }
                currentPath = currentPath ? `${currentPath}/${segment}` : segment;
                ensureDirectory(currentPath, segment);
            });

            const parentPath = segments.join('/');
            const parentChildren = directoryMap.get(parentPath) || root;
            parentChildren.push({
                type: 'file',
                name: fileName,
                relativePath: file.relativePath,
                size: file.size,
                updated: file.updated,
            });
        });

        sortTree(root);
        return root;
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

    function getCssNumber(variableName, fallback) {
        if (typeof variableName !== 'string' || !variableName) {
            return typeof fallback === 'number' ? fallback : 0;
        }

        try {
            const computed = getComputedStyle(rootElement).getPropertyValue(variableName);
            const parsed = Number.parseFloat(computed);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        } catch (error) {
            console.warn('Failed to read CSS variable', variableName, error);
        }

        return typeof fallback === 'number' ? fallback : 0;
    }

    function clearEditorHeadingHighlight() {
        if (!editorInstance || headingHighlightLine === null) {
            headingHighlightLine = null;
            return;
        }

        try {
            editorInstance.removeLineClass(headingHighlightLine, 'background', 'heading-target-line');
        } catch (error) {
            console.warn('Failed to remove heading highlight', error);
        }

        headingHighlightLine = null;
    }

    function highlightEditorLine(lineNumber) {
        const editor = ensureEditorInstance();
        if (!editor || typeof editor.addLineClass !== 'function') {
            return;
        }

        if (headingHighlightTimeout) {
            window.clearTimeout(headingHighlightTimeout);
            headingHighlightTimeout = null;
        }

        if (headingHighlightLine !== null) {
            try {
                editor.removeLineClass(headingHighlightLine, 'background', 'heading-target-line');
            } catch (error) {
                console.warn('Failed to clear previous heading highlight', error);
            }
        }

        try {
            editor.addLineClass(lineNumber, 'background', 'heading-target-line');
            headingHighlightLine = lineNumber;
        } catch (error) {
            console.warn('Failed to apply heading highlight', error);
            headingHighlightLine = null;
            return;
        }

        headingHighlightTimeout = window.setTimeout(() => {
            const instance = ensureEditorInstance();
            if (instance && headingHighlightLine !== null) {
                try {
                    instance.removeLineClass(headingHighlightLine, 'background', 'heading-target-line');
                } catch (error) {
                    console.warn('Failed to remove heading highlight after delay', error);
                }
            }
            headingHighlightLine = null;
            headingHighlightTimeout = null;
        }, 2000);
    }

    function handleHeadingActionClick(event) {
        const button = event.target.closest('.heading-action-button');
        if (!button) {
            return;
        }

        if (!content || !content.contains(button)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const action = button.dataset.headingAction;
        const slug = button.dataset.headingSlug;

        if (!slug) {
            return;
        }

        if (action === 'edit') {
            jumpToHeadingInEditor(slug);
            return;
        }

        if (action === 'copy') {
            copyHeadingLink(slug);
        }
    }

    function jumpToHeadingInEditor(slug) {
        if (!slug) {
            return;
        }

        if (!currentFile) {
            setStatus('Open a markdown file to edit sections.');
            return;
        }

        const focusEditorOnHeading = () => {
            const editor = ensureEditorInstance();
            if (!editor) {
                setStatus('Editor resources are still loading. Please try again in a moment.');
                return;
            }

            let location = getHeadingLocation(markdownContext, slug);
            if (!location) {
                const source = typeof editor.getValue === 'function' ? editor.getValue() : currentContent;
                captureHeadingLocations(markdownContext, source);
                location = getHeadingLocation(markdownContext, slug);
            }

            if (!location) {
                setStatus('Unable to locate this section in the editor.');
                return;
            }

            const targetPosition = { line: location.line, ch: location.column || 0 };

            editor.operation(() => {
                editor.setCursor(targetPosition);
                const bottomLine = Math.min(editor.lineCount() - 1, targetPosition.line + 5);
                editor.scrollIntoView({ from: targetPosition, to: { line: bottomLine, ch: 0 } }, 200);
                editor.focus();
            });

            highlightEditorLine(location.line);
            setStatus('Jumped to section in editor.');
        };

        if (!isEditing) {
            enterEditMode();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        if (isPreviewing) {
            returnToCodeMode();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        focusEditorOnHeading();
    }

    function copyHeadingLink(slug) {
        if (!slug) {
            return;
        }

        const baseUrl = window.location.href.split('#')[0];
        const link = `${baseUrl}#${slug}`;

        const notifyFailure = (error) => {
            if (error) {
                console.warn('Failed to copy heading link', error);
            }
            setStatus(`Copy failed. Link: ${link}`);
        };

        const notifySuccess = () => {
            setStatus('Copied link to clipboard.');
        };

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(link).then(notifySuccess).catch((error) => {
                fallbackCopyLink(link, notifySuccess, () => notifyFailure(error));
            });
            return;
        }

        fallbackCopyLink(link, notifySuccess, notifyFailure);
    }

    function fallbackCopyLink(text, onSuccess, onFailure) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        let succeeded = false;
        let lastError = null;
        try {
            succeeded = document.execCommand('copy');
        } catch (error) {
            lastError = error;
        }

        document.body.removeChild(textarea);

        if (succeeded) {
            if (typeof onSuccess === 'function') {
                onSuccess();
            }
            return;
        }

        if (typeof onFailure === 'function') {
            onFailure(lastError);
        }
    }

    function setStatus(message) {
        // Status banner removed; keep function to avoid touching callers.
        void message;
    }

    function setConnectionStatus(connected) {
        offlineOverlay.classList.toggle('visible', !connected);
    }

    function setHasPendingChanges(value) {
        const nextValue = Boolean(value);
        if (nextValue === hasPendingChanges) {
            return;
        }
        hasPendingChanges = nextValue;
        document.body.classList.toggle('document-has-pending-changes', hasPendingChanges);
        updateHeader();
    }

    function updateDocumentPanelTitle() {
        const viewerPanel = dockviewSetup?.panels?.viewer;
        if (!viewerPanel) {
            return;
        }

        const baseTitle = currentFile || 'Document';
        const title = hasPendingChanges && currentFile ? `${baseTitle} ●` : baseTitle;
        const panelApi = viewerPanel?.api;

        if (panelApi && typeof panelApi.setTitle === 'function') {
            panelApi.setTitle(title);
        } else if (typeof viewerPanel.setTitle === 'function') {
            viewerPanel.setTitle(title);
        }
    }

    function promptUnsavedChanges(context = {}) {
        if (!unsavedChangesModal) {
            return Promise.resolve('cancel');
        }

        if (activeUnsavedPrompt) {
            return activeUnsavedPrompt;
        }

        const nextFile = typeof context.nextFile === 'string' ? context.nextFile : '';
        const displayName = currentFile || 'this document';
        if (unsavedChangesFilename) {
            unsavedChangesFilename.textContent = displayName;
        }
        if (unsavedChangesMessage) {
            unsavedChangesMessage.setAttribute('data-current-file', displayName);
        }
        if (unsavedChangesDetail) {
            if (nextFile && nextFile !== currentFile) {
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
                if (unsavedChangesSaveButton) {
                    unsavedChangesSaveButton.removeEventListener('click', onSave);
                }
                if (unsavedChangesDiscardButton) {
                    unsavedChangesDiscardButton.removeEventListener('click', onDiscard);
                }
                if (unsavedChangesCancelButton) {
                    unsavedChangesCancelButton.removeEventListener('click', onCancel);
                }
                unsavedChangesModal.removeEventListener('keydown', onKeyDown, true);
                unsavedChangesModal.removeEventListener('click', onOverlayClick);
                activeUnsavedPrompt = null;
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

            if (unsavedChangesSaveButton) {
                unsavedChangesSaveButton.addEventListener('click', onSave);
            }
            if (unsavedChangesDiscardButton) {
                unsavedChangesDiscardButton.addEventListener('click', onDiscard);
            }
            if (unsavedChangesCancelButton) {
                unsavedChangesCancelButton.addEventListener('click', onCancel);
            }

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

        activeUnsavedPrompt = promise;
        return promise;
    }

    function updateHeader() {
        const hasFile = Boolean(currentFile);
        const indicator = hasPendingChanges && hasFile ? ' ●' : '';

        if (fileName) {
            if (dockviewIsActive) {
                if (hasFile) {
                    fileName.textContent = `Markdown Viewer${indicator}`;
                    fileName.classList.add('hidden');
                } else {
                    fileName.textContent = 'No file selected';
                    fileName.classList.remove('hidden');
                }
            } else {
                fileName.classList.remove('hidden');
                const baseName = hasFile ? currentFile : 'No file selected';
                fileName.textContent = hasFile ? `${baseName}${indicator}` : baseName;
            }
        }

        sidebarPath.textContent = resolvedRootPath || originalPathArgument || 'Unknown';
        downloadButton.disabled = !hasFile;
        deleteButton.disabled = !hasFile;
        editButton.disabled = !hasFile && !isEditing;
        previewButton.disabled = !hasFile;
        saveButton.disabled = !hasFile;
        cancelButton.disabled = false;
        updateActionVisibility();
        updateDocumentPanelTitle();
    }

    function updateActionVisibility() {
        const hasFile = Boolean(currentFile);
        editButton.classList.toggle('hidden', !hasFile || (isEditing && !isPreviewing));
        previewButton.classList.toggle('hidden', !isEditing || isPreviewing);
        saveButton.classList.toggle('hidden', !isEditing);
        cancelButton.classList.toggle('hidden', !isEditing);
        downloadButton.classList.toggle('hidden', isEditing);
        deleteButton.classList.toggle('hidden', isEditing);
    }

    function buildQuery(params) {
        const query = new URLSearchParams();
        if (originalPathArgument) {
            query.set('path', originalPathArgument);
        }
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.set(key, value);
            }
        });
        const queryString = query.toString();
        return queryString ? `?${queryString}` : '';
    }

    function updateLocation(file, { replace = false } = {}) {
        const newQuery = buildQuery({ file });
        const newUrl = `${window.location.pathname}${newQuery}`;
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        const stateData = { file };

        if (replace || newUrl === currentUrl) {
            window.history.replaceState(stateData, '', newUrl);
        } else {
            window.history.pushState(stateData, '', newUrl);
        }
    }

    function fileFromSearch(search) {
        const params = new URLSearchParams(search || '');
        const value = params.get('file');
        if (typeof value !== 'string') {
            return '';
        }
        const trimmed = value.trim();
        return trimmed === '' ? '' : trimmed;
    }

    function handleTocClick(event) {
        const link = event.target.closest('a.toc-link');
        if (!link) {
            return;
        }

        const hash = link.getAttribute('href');
        if (typeof hash !== 'string' || !hash.startsWith('#')) {
            return;
        }

        const targetId = hash.slice(1);
        if (!targetId) {
            return;
        }

        const targetElement = document.getElementById(targetId);
        if (!targetElement) {
            return;
        }

        event.preventDefault();

        try {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            targetElement.scrollIntoView();
        }

        if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
            const newUrl = `${window.location.pathname}${window.location.search}#${targetId}`;
            history.replaceState(history.state, '', newUrl);
        }
    }

    if (tocList) {
        tocList.addEventListener('click', handleTocClick);
    }

    // ------------------------------------------------------------------
    // Markdown editing helpers
    // ------------------------------------------------------------------
    function ensureEditorInstance() {
        if (editorInstance) {
            return editorInstance;
        }
        if (typeof window.CodeMirror === 'undefined') {
            return null;
        }

        editorContainer.innerHTML = '';
        suppressEditorChangeEvents = true;
        try {
            editorInstance = window.CodeMirror(editorContainer, {
                value: draftContent,
                mode: 'markdown',
                theme: 'one-dark',
                lineNumbers: true,
                lineWrapping: true,
                autofocus: true,
            });
            editorInstance.setSize('100%', '100%');
            editorInstance.on('change', handleEditorContentChange);
        } finally {
            suppressEditorChangeEvents = false;
        }
        setHasPendingChanges(draftContent !== currentContent);
        return editorInstance;
    }

    function handleEditorContentChange(instance) {
        if (!instance || suppressEditorChangeEvents) {
            return;
        }
        draftContent = instance.getValue();
        setHasPendingChanges(draftContent !== currentContent);
    }

    function enterEditMode() {
        if (!currentFile) {
            return;
        }
        if (typeof window.CodeMirror === 'undefined') {
            setStatus('Editor resources are still loading. Please try again in a moment.');
            return;
        }

        isEditing = true;
        isPreviewing = false;
        draftContent = currentContent;
        const editor = ensureEditorInstance();
        if (!editor) {
            isEditing = false;
            setStatus('Editor resources are still loading. Please try again in a moment.');
            updateActionVisibility();
            return;
        }

        suppressEditorChangeEvents = true;
        try {
            editor.setValue(draftContent);
        } finally {
            suppressEditorChangeEvents = false;
        }
        setHasPendingChanges(false);
        window.setTimeout(() => {
            editor.refresh();
            editor.focus();
        }, 0);

        content.classList.add('hidden');
        editorContainer.classList.add('visible');
        updateHeader();
        setStatus('Editing markdown…');
    }

    function enterPreviewMode() {
        if (!isEditing) {
            return;
        }
        const editor = ensureEditorInstance();
        if (editor) {
            draftContent = editor.getValue();
        }
        setHasPendingChanges(draftContent !== currentContent);
        isPreviewing = true;
        renderMarkdown(markdownContext, draftContent, { updateCurrent: false });
        editorContainer.classList.remove('visible');
        content.classList.remove('hidden');
        updateHeader();
        setStatus('Previewing changes.');
    }

    function returnToCodeMode() {
        if (!isPreviewing) {
            return;
        }
        isPreviewing = false;
        renderMarkdown(markdownContext, currentContent, { updateCurrent: true });
        content.classList.add('hidden');
        editorContainer.classList.add('visible');
        const editor = ensureEditorInstance();
        if (editor) {
            window.setTimeout(() => {
                editor.refresh();
                editor.focus();
            }, 0);
        }
        updateHeader();
        setStatus('Editing markdown…');
    }

    function exitEditMode(options = {}) {
        const { restoreContent = true } = options;
        if (!isEditing && !isPreviewing) {
            updateHeader();
            return;
        }
        isEditing = false;
        isPreviewing = false;
        draftContent = '';
        clearEditorHeadingHighlight();
        content.classList.remove('hidden');
        editorContainer.classList.remove('visible');
        if (restoreContent) {
            renderMarkdown(markdownContext, currentContent, { updateCurrent: true });
        }
        setHasPendingChanges(false);
        updateHeader();
    }


    function resetViewToFallback(options = {}) {
        const { skipHistory = false } = options;
        exitEditMode({ restoreContent: false });
        currentFile = null;
        const fallback = fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path');
        renderMarkdown(markdownContext, fallback, { updateCurrent: true });
        updateActiveFileHighlight();
        updateHeader();
        if (!skipHistory) {
            updateLocation('', { replace: true });
        }
    }
    function renderFileList() {
        fileList.innerHTML = '';

        const treeToRender = Array.isArray(fileTree) && fileTree.length
            ? fileTree
            : buildTreeFromFlatList(files);

        if (!treeToRender.length) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'No markdown files yet';
            fileList.appendChild(empty);
            return;
        }

        ensureExpandedForCurrentFile(currentFile);

        const visited = new Set();
        const fragment = document.createDocumentFragment();
        treeToRender.forEach((node) => {
            fragment.appendChild(renderTreeNode(node, 0, visited));
        });
        fileList.appendChild(fragment);

        const stale = [];
        expandedDirectories.forEach((value) => {
            if (!visited.has(value)) {
                stale.push(value);
            }
        });
        stale.forEach((value) => expandedDirectories.delete(value));

        knownDirectories.clear();
        visited.forEach((value) => knownDirectories.add(value));

        updateActiveFileHighlight();
    }

    function renderTreeNode(node, depth, visited) {
        const item = document.createElement('li');
        item.className = `tree-node ${node.type === 'directory' ? 'directory-node' : 'file-node'}`;

        if (node.type === 'directory') {
            const pathKey = typeof node.relativePath === 'string' ? node.relativePath : '';
            visited.add(pathKey);

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

            // Create folder icon element
            const folderIcon = document.createElement('i');
            folderIcon.className = isExpanded ? 'directory-icon fas fa-folder-open' : 'directory-icon fas fa-folder';

            // Create text element
            const labelText = document.createElement('span');
            labelText.textContent = node.name;

            // Append icon and text to label
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

        // Create icon element
        const icon = document.createElement('i');
        icon.className = 'file-icon fab fa-markdown'; // Font Awesome markdown icon

        // Create text element
        const text = document.createElement('span');
        text.textContent = node.name;

        // Append icon and text to button
        button.appendChild(icon);
        button.appendChild(text);

        button.dataset.file = node.relativePath;
        button.style.paddingLeft = `${depth * 16 + 24}px`;
        button.addEventListener('click', () => {
            if (node.relativePath !== currentFile) {
                selectFile(node.relativePath);
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
        parts.forEach((segment) => {
            if (!segment) {
                return;
            }
            prefix = prefix ? `${prefix}/${segment}` : segment;
            expandedDirectories.add(prefix);
        });
    }

    function toggleDirectory(pathKey) {
        if (!pathKey && pathKey !== '') {
            return;
        }
        if (expandedDirectories.has(pathKey)) {
            expandedDirectories.delete(pathKey);
        } else {
            expandedDirectories.add(pathKey);
        }
        renderFileList();
    }

    function updateActiveFileHighlight() {
        fileList.querySelectorAll('.file-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.file === currentFile);
        });
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `Request failed with status ${response.status}`);
        }
        return response.json();
    }

    async function refreshFiles() {
        const url = `/api/files${buildQuery({})}`;
        const data = await fetchJson(url);
        resolvedRootPath = data.rootPath || resolvedRootPath;
        const updatedIndex = normaliseFileIndex({ filesValue: data.files, treeValue: data.tree });
        files = updatedIndex.files;
        fileTree = updatedIndex.tree;
        renderFileList();
        if (!files.find((entry) => entry.relativePath === currentFile)) {
            currentFile = files.length ? files[0].relativePath : null;
            if (currentFile) {
                await loadFile(currentFile, { replaceHistory: true });
            } else {
                currentFile = null;
                exitEditMode({ restoreContent: false });
                renderMarkdown(
                    markdownContext,
                    fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path'),
                    { updateCurrent: true }
                );
                updateLocation('', { replace: true });
                updateHeader();
            }
        } else {
            updateActiveFileHighlight();
            updateHeader();
        }
    }

    function fallbackMarkdownFor(path) {
        return `# No markdown files found\n\nThe directory \`${path}\` does not contain any markdown files yet.`;
    }

    async function loadFile(file, options = {}) {
        const { skipHistory = false, replaceHistory = false } = options;
        if (isEditing || isPreviewing) {
            setStatus('Editing session closed because the file was reloaded.');
            exitEditMode();
        } else {
            setStatus('');
        }
        const url = `/api/file${buildQuery({ file })}`;
        try {
            const data = await fetchJson(url);
            resolvedRootPath = data.rootPath || resolvedRootPath;
            currentFile = data.file || file;
            renderMarkdown(markdownContext, data.content || '', { updateCurrent: true });
            setHasPendingChanges(false);
            updateActiveFileHighlight();
            updateHeader();
            updateLocation(currentFile, { replace: replaceHistory || skipHistory });
        } catch (err) {
            setStatus(err.message);
            console.error('Failed to load file', err);
        }
    }

    async function saveCurrentFile() {
        if (!isEditing || !currentFile) {
            return false;
        }

        const editor = ensureEditorInstance();
        if (editor && !isPreviewing) {
            draftContent = editor.getValue();
        }

        const contentToSave = draftContent;
        setStatus('Saving changes…');

        try {
            await fetchJson(`/api/file${buildQuery({ file: currentFile })}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: contentToSave }),
            });
            currentContent = contentToSave;
            exitEditMode();
            setStatus('Changes saved.');
            updateActiveFileHighlight();
            return true;
        } catch (err) {
            setStatus(err.message);
            console.error('Save failed', err);
            return false;
        }
    }

    async function selectFile(file) {
        if (hasPendingChanges) {
            const decision = await promptUnsavedChanges({ nextFile: file });
            if (decision === 'cancel') {
                return;
            }
            if (decision === 'save') {
                const saved = await saveCurrentFile();
                if (!saved) {
                    return;
                }
            } else if (decision === 'discard') {
                exitEditMode();
                setStatus('Changes discarded.');
            }
        } else if (isEditing || isPreviewing) {
            exitEditMode();
        }
        await loadFile(file);
    }

    function setupActions() {
        editButton.addEventListener('click', () => {
            if (isEditing && isPreviewing) {
                returnToCodeMode();
                return;
            }
            if (!isEditing) {
                enterEditMode();
            }
        });

        previewButton.addEventListener('click', () => {
            if (!currentFile) {
                return;
            }
            enterPreviewMode();
        });

        cancelButton.addEventListener('click', () => {
            if (!isEditing && !isPreviewing) {
                return;
            }
            exitEditMode();
            setStatus('Edits cancelled.');
        });

        saveButton.addEventListener('click', async () => {
            await saveCurrentFile();
        });

        downloadButton.addEventListener('click', async () => {
            if (!currentFile) {
                return;
            }
            try {
                const data = await fetchJson(`/api/file${buildQuery({ file: currentFile })}`);
                const blob = new Blob([data.content || ''], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = currentFile;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (err) {
                setStatus(err.message);
                console.error('Download failed', err);
            }
        });

        deleteButton.addEventListener('click', async () => {
            if (!currentFile) {
                return;
            }
            const confirmed = window.confirm(`Delete ${currentFile}?`);
            if (!confirmed) {
                return;
            }
            try {
                await fetchJson(`/api/file${buildQuery({ file: currentFile })}`, { method: 'DELETE' });
                setStatus('File deleted.');
                await refreshFiles();
            } catch (err) {
                setStatus(err.message);
                console.error('Delete failed', err);
            }
        });
    }

    function connectWebSocket() {
        if (websocket) {
            websocket.close();
        }

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        websocket = new WebSocket(`${protocol}://${window.location.host}/ws`);

        websocket.addEventListener('open', () => {
            setConnectionStatus(true);
            websocket.send(JSON.stringify({ type: 'subscribe', path: originalPathArgument }));
        });

        websocket.addEventListener('message', async (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'directory_update') {
                    resolvedRootPath = payload.path || resolvedRootPath;
                    const updatedIndex = normaliseFileIndex({
                        filesValue: payload.files,
                        treeValue: payload.tree,
                    });
                    files = updatedIndex.files;
                    fileTree = updatedIndex.tree;
                    renderFileList();
                    if (!files.find((entry) => entry.relativePath === currentFile)) {
                        currentFile = files.length ? files[0].relativePath : null;
                        if (currentFile) {
                            await loadFile(currentFile, { replaceHistory: true });
                        } else {
                            currentFile = null;
                            exitEditMode({ restoreContent: false });
                            renderMarkdown(
                                markdownContext,
                                fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path'),
                                { updateCurrent: true }
                            );
                            updateLocation('', { replace: true });
                            updateHeader();
                        }
                    } else {
                        updateActiveFileHighlight();
                        updateHeader();
                    }
                } else if (payload.type === 'file_changed') {
                    if (payload.file && payload.file === currentFile) {
                        await loadFile(currentFile, { replaceHistory: true });
                    }
                }
            } catch (err) {
                console.error('Failed to process websocket event', err);
            }
        });

        function scheduleReconnect() {
            if (reconnectTimer) {
                return;
            }
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connectWebSocket();
            }, 1500);
        }

        websocket.addEventListener('close', () => {
            setConnectionStatus(false);
            scheduleReconnect();
        });

        websocket.addEventListener('error', () => {
            websocket.close();
        });
    }

    function scheduleTerminalLibraryRetry() {
        if (terminalLibraryRetryTimer) {
            return;
        }
        terminalLibraryRetryTimer = window.setTimeout(() => {
            terminalLibraryRetryTimer = null;
            if (!terminalInstance) {
                ensureTerminalInstance();
            }
            if (!terminalSocket) {
                connectTerminal();
            }
        }, 250);
    }

    function areTerminalLibrariesReady() {
        return (
            typeof window !== 'undefined' &&
            typeof window.Terminal === 'function' &&
            window.FitAddon &&
            typeof window.FitAddon.FitAddon === 'function'
        );
    }

    function ensureTerminalInstance() {
        if (terminalInstance || !terminalContainer) {
            return terminalInstance;
        }

        if (!areTerminalLibrariesReady()) {
            scheduleTerminalLibraryRetry();
            return null;
        }

        try {
            terminalInstance = new window.Terminal({
                convertEol: true,
                cursorBlink: true,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontSize: 13,
                theme: {
                    // Palette derived from the provided macOS Terminal profile to keep the
                    // in-browser terminal consistent with the requested look-and-feel.
                    background: '#21252b',
                    foreground: '#abb2bf',
                    cursor: '#abb2bf',
                    cursorAccent: '#21252b',
                    selection: '#323844',
                    selectionForeground: '#abb2bf',
                    black: '#21252b',
                    red: '#e06c75',
                    green: '#98c379',
                    yellow: '#e5c07b',
                    blue: '#61afef',
                    magenta: '#c678dd',
                    cyan: '#56b6c2',
                    white: '#abb2bf',
                    brightBlack: '#767676',
                    brightRed: '#e06c75',
                    brightGreen: '#98c379',
                    brightYellow: '#e5c07b',
                    brightBlue: '#61afef',
                    brightMagenta: '#c678dd',
                    brightCyan: '#56b6c2',
                    brightWhite: '#abb2bf',
                },
            });
        } catch (error) {
            console.warn('Failed to initialise terminal instance', error);
            terminalInstance = null;
            return null;
        }

        try {
            terminalFitAddon = new window.FitAddon.FitAddon();
            terminalInstance.loadAddon(terminalFitAddon);
        } catch (error) {
            console.warn('Failed to load terminal fit addon', error);
            terminalInstance.dispose();
            terminalInstance = null;
            return null;
        }

        terminalInstance.open(terminalContainer);
        terminalInstance.focus();

        terminalInstance.onData((data) => {
            if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
                terminalSocket.send(JSON.stringify({ type: 'input', data }));
            }
        });

        terminalInstance.onResize((size) => {
            if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
                terminalSocket.send(
                    JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows })
                );
            }
        });

        scheduleTerminalFit();
        return terminalInstance;
    }

    function scheduleTerminalFit() {
        if (!terminalInstance || !terminalFitAddon || terminalCollapsed) {
            return;
        }

        if (pendingTerminalFitFrame) {
            window.cancelAnimationFrame(pendingTerminalFitFrame);
        }

        pendingTerminalFitFrame = window.requestAnimationFrame(() => {
            pendingTerminalFitFrame = null;
            fitTerminal();
        });
    }

    function fitTerminal() {
        if (!terminalInstance || !terminalFitAddon || terminalCollapsed) {
            return;
        }

        try {
            terminalFitAddon.fit();
        } catch (error) {
            console.warn('Unable to fit terminal to container', error);
            return;
        }

        sendTerminalResize();
    }

    function sendTerminalResize() {
        if (!terminalInstance || !terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) {
            return;
        }
        terminalSocket.send(
            JSON.stringify({ type: 'resize', cols: terminalInstance.cols, rows: terminalInstance.rows })
        );
    }

    function updateTerminalStatus(message) {
        if (terminalStatusText) {
            terminalStatusText.textContent = message || '';
        }
        terminalLastStatusMessage = message || '';
    }

    function scheduleTerminalReconnect(delay = 1500) {
        if (terminalReconnectTimer) {
            return;
        }
        terminalReconnectTimer = window.setTimeout(() => {
            terminalReconnectTimer = null;
            connectTerminal();
        }, delay);
    }

    function connectTerminal() {
        if (!terminalContainer) {
            return;
        }

        if (terminalSocket &&
            (terminalSocket.readyState === WebSocket.OPEN || terminalSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const terminal = ensureTerminalInstance();
        if (!terminal) {
            scheduleTerminalLibraryRetry();
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`);
        socket.binaryType = 'arraybuffer';
        terminalSocket = socket;
        updateTerminalStatus('Connecting…');

        socket.addEventListener('open', () => {
            if (terminalReconnectTimer) {
                window.clearTimeout(terminalReconnectTimer);
                terminalReconnectTimer = null;
            }
            updateTerminalStatus('Connected');
            scheduleTerminalFit();
        });

        socket.addEventListener('message', (event) => {
            if (!terminalInstance) {
                return;
            }

            if (typeof event.data === 'string') {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === 'state' && typeof payload.message === 'string') {
                        updateTerminalStatus(payload.message);
                        return;
                    }
                    if (payload.type === 'exit') {
                        if (typeof payload.code === 'number') {
                            updateTerminalStatus(`Process exited (${payload.code})`);
                        } else {
                            updateTerminalStatus('Process exited');
                        }
                        scheduleTerminalReconnect();
                        return;
                    }
                } catch (error) {
                    // Treat as raw output when parsing fails.
                    terminalInstance.write(event.data);
                    return;
                }

                terminalInstance.write(event.data);
                return;
            }

            const consumeBuffer = (buffer) => {
                if (!buffer) {
                    return;
                }
                const text = terminalDecoder.decode(buffer);
                if (text) {
                    terminalInstance.write(text);
                }
            };

            if (event.data instanceof ArrayBuffer) {
                consumeBuffer(new Uint8Array(event.data));
                return;
            }

            if (event.data && typeof event.data.arrayBuffer === 'function') {
                event.data
                    .arrayBuffer()
                    .then((buffer) => consumeBuffer(new Uint8Array(buffer)))
                    .catch((error) => console.warn('Failed to decode terminal payload', error));
            }
        });

        socket.addEventListener('close', () => {
            terminalSocket = null;
            if (!terminalLastStatusMessage.startsWith('Process exited')) {
                updateTerminalStatus('Disconnected – reconnecting…');
            }
            scheduleTerminalReconnect();
        });

        socket.addEventListener('error', () => {
            updateTerminalStatus('Connection error');
            socket.close();
        });
    }

    function setupTerminalPanel() {
        if (!terminalPanel) {
            return;
        }

        if (!dockviewIsActive && terminalResizeObserver) {
            terminalResizeObserver.disconnect();
            terminalResizeObserver = null;
        }

        if (dockviewIsActive) {
            terminalCollapsed = false;
            terminalPanel.style.height = '';
            terminalPanel.style.maxHeight = '';
            terminalPanel.classList.remove('is-collapsed');
            if (terminalResizeHandle) {
                terminalResizeHandle.remove();
            }
            if (terminalToggleButton) {
                terminalToggleButton.disabled = true;
                terminalToggleButton.textContent = 'Terminal (layout-managed)';
                terminalToggleButton.setAttribute('aria-expanded', 'true');
            }

            if (!terminalResizeObserver && typeof window.ResizeObserver === 'function') {
                const resizeTarget = terminalPanel.parentElement || terminalPanel;
                if (resizeTarget) {
                    terminalResizeObserver = new window.ResizeObserver(() => {
                        scheduleTerminalFit();
                    });
                    terminalResizeObserver.observe(resizeTarget);
                }
            }

            const instance = ensureTerminalInstance();
            if (instance) {
                scheduleTerminalFit();
            }
            connectTerminal();
            return;
        }

        const minHeight = 140;

        const clampHeight = (value) => {
            const max = Math.max(minHeight, Math.round(window.innerHeight * 0.75));
            if (Number.isFinite(value)) {
                return Math.min(Math.max(value, minHeight), max);
            }
            return minHeight;
        };

        const persistHeight = () => {
            if (typeof window.localStorage === 'undefined') {
                return;
            }
            try {
                window.localStorage.setItem(terminalStorageKey, String(terminalHeight));
            } catch (error) {
                // Ignore persistence errors (e.g. storage disabled).
            }
        };

        const applyHeight = (value, { persist = false } = {}) => {
            const clamped = clampHeight(value);
            terminalHeight = clamped;
            terminalPanel.style.height = `${clamped}px`;
            if (persist) {
                persistHeight();
            }
            scheduleTerminalFit();
            return clamped;
        };

        const restoreHeightFromStorage = () => {
            if (typeof window.localStorage === 'undefined') {
                terminalHeight = clampHeight(terminalPanel.getBoundingClientRect().height || 260);
                return;
            }
            let stored = null;
            try {
                stored = window.localStorage.getItem(terminalStorageKey);
            } catch (error) {
                stored = null;
            }
            const numeric = stored === null ? NaN : Number(stored);
            if (Number.isFinite(numeric)) {
                applyHeight(numeric);
            } else {
                terminalHeight = clampHeight(terminalPanel.getBoundingClientRect().height || 260);
            }
        };

        const setCollapsed = (value) => {
            const collapsed = Boolean(value);
            if (terminalCollapsed === collapsed) {
                return;
            }
            terminalCollapsed = collapsed;
            terminalPanel.classList.toggle('is-collapsed', collapsed);
            if (terminalToggleButton) {
                terminalToggleButton.setAttribute('aria-expanded', String(!collapsed));
                terminalToggleButton.textContent = collapsed ? 'Show terminal' : 'Hide terminal';
            }

            if (collapsed) {
                terminalPanel.style.height = '';
                return;
            }

            applyHeight(terminalHeight || clampHeight(terminalPanel.getBoundingClientRect().height || 260));

            if (terminalPanel) {
                const handleTransitionEnd = (event) => {
                    if (event.target !== terminalPanel || event.propertyName !== 'height') {
                        return;
                    }
                    terminalPanel.removeEventListener('transitionend', handleTransitionEnd);
                    scheduleTerminalFit();
                };
                terminalPanel.addEventListener('transitionend', handleTransitionEnd, { once: true });
            }

            const instance = ensureTerminalInstance();
            if (instance) {
                instance.focus();
                if (typeof instance.scrollToBottom === 'function') {
                    instance.scrollToBottom();
                }
            }

            connectTerminal();
        };

        restoreHeightFromStorage();

        if (terminalToggleButton) {
            terminalToggleButton.addEventListener('click', () => {
                setCollapsed(!terminalCollapsed);
            });
        }

        if (terminalResizeHandle) {
            terminalResizeHandle.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = terminalPanel.getBoundingClientRect().height;

                const handleMove = (moveEvent) => {
                    const delta = startY - moveEvent.clientY;
                    const next = clampHeight(startHeight + delta);
                    applyHeight(next);
                };

                const handleUp = () => {
                    document.removeEventListener('pointermove', handleMove);
                    document.removeEventListener('pointerup', handleUp);
                    persistHeight();
                    scheduleTerminalFit();
                };

                document.addEventListener('pointermove', handleMove);
                document.addEventListener('pointerup', handleUp);
            });

            terminalResizeHandle.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                    return;
                }
                event.preventDefault();
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                const offset = event.key === 'ArrowUp' ? 32 : -32;
                const next = clampHeight((terminalHeight || terminalPanel.getBoundingClientRect().height) + offset);
                applyHeight(next, { persist: true });
            });

            terminalResizeHandle.addEventListener('dblclick', () => {
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                applyHeight(clampHeight(260), { persist: true });
            });
        }

        window.addEventListener('resize', () => {
            if (terminalCollapsed) {
                return;
            }
            const current = terminalHeight || terminalPanel.getBoundingClientRect().height;
            const clamped = clampHeight(current);
            if (clamped !== current) {
                applyHeight(clamped, { persist: true });
            } else {
                scheduleTerminalFit();
            }
        });

        setCollapsed(false);
        ensureTerminalInstance();
        connectTerminal();
    }

    window.addEventListener('beforeunload', () => {
        if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
            try {
                terminalSocket.close();
            } catch (error) {
                // Swallow shutdown errors.
            }
        }
    });

    function initialise() {
        const initialFallback = fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path');
        renderMarkdown(markdownContext, state.content || initialFallback, { updateCurrent: true });
        renderFileList();
        updateHeader();
        if (state.error) {
            setStatus(state.error);
        }
        setupActions();
        setupTerminalPanel();
        connectWebSocket();
        if (!currentFile && files.length) {
            currentFile = files[0].relativePath;
        }

        if (!initialFileFromLocation && currentFile) {
            loadFile(currentFile, { replaceHistory: true });
        }
    }

    window.addEventListener('popstate', () => {
        const targetFile = fileFromSearch(window.location.search);
        if (targetFile) {
            if (targetFile !== currentFile) {
                loadFile(targetFile, { skipHistory: true, replaceHistory: true });
            }
        } else {
            resetViewToFallback({ skipHistory: true });
        }
    });

    initialise();

    if (initialFileFromLocation) {
        loadFile(initialFileFromLocation, { replaceHistory: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
