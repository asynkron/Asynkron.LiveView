// Factory for the realtime directory update callback so that we can pass in the
// navigation API and shared context explicitly.
export function createHandleDirectoryUpdate({ navigationApi, sharedContext, resetViewToFallback }) {
    return async function handleDirectoryUpdate(payload = {}) {
        if (!payload || typeof payload !== 'object') {
            return;
        }

        const nextResolvedPath =
            typeof payload.path === 'string' && payload.path.length
                ? payload.path
                : sharedContext.getResolvedRootPath();
        sharedContext.setResolvedRootPath(nextResolvedPath);

        const updatedIndex = sharedContext.normaliseFileIndex({
            filesValue: payload.files,
            treeValue: payload.tree,
        });
        sharedContext.setFiles(updatedIndex.files);
        sharedContext.setFileTree(updatedIndex.tree);

        if (typeof navigationApi?.renderFileList === 'function') {
            navigationApi.renderFileList();
        }

        const filesList = sharedContext.getFiles();
        const currentPath = sharedContext.getCurrentFile();
        const currentExists = filesList.some((entry) => entry?.relativePath === currentPath);

        if (!currentExists) {
            const nextFile = filesList.length ? filesList[0].relativePath : null;
            if (nextFile && typeof navigationApi?.loadFile === 'function') {
                await navigationApi.loadFile(nextFile, { replaceHistory: true });
            } else if (typeof resetViewToFallback === 'function') {
                resetViewToFallback();
            }
            return;
        }

        sharedContext.updateActiveFileHighlight();
        sharedContext.updateHeader();
    };
}

// Factory for the realtime file changed callback, keeping navigation/context
// dependencies injectable.
export function createHandleFileChanged({ navigationApi, sharedContext }) {
    return async function handleFileChanged(file) {
        const currentPath = sharedContext.getCurrentFile();
        if (file && file === currentPath && typeof navigationApi?.loadFile === 'function') {
            await navigationApi.loadFile(currentPath, { replaceHistory: true });
        }
    };
}
