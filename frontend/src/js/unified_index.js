import './vendor_globals.js';
import { initLayout } from './viewer/layout.js';
import { initEditor } from './editor/editor.js';
import { initNavigation } from './files/navigation.js';
import { createHandleDirectoryUpdate, createHandleFileChanged } from './files/realtime_handlers.js';
import { createAppContext } from './app/context.js';
import { createRealtimeService } from './services/realtime.js';
import { createTerminalService } from './services/terminal.js';
import {
    createViewerApi,
    normaliseFileIndex,
    buildTreeFromFlatList,
    getCssNumber,
    setStatus,
    createSetConnectionStatus,
    createResetViewToFallback,
    fallbackMarkdownFor,
} from './app/bootstrap_helpers.js';
import { createHeaderController } from './app/header_controller.js';
import { createRouter } from './app/router.js';
import { createTocController } from './app/toc_controller.js';

// Client-side bootstrap logic for the unified markdown viewer UI.
function bootstrap() {
    const context = createAppContext();
    const { initialState, state: appState, elements, sets, terminalStorageKey } = context;
    const {
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
        offlineOverlay,
        unsavedChangesModal,
        unsavedChangesFilename,
        unsavedChangesMessage,
        unsavedChangesDetail,
        unsavedChangesSaveButton,
        unsavedChangesDiscardButton,
        unsavedChangesCancelButton,
        tocList,
        tocSidebar,
        fileSidebar,
        tocSplitter,
        fileSplitter,
        dockviewRoot,
        appShell,
        rootElement,
        viewerSection,
        terminalPanel,
        terminalContainer,
        terminalToggleButton,
        terminalStatusText,
        terminalResizeHandle,
        panelToggleButtons,
    } = elements;
    const { expandedDirectories, knownDirectories } = sets;

    const initialIndex = normaliseFileIndex({
        filesValue: initialState.files,
        treeValue: initialState.fileTree,
    });
    appState.files = initialIndex.files;
    appState.fileTree = initialIndex.tree;

    appState.currentFile = initialState.selectedFile || null;
    context.initialFileFromLocation = null;

    const setConnectionStatusHandler = createSetConnectionStatus(offlineOverlay);
    let resetViewToFallback = () => {};
    let headerController = null;
    let router = null;
    let navigationApi = null;
    let editorApi = null;
    let tocController = null;

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
        getCurrentFile: () => appState.currentFile,
        setCurrentFile(value, options = {}) {
            const { silent = false } = options || {};
            const nextValue = typeof value === 'string' && value.length ? value : value || null;
            if (appState.currentFile === nextValue) {
                return;
            }
            appState.currentFile = nextValue;
            if (!silent) {
                this.updateActiveFileHighlight();
                this.updateHeader();
                this.updateDocumentPanelTitle();
            }
        },
        getCurrentContent: () => appState.currentContent,
        setCurrentContent(value) {
            appState.currentContent = typeof value === 'string' ? value : '';
        },
        hasPendingChanges: () => appState.hasPendingChanges,
        setHasPendingChanges(value) {
            if (headerController) {
                headerController.applyHasPendingChanges(value);
            } else {
                const nextValue = Boolean(value);
                if (nextValue !== appState.hasPendingChanges) {
                    appState.hasPendingChanges = nextValue;
                    document?.body?.classList?.toggle('document-has-pending-changes', nextValue);
                }
            }
        },
        isEditing: () => appState.isEditing,
        setEditing(value) {
            const next = Boolean(value);
            if (appState.isEditing === next) {
                return;
            }
            appState.isEditing = next;
            this.updateActionVisibility();
        },
        isPreviewing: () => appState.isPreviewing,
        setPreviewing(value) {
            const next = Boolean(value);
            if (appState.isPreviewing === next) {
                return;
            }
            appState.isPreviewing = next;
            this.updateActionVisibility();
        },
        getResolvedRootPath: () => appState.resolvedRootPath,
        setResolvedRootPath(value) {
            appState.resolvedRootPath = typeof value === 'string' ? value : appState.resolvedRootPath;
        },
        getOriginalPathArgument: () => appState.originalPathArgument,
        getFiles: () => appState.files,
        setFiles: (value) => {
            appState.files = Array.isArray(value) ? value : [];
        },
        getFileTree: () => appState.fileTree,
        setFileTree: (value) => {
            appState.fileTree = Array.isArray(value) ? value : [];
        },
        getExpandedDirectories: () => expandedDirectories,
        getKnownDirectories: () => knownDirectories,
        setStatus,
        setConnectionStatus: (connected) => setConnectionStatusHandler(connected),
        updateHeader() {
            headerController?.updateHeader();
        },
        updateActionVisibility() {
            headerController?.updateActionVisibility();
        },
        updateActiveFileHighlight() {},
        updateDocumentPanelTitle() {
            headerController?.updateDocumentPanelTitle();
        },
        buildQuery(params) {
            return router ? router.buildQuery(params) : '';
        },
        updateLocation(file, options = {}) {
            if (!router) {
                return;
            }
            const { replace = false } = options;
            if (replace) {
                router.replace(file);
            } else {
                router.push(file);
            }
        },
        fallbackMarkdownFor,
        normaliseFileIndex: (values) => normaliseFileIndex(values),
        buildTreeFromFlatList: (list) => buildTreeFromFlatList(list),
        getCssNumber: (variableName, fallback) => getCssNumber(rootElement, variableName, fallback),
    };
    const markdownContext = {
        content,
        tocList,
        getCurrentFile: () => sharedContext.getCurrentFile(),
        setCurrentContent(value) {
            sharedContext.setCurrentContent(value);
        },
        buildQuery: (params) => sharedContext.buildQuery(params),
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
    const dockviewIsActive = layout.dockviewIsActive;
    document.body.classList.toggle('dockview-active', dockviewIsActive);
    layout.refreshPanelToggleStates();

    headerController = createHeaderController({
        elements: {
            fileName,
            sidebarPath,
            downloadButton,
            deleteButton,
            editButton,
            previewButton,
            saveButton,
            cancelButton,
        },
        layout,
        appState,
    });

    tocController = createTocController({ tocList });
    tocController.attach();

    if (dockviewIsActive && dockviewRoot) {
        dockviewRoot.addEventListener('pointerdown', layout.handlePointerDown);
        window.addEventListener('pointerup', layout.handlePointerFinish);
        window.addEventListener('pointercancel', layout.handlePointerFinish);
    }

    sharedContext.layout = layout;

    router = createRouter({
        appState,
        getCurrentFile: () => sharedContext.getCurrentFile(),
        onNavigate: (targetFile, options) => {
            if (typeof navigationApi?.loadFile === 'function') {
                void navigationApi.loadFile(targetFile, options);
            }
        },
        onFallback: (options) => {
            resetViewToFallback(options);
        },
    });

    context.initialFileFromLocation = router.getCurrent();

    const terminalService = createTerminalService({
        terminalPanel,
        terminalContainer,
        terminalToggleButton,
        terminalStatusText,
        terminalResizeHandle,
        storageKey: terminalStorageKey,
        isDockviewActive: () => layout.dockviewIsActive,
    });

    const viewerApi = createViewerApi(markdownContext);

    navigationApi = initNavigation(sharedContext, viewerApi);
    editorApi = initEditor(sharedContext, viewerApi, navigationApi);
    if (typeof navigationApi?.bindEditorApi === 'function') {
        navigationApi.bindEditorApi(editorApi);
    }
    if (typeof navigationApi?.updateActiveFileHighlight === 'function') {
        sharedContext.updateActiveFileHighlight = () => navigationApi.updateActiveFileHighlight();
    }

    resetViewToFallback = createResetViewToFallback({ sharedContext, viewerApi, editorApi });

    if (content && typeof editorApi?.handleHeadingActionClick === 'function') {
        content.addEventListener('click', (event) => {
            editorApi.handleHeadingActionClick(event);
        });
    }

    const handleDirectoryUpdate = createHandleDirectoryUpdate({
        navigationApi,
        sharedContext,
        resetViewToFallback,
    });
    const handleFileChanged = createHandleFileChanged({
        navigationApi,
        sharedContext,
    });

    const realtimeService = createRealtimeService({
        getSubscriptionPath: () => appState.originalPathArgument,
        onConnectionChange: (connected) => {
            setConnectionStatusHandler(connected);
        },
        onDirectoryUpdate: handleDirectoryUpdate,
        onFileChanged: handleFileChanged,
    });

    function initialise() {
        const initialFallback = fallbackMarkdownFor(
            appState.resolvedRootPath || appState.originalPathArgument || 'the selected path'
        );
        viewerApi.render(initialState.content || initialFallback, { updateCurrent: true });
        navigationApi.renderFileList();
        sharedContext.updateHeader();
        if (initialState.error) {
            setStatus(initialState.error);
        }
        terminalService.setupTerminalPanel();
        realtimeService.connect();
        const filesList = sharedContext.getFiles();
        if (!sharedContext.getCurrentFile() && filesList.length) {
            sharedContext.setCurrentFile(filesList[0].relativePath);
        }

        const currentPath = sharedContext.getCurrentFile();
        if (!context.initialFileFromLocation && currentPath) {
            void navigationApi.loadFile(currentPath, { replaceHistory: true });
        }
    }

    initialise();

    if (context.initialFileFromLocation) {
        void navigationApi.loadFile(context.initialFileFromLocation, { replaceHistory: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
