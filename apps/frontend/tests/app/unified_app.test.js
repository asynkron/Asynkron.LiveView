import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createUnifiedApp } from '../../src/js/app/unified_app.js';

function createTrackedTarget(element) {
    const listeners = new Map();
    return Object.assign(element, {
        _listeners: listeners,
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type, handler) {
            if (listeners.get(type) === handler) {
                listeners.delete(type);
            }
        },
    });
}

let dom;
let originalWindow;
let originalDocument;

beforeEach(() => {
    dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: 'https://example.com/viewer' });
    originalWindow = global.window;
    originalDocument = global.document;
    global.window = dom.window;
    global.document = dom.window.document;
    dom.window.requestAnimationFrame = (cb) => {
        if (typeof cb === 'function') {
            cb();
        }
        return 1;
    };
    dom.window.cancelAnimationFrame = () => {};
});

afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    dom.window.close();
});

function createContext() {
    const documentRef = dom.window.document;

    const elements = {
        content: createTrackedTarget(documentRef.createElement('div')),
        fileName: documentRef.createElement('div'),
        sidebarPath: documentRef.createElement('div'),
        fileList: documentRef.createElement('div'),
        downloadButton: documentRef.createElement('button'),
        deleteButton: documentRef.createElement('button'),
        editButton: documentRef.createElement('button'),
        previewButton: documentRef.createElement('button'),
        saveButton: documentRef.createElement('button'),
        cancelButton: documentRef.createElement('button'),
        editorContainer: documentRef.createElement('div'),
        offlineOverlay: documentRef.createElement('div'),
        unsavedChangesModal: documentRef.createElement('div'),
        unsavedChangesFilename: documentRef.createElement('div'),
        unsavedChangesMessage: documentRef.createElement('div'),
        unsavedChangesDetail: documentRef.createElement('div'),
        unsavedChangesSaveButton: documentRef.createElement('button'),
        unsavedChangesDiscardButton: documentRef.createElement('button'),
        unsavedChangesCancelButton: documentRef.createElement('button'),
        tocList: documentRef.createElement('ul'),
        tocSidebar: documentRef.createElement('div'),
        fileSidebar: documentRef.createElement('div'),
        tocSplitter: documentRef.createElement('div'),
        fileSplitter: documentRef.createElement('div'),
        dockviewRoot: createTrackedTarget(documentRef.createElement('div')),
        appShell: documentRef.createElement('div'),
        rootElement: documentRef.documentElement,
        viewerSection: documentRef.createElement('section'),
        terminalPanel: documentRef.createElement('div'),
        terminalContainer: documentRef.createElement('div'),
        terminalToggleButton: documentRef.createElement('button'),
        terminalStatusText: documentRef.createElement('div'),
        terminalResizeHandle: documentRef.createElement('div'),
        panelToggleButtons: [],
    };

    const initialState = {
        content: '# Hello world',
        files: [],
        fileTree: [],
        selectedFile: null,
        error: null,
        rootPath: '',
        pathArgument: '',
    };

    const state = {
        currentFile: null,
        files: [],
        fileTree: [],
        websocket: null,
        reconnectTimer: null,
        isEditing: false,
        isPreviewing: false,
        currentContent: '',
        hasPendingChanges: false,
        resolvedRootPath: '',
        originalPathArgument: '',
    };

    return {
        context: {
            initialState,
            elements,
            state,
            sets: {
                expandedDirectories: new Set(),
                knownDirectories: new Set(),
            },
            terminalStorageKey: 'terminal-test',
            initialFileFromLocation: null,
        },
        elements,
        state,
    };
}

test('start wires listeners and destroy unwires them', () => {
    const { context, elements, state } = createContext();
    const files = [{ relativePath: 'README.md' }];
    state.files = files;

    const sharedContext = {
        controllers: { header: null },
        router: null,
        elements: context.elements,
        getCurrentFile: () => state.currentFile,
        setCurrentFile(value) {
            state.currentFile = value;
        },
        getCurrentContent: () => state.currentContent,
        setCurrentContent(value) {
            state.currentContent = value;
        },
        hasPendingChanges: () => state.hasPendingChanges,
        setHasPendingChanges() {},
        isEditing: () => state.isEditing,
        setEditing() {},
        isPreviewing: () => state.isPreviewing,
        setPreviewing() {},
        getResolvedRootPath: () => state.resolvedRootPath,
        setResolvedRootPath(value) {
            state.resolvedRootPath = value;
        },
        getOriginalPathArgument: () => state.originalPathArgument,
        getFiles: () => state.files,
        setFiles(value) {
            state.files = Array.isArray(value) ? value : [];
        },
        getFileTree: () => state.fileTree,
        setFileTree(value) {
            state.fileTree = Array.isArray(value) ? value : [];
        },
        getExpandedDirectories: () => context.sets.expandedDirectories,
        getKnownDirectories: () => context.sets.knownDirectories,
        setStatus() {},
        setConnectionStatus() {},
        updateHeader() {},
        updateActionVisibility() {},
        updateActiveFileHighlight() {},
        updateDocumentPanelTitle() {},
        buildQuery: () => '',
        updateLocation() {},
        fallbackMarkdownFor: () => '# fallback',
        normaliseFileIndex: (values) => values,
        buildTreeFromFlatList: (list) => list,
        getCssNumber: () => 0,
        markdownContext: {},
    };

    const layoutCalls = { refresh: 0 };
    const pointerEvents = new Map();
    const windowRef = dom.window;
    const originalWindowAdd = windowRef.addEventListener.bind(windowRef);
    const originalWindowRemove = windowRef.removeEventListener.bind(windowRef);
    windowRef.addEventListener = (type, handler) => {
        pointerEvents.set(type, handler);
        originalWindowAdd(type, handler);
    };
    windowRef.removeEventListener = (type, handler) => {
        if (pointerEvents.get(type) === handler) {
            pointerEvents.delete(type);
        }
        originalWindowRemove(type, handler);
    };

    const dockviewRoot = elements.dockviewRoot;

    const layout = {
        initLayout: () => ({
            dockviewIsActive: true,
            refreshPanelToggleStates() {
                layoutCalls.refresh += 1;
            },
            handlePointerDown() {},
            handlePointerFinish() {},
        }),
    };

    let routerDisposed = false;
    const controllers = {
        createHeaderController: () => ({
            updateHeader() {},
            updateActionVisibility() {},
            updateDocumentPanelTitle() {},
            applyHasPendingChanges() {},
        }),
        createTocController: () => ({
            attach: () => () => {},
        }),
        createRouter: () => ({
            buildQuery: () => '?file=README.md',
            push() {},
            replace() {},
            getCurrent: () => 'README.md',
            dispose() {
                routerDisposed = true;
            },
        }),
    };

    let terminalSetup = 0;
    const realtimeEvents = [];
    let disconnectCalled = 0;
    const services = {
        createTerminalService: () => ({
            setupTerminalPanel() {
                terminalSetup += 1;
            },
        }),
        createRealtimeService: (options) => {
            realtimeEvents.push(options);
            return {
                connect() {
                    realtimeEvents.push('connect');
                },
                disconnect() {
                    disconnectCalled += 1;
                },
            };
        },
        createViewerApi: () => ({
            render() {},
        }),
        initNavigation: () => ({
            renderFileList() {},
            loadFile() {},
            bindEditorApi() {},
            updateActiveFileHighlight() {},
        }),
        initEditor: () => ({
            handleHeadingActionClick() {},
        }),
        createHandleDirectoryUpdate: () => () => {},
        createHandleFileChanged: () => () => {},
        createResetViewToFallback: () => () => {},
        setConnectionStatusHandler: () => {},
    };

    const app = createUnifiedApp({
        context,
        sharedContext,
        layout,
        controllers,
        services,
    });

    app.start();

    assert.equal(dom.window.document.body.classList.contains('dockview-active'), true);
    assert.equal(layoutCalls.refresh, 1);
    assert.equal(dockviewRoot._listeners.has('pointerdown'), true);
    assert.equal(pointerEvents.has('pointerup'), true);
    assert.equal(terminalSetup, 1);
    assert.equal(realtimeEvents.includes('connect'), true);
    assert.equal(elements.content._listeners.has('click'), true);
    assert.equal(state.currentFile, 'README.md');
    assert.equal(typeof sharedContext.router?.getCurrent, 'function');
    assert.equal(sharedContext.controllers.header !== null, true);

    app.destroy();

    assert.equal(dockviewRoot._listeners.size, 0);
    assert.equal(pointerEvents.size, 0);
    assert.equal(disconnectCalled, 1);
    assert.equal(routerDisposed, true);
    assert.equal(sharedContext.router, null);
    assert.equal(sharedContext.controllers.header, null);
    assert.equal(elements.content._listeners.size, 0);
    assert.equal(dom.window.document.body.classList.contains('dockview-active'), false);
});
