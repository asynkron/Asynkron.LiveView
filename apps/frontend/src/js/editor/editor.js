export function initEditor(context, viewerApi, navigationApi) {
    if (!context) {
        throw new Error('Editor context is required');
    }

    const {
        elements: {
            content,
            editorContainer,
            editButton,
            previewButton,
            saveButton,
            cancelButton,
        } = {},
        setStatus = () => {},
        updateHeader = () => {},
        updateActionVisibility = () => {},
        setHasPendingChanges = () => {},
        getCurrentFile = () => null,
        getCurrentContent = () => '',
        setCurrentContent = () => {},
        isEditing = () => false,
        setEditing = () => {},
        isPreviewing = () => false,
        setPreviewing = () => {},
    } = context;

    const fetchJson = navigationApi?.fetchJson || defaultFetchJson;

    const editorState = {
        instance: null,
        draftContent: '',
        suppressChangeEvents: false,
        headingHighlightLine: null,
        headingHighlightTimeout: null,
    };

    function ensureEditorInstance() {
        if (editorState.instance) {
            return editorState.instance;
        }

        if (!editorContainer || typeof window?.CodeMirror === 'undefined') {
            return null;
        }

        editorContainer.innerHTML = '';
        editorState.suppressChangeEvents = true;
        try {
            editorState.instance = window.CodeMirror(editorContainer, {
                value: editorState.draftContent,
                mode: 'markdown',
                theme: 'one-dark',
                lineNumbers: true,
                lineWrapping: true,
                autofocus: true,
            });
            editorState.instance.setSize('100%', '100%');
            editorState.instance.on('change', handleEditorContentChange);
        } finally {
            editorState.suppressChangeEvents = false;
        }

        setHasPendingChanges(editorState.draftContent !== getCurrentContent());
        return editorState.instance;
    }

    function handleEditorContentChange(instance) {
        if (!instance || editorState.suppressChangeEvents) {
            return;
        }
        editorState.draftContent = instance.getValue();
        setHasPendingChanges(editorState.draftContent !== getCurrentContent());
    }

    function enterEditMode() {
        if (!getCurrentFile()) {
            return;
        }

        if (typeof window?.CodeMirror === 'undefined') {
            setStatus('Editor resources are still loading. Please try again in a moment.');
            return;
        }

        setEditing(true);
        setPreviewing(false);
        editorState.draftContent = getCurrentContent();
        const editor = ensureEditorInstance();
        if (!editor) {
            setEditing(false);
            setStatus('Editor resources are still loading. Please try again in a moment.');
            updateActionVisibility();
            return;
        }

        editorState.suppressChangeEvents = true;
        try {
            editor.setValue(editorState.draftContent);
        } finally {
            editorState.suppressChangeEvents = false;
        }
        setHasPendingChanges(false);
        window.setTimeout(() => {
            editor.refresh();
            editor.focus();
        }, 0);

        content?.classList.add('hidden');
        editorContainer?.classList.add('visible');
        updateHeader();
        setStatus('Editing markdown…');
    }

    function enterPreviewMode() {
        if (!isEditing()) {
            return;
        }
        const editor = ensureEditorInstance();
        if (editor) {
            editorState.draftContent = editor.getValue();
        }
        setHasPendingChanges(editorState.draftContent !== getCurrentContent());
        setPreviewing(true);
        viewerApi?.render(editorState.draftContent, { updateCurrent: false });
        editorContainer?.classList.remove('visible');
        content?.classList.remove('hidden');
        updateHeader();
        setStatus('Previewing changes.');
    }

    function returnToCodeMode() {
        if (!isPreviewing()) {
            return;
        }
        setPreviewing(false);
        viewerApi?.render(getCurrentContent(), { updateCurrent: true });
        content?.classList.add('hidden');
        editorContainer?.classList.add('visible');
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

    function clearEditorHeadingHighlight() {
        if (!editorState.instance || editorState.headingHighlightLine === null) {
            editorState.headingHighlightLine = null;
            return;
        }
        try {
            editorState.instance.removeLineClass(
                editorState.headingHighlightLine,
                'background',
                'heading-target-line',
            );
        } catch (error) {
            console.warn('Failed to remove heading highlight', error);
        }
        editorState.headingHighlightLine = null;
    }

    function highlightEditorLine(lineNumber) {
        const editor = ensureEditorInstance();
        if (!editor || typeof editor.addLineClass !== 'function') {
            return;
        }

        if (editorState.headingHighlightTimeout) {
            window.clearTimeout(editorState.headingHighlightTimeout);
            editorState.headingHighlightTimeout = null;
        }

        if (editorState.headingHighlightLine !== null) {
            try {
                editor.removeLineClass(editorState.headingHighlightLine, 'background', 'heading-target-line');
            } catch (error) {
                console.warn('Failed to clear previous heading highlight', error);
            }
        }

        try {
            editor.addLineClass(lineNumber, 'background', 'heading-target-line');
            editorState.headingHighlightLine = lineNumber;
        } catch (error) {
            console.warn('Failed to apply heading highlight', error);
            editorState.headingHighlightLine = null;
            return;
        }

        editorState.headingHighlightTimeout = window.setTimeout(() => {
            const instance = ensureEditorInstance();
            if (instance && editorState.headingHighlightLine !== null) {
                try {
                    instance.removeLineClass(
                        editorState.headingHighlightLine,
                        'background',
                        'heading-target-line',
                    );
                } catch (error) {
                    console.warn('Failed to remove heading highlight after delay', error);
                }
            }
            editorState.headingHighlightLine = null;
            editorState.headingHighlightTimeout = null;
        }, 2000);
    }

    function exitEditMode(options = {}) {
        const { restoreContent = true } = options || {};
        if (!isEditing() && !isPreviewing()) {
            updateHeader();
            return;
        }
        setEditing(false);
        setPreviewing(false);
        editorState.draftContent = '';
        clearEditorHeadingHighlight();
        content?.classList.remove('hidden');
        editorContainer?.classList.remove('visible');
        if (restoreContent) {
            viewerApi?.render(getCurrentContent(), { updateCurrent: true });
        }
        setHasPendingChanges(false);
        updateHeader();
    }

    function enterPreviewOrReturn() {
        if (isEditing() && isPreviewing()) {
            returnToCodeMode();
            return;
        }
        if (!isEditing()) {
            enterEditMode();
        }
    }

    function handleCancel() {
        if (!isEditing() && !isPreviewing()) {
            return;
        }
        exitEditMode();
        setStatus('Edits cancelled.');
    }

    async function saveCurrentFile() {
        if (!isEditing() || !getCurrentFile()) {
            return false;
        }

        const editor = ensureEditorInstance();
        if (editor && !isPreviewing()) {
            editorState.draftContent = editor.getValue();
        }

        const contentToSave = editorState.draftContent;
        setStatus('Saving changes…');

        try {
            await fetchJson(`/api/file${context.buildQuery({ file: getCurrentFile() })}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: contentToSave }),
            });
            context.setCurrentContent(contentToSave);
            exitEditMode();
            setStatus('Changes saved.');
            context.updateActiveFileHighlight();
            return true;
        } catch (error) {
            setStatus(error?.message || 'Save failed.');
            console.error('Save failed', error);
            return false;
        }
    }

    function attachButtonHandlers() {
        editButton?.addEventListener('click', enterPreviewOrReturn);
        previewButton?.addEventListener('click', enterPreviewMode);
        cancelButton?.addEventListener('click', handleCancel);
        saveButton?.addEventListener('click', () => {
            void saveCurrentFile();
        });
    }

    function handleHeadingActionClick(event) {
        const button = event.target.closest('.heading-action-button');
        if (!button || !content?.contains(button)) {
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

        if (!getCurrentFile()) {
            setStatus('Open a markdown file to edit sections.');
            return;
        }

        const focusEditorOnHeading = () => {
            const editor = ensureEditorInstance();
            if (!editor) {
                setStatus('Editor resources are still loading. Please try again in a moment.');
                return;
            }

            let location = viewerApi?.getHeadingLocation(slug);
            if (!location) {
                const source = typeof editor.getValue === 'function' ? editor.getValue() : getCurrentContent();
                viewerApi?.captureHeadings(source);
                location = viewerApi?.getHeadingLocation(slug);
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

        if (!isEditing()) {
            enterEditMode();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        if (isPreviewing()) {
            returnToCodeMode();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        focusEditorOnHeading();
    }

    function copyHeadingLink(slug) {
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
            navigator.clipboard
                .writeText(link)
                .then(notifySuccess)
                .catch((error) => {
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
            onSuccess?.();
            return;
        }

        onFailure?.(lastError);
    }

    attachButtonHandlers();

    return {
        ensureEditorInstance,
        enterEditMode,
        enterPreviewMode,
        returnToCodeMode,
        exitEditMode,
        saveCurrentFile,
        handleHeadingActionClick,
        highlightEditorLine,
        clearEditorHeadingHighlight,
        getDraftContent: () => editorState.draftContent,
        setDraftContent(value) {
            editorState.draftContent = typeof value === 'string' ? value : '';
        },
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
