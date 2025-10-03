export function setupCore(ctx) {
    const {
        dom: {
            statusMessage,
            offlineOverlay,
            body,
            fileName,
            sidebarPath,
            downloadButton,
            deleteButton,
            editButton,
            previewButton,
            saveButton,
            cancelButton,
            unsavedChangesModal,
            unsavedChangesFilename,
            unsavedChangesMessage,
            unsavedChangesDetail,
            unsavedChangesSaveButton,
            unsavedChangesDiscardButton,
            unsavedChangesCancelButton,
        },
    } = ctx;

    ctx.setStatus = function setStatus(message) {
        if (statusMessage) {
            statusMessage.textContent = message || '';
        }
    };

    ctx.setConnectionStatus = function setConnectionStatus(connected) {
        if (offlineOverlay) {
            offlineOverlay.classList.toggle('visible', !connected);
        }
    };

    ctx.buildQuery = function buildQuery(params) {
        const query = new URLSearchParams();
        if (ctx.originalPathArgument) {
            query.set('path', ctx.originalPathArgument);
        }
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.set(key, value);
            }
        });
        const queryString = query.toString();
        return queryString ? `?${queryString}` : '';
    };

    ctx.updateLocation = function updateLocation(file, { replace = false } = {}) {
        const newQuery = ctx.buildQuery({ file });
        const newUrl = `${window.location.pathname}${newQuery}`;
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        const stateData = { file };

        if (replace || newUrl === currentUrl) {
            window.history.replaceState(stateData, '', newUrl);
        } else {
            window.history.pushState(stateData, '', newUrl);
        }
    };

    ctx.fileFromSearch = function fileFromSearch(search) {
        const params = new URLSearchParams(search || '');
        const value = params.get('file');
        if (typeof value !== 'string') {
            return '';
        }
        const trimmed = value.trim();
        return trimmed === '' ? '' : trimmed;
    };

    ctx.initialFileFromLocation = ctx.fileFromSearch(window.location.search);

    ctx.setHasPendingChanges = function setHasPendingChanges(value) {
        const nextValue = Boolean(value);
        if (nextValue === ctx.hasPendingChanges) {
            return;
        }
        ctx.hasPendingChanges = nextValue;
        if (body) {
            body.classList.toggle('document-has-pending-changes', ctx.hasPendingChanges);
        }
        ctx.updateHeader();
    };

    ctx.updateDocumentPanelTitle = function updateDocumentPanelTitle() {
        const viewerPanel = ctx.dockviewSetup?.panels?.viewer;
        if (!viewerPanel) {
            return;
        }

        const baseTitle = ctx.currentFile || 'Document';
        const title = ctx.hasPendingChanges && ctx.currentFile ? `${baseTitle} ●` : baseTitle;
        const panelApi = viewerPanel?.api;

        if (panelApi && typeof panelApi.setTitle === 'function') {
            panelApi.setTitle(title);
        } else if (typeof viewerPanel.setTitle === 'function') {
            viewerPanel.setTitle(title);
        }
    };

    ctx.updateActionVisibility = function updateActionVisibility() {
        const hasFile = Boolean(ctx.currentFile);
        if (editButton) {
            editButton.classList.toggle('hidden', !hasFile || (ctx.isEditing && !ctx.isPreviewing));
        }
        if (previewButton) {
            previewButton.classList.toggle('hidden', !ctx.isEditing || ctx.isPreviewing);
        }
        if (saveButton) {
            saveButton.classList.toggle('hidden', !ctx.isEditing);
        }
        if (cancelButton) {
            cancelButton.classList.toggle('hidden', !ctx.isEditing);
        }
        if (downloadButton) {
            downloadButton.classList.toggle('hidden', ctx.isEditing);
            downloadButton.disabled = !hasFile;
        }
        if (deleteButton) {
            deleteButton.classList.toggle('hidden', ctx.isEditing);
            deleteButton.disabled = !hasFile;
        }
        if (editButton) {
            editButton.disabled = !hasFile && !ctx.isEditing;
        }
        if (previewButton) {
            previewButton.disabled = !hasFile;
        }
        if (saveButton) {
            saveButton.disabled = !hasFile;
        }
        if (cancelButton) {
            cancelButton.disabled = false;
        }
    };

    ctx.updateHeader = function updateHeader() {
        const hasFile = Boolean(ctx.currentFile);
        const indicator = ctx.hasPendingChanges && hasFile ? ' ●' : '';

        if (fileName) {
            if (ctx.dockviewIsActive) {
                if (hasFile) {
                    fileName.textContent = `Markdown Viewer${indicator}`;
                    fileName.classList.add('hidden');
                } else {
                    fileName.textContent = 'No file selected';
                    fileName.classList.remove('hidden');
                }
            } else {
                fileName.classList.remove('hidden');
                const baseName = hasFile ? ctx.currentFile : 'No file selected';
                fileName.textContent = hasFile ? `${baseName}${indicator}` : baseName;
            }
        }

        if (sidebarPath) {
            sidebarPath.textContent = ctx.resolvedRootPath || ctx.originalPathArgument || 'Unknown';
        }

        ctx.updateActionVisibility();
        ctx.updateDocumentPanelTitle();
    };

    ctx.promptUnsavedChanges = function promptUnsavedChanges(context = {}) {
        if (!unsavedChangesModal) {
            return Promise.resolve('cancel');
        }

        if (ctx.activeUnsavedPrompt) {
            return ctx.activeUnsavedPrompt;
        }

        const nextFile = typeof context.nextFile === 'string' ? context.nextFile : '';
        const displayName = ctx.currentFile || 'this document';
        if (unsavedChangesFilename) {
            unsavedChangesFilename.textContent = displayName;
        }
        if (unsavedChangesMessage) {
            unsavedChangesMessage.setAttribute('data-current-file', displayName);
        }
        if (unsavedChangesDetail) {
            if (nextFile && nextFile !== ctx.currentFile) {
                unsavedChangesDetail.textContent = `Switch to “${nextFile}” without saving?`;
            } else {
                unsavedChangesDetail.textContent = 'What would you like to do?';
            }
        }

        unsavedChangesModal.classList.add('visible');
        if (body) {
            body.classList.add('modal-open');
        }

        const promise = new Promise((resolve) => {
            const cleanup = () => {
                unsavedChangesModal.classList.remove('visible');
                if (body) {
                    body.classList.remove('modal-open');
                }
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
                ctx.activeUnsavedPrompt = null;
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
                } else if (typeof unsavedChangesModal.focus === 'function') {
                    unsavedChangesModal.focus({ preventScroll: true });
                }
            }, 0);
        });

        ctx.activeUnsavedPrompt = promise;
        return promise;
    };
}
