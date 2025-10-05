import './vendor_globals.js';
import { initLayout } from './viewer/layout.js';
import { initEditor } from './editor/editor.js';
import { initNavigation } from './files/navigation.js';
import { createHandleDirectoryUpdate, createHandleFileChanged } from './files/realtime_handlers.js';
import { createAppContext } from './app/context.js';
import { createSharedContext } from './app/shared_context.js';
import { createUnifiedApp } from './app/unified_app.js';
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
function composeUnifiedApp() {
    const context = createAppContext();
    const { initialState, state: appState, elements, sets } = context;
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
    const initialIndex = normaliseFileIndex({
        filesValue: initialState.files,
        treeValue: initialState.fileTree,
    });
    appState.files = initialIndex.files;
    appState.fileTree = initialIndex.tree;

    appState.currentFile = initialState.selectedFile || null;
    context.initialFileFromLocation = null;

    const setConnectionStatusHandler = createSetConnectionStatus(offlineOverlay);

    const sharedContext = createSharedContext({
        appState,
        controllers: {
            header: null,
        },
        router: null,
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
        sets,
        applyHasPendingChanges(value) {
            if (headerController) {
                headerController.applyHasPendingChanges(value);
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
            const header = this.controllers?.header;
            if (header) {
                header.applyHasPendingChanges(value);
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
            const nextValue = Boolean(value);
            if (nextValue !== appState.hasPendingChanges) {
                appState.hasPendingChanges = nextValue;
                document?.body?.classList?.toggle('document-has-pending-changes', nextValue);
            }
        },
        setConnectionStatusHandler: (connected) => {
            setConnectionStatusHandler(connected);
        },
        updateHeader() {
            const header = this.controllers?.header;
            header?.updateHeader();
        },
        updateActionVisibility() {
            const header = this.controllers?.header;
            header?.updateActionVisibility();
        },
        updateDocumentPanelTitle() {
            const header = this.controllers?.header;
            header?.updateDocumentPanelTitle();
        },
        buildQuery(params) {
            return this.router ? this.router.buildQuery(params) : '';
        },
        updateLocation(file, options = {}) {
            if (!this.router) {
                return;
            }
            const { replace = false } = options;
            if (replace) {
                this.router.replace(file);
            } else {
                this.router.push(file);
            }
        },
        fallbackMarkdownFor,
        normaliseFileIndex(values) {
            return normaliseFileIndex(values);
        },
        buildTreeFromFlatList(list) {
            return buildTreeFromFlatList(list);
        },
        getCssNumber(variableName, fallback) {
            return getCssNumber(rootElement, variableName, fallback);
        },
        rootElement,
    });
    sharedContext.setStatus = setStatus;
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

    const unifiedApp = createUnifiedApp({
        context,
        sharedContext,
        layout: {
            initLayout,
        },
        controllers: {
            createHeaderController,
            createTocController,
            createRouter,
        },
        services: {
            createTerminalService,
            createRealtimeService,
            createViewerApi,
            initNavigation,
            initEditor,
            createHandleDirectoryUpdate,
            createHandleFileChanged,
            createResetViewToFallback,
            setConnectionStatusHandler,
        },
    });

    return unifiedApp;
}

function startUnifiedApp() {
    const app = composeUnifiedApp();
    app.start();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUnifiedApp, { once: true });
} else {
    startUnifiedApp();
}
