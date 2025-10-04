import './vendor_globals.js';
import { initLayout } from './viewer/layout.js';
import { renderMarkdown, captureHeadingLocations, getHeadingLocation } from './viewer/markdown.js';
import { initEditor } from './editor/editor.js';
import { initNavigation } from './files/navigation.js';

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
    let currentContent = typeof state.content === 'string' ? state.content : '';
    let hasPendingChanges = false;

    const originalPathArgument = state.pathArgument || '';
    let resolvedRootPath = state.rootPath || '';
    const initialFileFromLocation = fileFromSearch(window.location.search);
    const expandedDirectories = new Set();
    const knownDirectories = new Set();

    const sharedContext = {
        elements: {
            content,
            fileName,
            sidebarPath,
            fileList,
            downloadButton,
            deleteButton,
            editButton,
            previewButton,
            saveButton,
            cancelButton,
            editorContainer,
            unsavedChangesModal,
            unsavedChangesFilename,
            unsavedChangesMessage,
            unsavedChangesDetail,
            unsavedChangesSaveButton,
            unsavedChangesDiscardButton,
            unsavedChangesCancelButton,
        },
        getCurrentFile: () => currentFile,
        setCurrentFile(value, options = {}) {
            const { silent = false } = options || {};
            const nextValue = typeof value === 'string' && value.length ? value : value || null;
            if (currentFile === nextValue) {
                return;
            }
            currentFile = nextValue;
            if (!silent) {
                this.updateActiveFileHighlight();
                this.updateHeader();
                this.updateDocumentPanelTitle();
            }
        },
        getCurrentContent: () => currentContent,
        setCurrentContent(value) {
            currentContent = typeof value === 'string' ? value : '';
        },
        hasPendingChanges: () => hasPendingChanges,
        setHasPendingChanges: (value) => applyHasPendingChanges(value),
        isEditing: () => isEditing,
        setEditing(value) {
            const next = Boolean(value);
            if (isEditing === next) {
                return;
            }
            isEditing = next;
            this.updateActionVisibility();
        },
        isPreviewing: () => isPreviewing,
        setPreviewing(value) {
            const next = Boolean(value);
            if (isPreviewing === next) {
                return;
            }
            isPreviewing = next;
            this.updateActionVisibility();
        },
        getResolvedRootPath: () => resolvedRootPath,
        setResolvedRootPath(value) {
            resolvedRootPath = typeof value === 'string' ? value : resolvedRootPath;
        },
        getOriginalPathArgument: () => originalPathArgument,
        getFiles: () => files,
        setFiles: (value) => {
            files = Array.isArray(value) ? value : [];
        },
        getFileTree: () => fileTree,
        setFileTree: (value) => {
            fileTree = Array.isArray(value) ? value : [];
        },
        getExpandedDirectories: () => expandedDirectories,
        getKnownDirectories: () => knownDirectories,
        setStatus,
        setConnectionStatus,
        updateHeader() {
            updateHeader();
        },
        updateActionVisibility() {
            updateActionVisibility();
        },
        updateActiveFileHighlight() {},
        updateDocumentPanelTitle() {
            updateDocumentPanelTitle();
        },
        buildQuery: (params) => buildQuery(params),
        updateLocation: (file, options) => updateLocation(file, options),
        fallbackMarkdownFor,
        normaliseFileIndex: (values) => normaliseFileIndex(values),
        buildTreeFromFlatList: (list) => buildTreeFromFlatList(list),
    };
    const markdownContext = {
        content,
        tocList,
        getCurrentFile: () => sharedContext.getCurrentFile(),
        setCurrentContent(value) {
            sharedContext.setCurrentContent(value);
        },
        buildQuery,
    };
    sharedContext.markdownContext = markdownContext;

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
        getCurrentFile: () => sharedContext.getCurrentFile(),
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

    sharedContext.layout = layout;

    const viewerApi = {
        render(contentValue, options = {}) {
            renderMarkdown(markdownContext, contentValue, options);
        },
        captureHeadings(source) {
            return captureHeadingLocations(markdownContext, source);
        },
        getHeadingLocation(slug) {
            return getHeadingLocation(markdownContext, slug);
        },
        getMarkdownContext() {
            return markdownContext;
        },
    };

    const navigationApi = initNavigation(sharedContext, viewerApi);
    const editorApi = initEditor(sharedContext, viewerApi, navigationApi);
    if (typeof navigationApi?.bindEditorApi === 'function') {
        navigationApi.bindEditorApi(editorApi);
    }
    if (typeof navigationApi?.updateActiveFileHighlight === 'function') {
        sharedContext.updateActiveFileHighlight = () => navigationApi.updateActiveFileHighlight();
    }

    if (content && typeof editorApi?.handleHeadingActionClick === 'function') {
        content.addEventListener('click', (event) => {
            editorApi.handleHeadingActionClick(event);
        });
    }

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

    function setStatus(message) {
        // Status banner removed; keep function to avoid touching callers.
        void message;
    }

    function setConnectionStatus(connected) {
        offlineOverlay.classList.toggle('visible', !connected);
    }

    function applyHasPendingChanges(value) {
        const nextValue = Boolean(value);
        if (nextValue === hasPendingChanges) {
            return;
        }
        hasPendingChanges = nextValue;
        document.body.classList.toggle('document-has-pending-changes', hasPendingChanges);
        updateHeader();
    }

    function resetViewToFallback(options = {}) {
        const { skipHistory = false } = options || {};
        if (typeof editorApi?.exitEditMode === 'function') {
            editorApi.exitEditMode({ restoreContent: false });
        }
        sharedContext.setCurrentFile(null, { silent: true });
        const fallback = sharedContext.fallbackMarkdownFor(
            sharedContext.getResolvedRootPath() || sharedContext.getOriginalPathArgument() || 'the selected path'
        );
        viewerApi.render(fallback, { updateCurrent: true });
        sharedContext.updateActiveFileHighlight();
        sharedContext.updateHeader();
        if (!skipHistory) {
            sharedContext.updateLocation('', { replace: true });
        }
    }

    function fallbackMarkdownFor(path) {
        return `# No markdown files found\n\nThe directory \`${path}\` does not contain any markdown files yet.`;
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
                    sharedContext.setResolvedRootPath(resolvedRootPath);
                    const updatedIndex = sharedContext.normaliseFileIndex({
                        filesValue: payload.files,
                        treeValue: payload.tree,
                    });
                    sharedContext.setFiles(updatedIndex.files);
                    sharedContext.setFileTree(updatedIndex.tree);
                    navigationApi.renderFileList();
                    const filesList = sharedContext.getFiles();
                    const currentPath = sharedContext.getCurrentFile();
                    if (!filesList.find((entry) => entry.relativePath === currentPath)) {
                        const nextFile = filesList.length ? filesList[0].relativePath : null;
                        if (nextFile) {
                            await navigationApi.loadFile(nextFile, { replaceHistory: true });
                        } else {
                            resetViewToFallback();
                        }
                    } else {
                        sharedContext.updateActiveFileHighlight();
                        sharedContext.updateHeader();
                    }
                } else if (payload.type === 'file_changed') {
                    const currentPath = sharedContext.getCurrentFile();
                    if (payload.file && payload.file === currentPath) {
                        await navigationApi.loadFile(currentPath, { replaceHistory: true });
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
        viewerApi.render(state.content || initialFallback, { updateCurrent: true });
        navigationApi.renderFileList();
        updateHeader();
        if (state.error) {
            setStatus(state.error);
        }
        setupTerminalPanel();
        connectWebSocket();
        const filesList = sharedContext.getFiles();
        if (!sharedContext.getCurrentFile() && filesList.length) {
            sharedContext.setCurrentFile(filesList[0].relativePath);
        }

        const currentPath = sharedContext.getCurrentFile();
        if (!initialFileFromLocation && currentPath) {
            void navigationApi.loadFile(currentPath, { replaceHistory: true });
        }
    }

    window.addEventListener('popstate', () => {
        const targetFile = fileFromSearch(window.location.search);
        const currentPath = sharedContext.getCurrentFile();
        if (targetFile) {
            if (targetFile !== currentPath) {
                void navigationApi.loadFile(targetFile, { skipHistory: true, replaceHistory: true });
            }
        } else {
            resetViewToFallback({ skipHistory: true });
        }
    });

    initialise();

    if (initialFileFromLocation) {
        void navigationApi.loadFile(initialFileFromLocation, { replaceHistory: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
