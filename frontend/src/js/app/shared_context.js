// Factory for the shared application context used across the unified viewer modules.
export function createSharedContext({
    appState,
    elements,
    sets,
    applyHasPendingChanges,
    setConnectionStatusHandler,
    updateHeader,
    updateActionVisibility,
    updateDocumentPanelTitle,
    buildQuery,
    updateLocation,
    fallbackMarkdownFor,
    normaliseFileIndex,
    buildTreeFromFlatList,
    getCssNumber,
    rootElement,
}) {
    const safeUpdateHeader = typeof updateHeader === 'function' ? updateHeader : () => {};
    const safeUpdateActionVisibility =
        typeof updateActionVisibility === 'function' ? updateActionVisibility : () => {};
    const safeUpdateDocumentPanelTitle =
        typeof updateDocumentPanelTitle === 'function' ? updateDocumentPanelTitle : () => {};
    const safeApplyHasPendingChanges =
        typeof applyHasPendingChanges === 'function'
            ? applyHasPendingChanges
            : (value) => {
                  const nextValue = Boolean(value);
                  if (nextValue !== appState.hasPendingChanges) {
                      appState.hasPendingChanges = nextValue;
                      globalThis?.document?.body?.classList?.toggle(
                          'document-has-pending-changes',
                          nextValue
                      );
                  }
              };
    const safeSetConnectionStatusHandler =
        typeof setConnectionStatusHandler === 'function' ? setConnectionStatusHandler : () => {};
    const safeBuildQuery = typeof buildQuery === 'function' ? buildQuery : () => '';
    const safeUpdateLocation =
        typeof updateLocation === 'function' ? updateLocation : () => {};
    const safeFallbackMarkdownFor =
        typeof fallbackMarkdownFor === 'function' ? fallbackMarkdownFor : () => '';
    const safeNormaliseFileIndex =
        typeof normaliseFileIndex === 'function' ? normaliseFileIndex : (values) => values;
    const safeBuildTreeFromFlatList =
        typeof buildTreeFromFlatList === 'function' ? buildTreeFromFlatList : (list) => list;
    const safeGetCssNumber =
        typeof getCssNumber === 'function' ? getCssNumber : (_, __, fallback) => fallback;
    const sharedSets = sets || {};
    const expandedDirectories = sharedSets.expandedDirectories;
    const knownDirectories = sharedSets.knownDirectories;

    const sharedContext = {
        elements: elements || {},
        getCurrentFile() {
            return appState.currentFile;
        },
        setCurrentFile(value, options = {}) {
            const { silent = false } = options || {};
            const nextValue = typeof value === 'string' && value.length ? value : value || null;
            if (appState.currentFile === nextValue) {
                return;
            }
            appState.currentFile = nextValue;
            if (!silent) {
                sharedContext.updateActiveFileHighlight();
                sharedContext.updateHeader();
                sharedContext.updateDocumentPanelTitle();
            }
        },
        getCurrentContent() {
            return appState.currentContent;
        },
        setCurrentContent(value) {
            appState.currentContent = typeof value === 'string' ? value : '';
        },
        hasPendingChanges() {
            return appState.hasPendingChanges;
        },
        setHasPendingChanges(value) {
            safeApplyHasPendingChanges(value);
        },
        isEditing() {
            return appState.isEditing;
        },
        setEditing(value) {
            const next = Boolean(value);
            if (appState.isEditing === next) {
                return;
            }
            appState.isEditing = next;
            sharedContext.updateActionVisibility();
        },
        isPreviewing() {
            return appState.isPreviewing;
        },
        setPreviewing(value) {
            const next = Boolean(value);
            if (appState.isPreviewing === next) {
                return;
            }
            appState.isPreviewing = next;
            sharedContext.updateActionVisibility();
        },
        getResolvedRootPath() {
            return appState.resolvedRootPath;
        },
        setResolvedRootPath(value) {
            if (typeof value === 'string') {
                appState.resolvedRootPath = value;
            }
        },
        getOriginalPathArgument() {
            return appState.originalPathArgument;
        },
        getFiles() {
            return appState.files;
        },
        setFiles(value) {
            appState.files = Array.isArray(value) ? value : [];
        },
        getFileTree() {
            return appState.fileTree;
        },
        setFileTree(value) {
            appState.fileTree = Array.isArray(value) ? value : [];
        },
        getExpandedDirectories() {
            return expandedDirectories;
        },
        getKnownDirectories() {
            return knownDirectories;
        },
        setStatus: undefined,
        setConnectionStatus(connected) {
            safeSetConnectionStatusHandler(connected);
        },
        updateHeader() {
            safeUpdateHeader();
        },
        updateActionVisibility() {
            safeUpdateActionVisibility();
        },
        updateActiveFileHighlight() {},
        updateDocumentPanelTitle() {
            safeUpdateDocumentPanelTitle();
        },
        buildQuery(params) {
            return safeBuildQuery(params);
        },
        updateLocation(file, options = {}) {
            safeUpdateLocation(file, options);
        },
        fallbackMarkdownFor(path) {
            return safeFallbackMarkdownFor(path);
        },
        normaliseFileIndex(values) {
            return safeNormaliseFileIndex(values);
        },
        buildTreeFromFlatList(list) {
            return safeBuildTreeFromFlatList(list);
        },
        getCssNumber(variableName, fallback) {
            return safeGetCssNumber(rootElement, variableName, fallback);
        },
    };

    return sharedContext;
}
