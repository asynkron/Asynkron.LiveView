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
        sectionEdit: null,
    };

    function isSectionEditing() {
        return Boolean(editorState.sectionEdit);
    }

    function clearSectionEditState() {
        editorState.sectionEdit = null;
    }

    function getSectionDisplayTitle(sectionState = editorState.sectionEdit) {
        if (!sectionState) {
            return '';
        }
        return sectionState.title || sectionState.slug || '';
    }

    function getSectionDisplayLabel(sectionState = editorState.sectionEdit) {
        const title = getSectionDisplayTitle(sectionState);
        return title || 'Untitled section';
    }

    // Normalise section editing metadata when a heading edit is requested.
    function setSectionEditState(section) {
        if (!section) {
            clearSectionEditState();
            return null;
        }

        const beforeContent = typeof section.before === 'string' ? section.before : '';
        const afterContent = typeof section.after === 'string' ? section.after : '';

        editorState.sectionEdit = {
            slug: typeof section.slug === 'string' ? section.slug : null,
            title: typeof section.title === 'string' ? section.title : '',
            level: Number.isInteger(section.level) ? section.level : null,
            startOffset: Number.isInteger(section.startOffset) ? section.startOffset : null,
            endOffset: Number.isInteger(section.endOffset) ? section.endOffset : null,
            beforeContent,
            afterContent,
        };

        return editorState.sectionEdit;
    }

    // Rebuild the original markdown using the active section draft.
    function getFullDraftContent() {
        if (!isSectionEditing()) {
            return editorState.draftContent;
        }

        const before = editorState.sectionEdit?.beforeContent ?? '';
        const after = editorState.sectionEdit?.afterContent ?? '';
        return `${before}${editorState.draftContent}${after}`;
    }

    function getEditingStatusMessage() {
        if (!isSectionEditing()) {
            return 'Editing markdown…';
        }
        return `Editing section “${getSectionDisplayLabel()}”…`;
    }

    function getPreviewStatusMessage() {
        return isSectionEditing() ? 'Previewing section changes.' : 'Previewing changes.';
    }

    function getCancelStatusMessage() {
        return isSectionEditing() ? 'Section edits cancelled.' : 'Edits cancelled.';
    }

    function getSaveSuccessMessage() {
        return isSectionEditing() ? 'Section changes saved.' : 'Changes saved.';
    }

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

        setHasPendingChanges(getFullDraftContent() !== getCurrentContent());
        return editorState.instance;
    }

    function handleEditorContentChange(instance) {
        if (!instance || editorState.suppressChangeEvents) {
            return;
        }
        editorState.draftContent = instance.getValue();
        setHasPendingChanges(getFullDraftContent() !== getCurrentContent());
    }

    function enterEditMode(options = {}) {
        if (!getCurrentFile()) {
            return;
        }

        if (typeof window?.CodeMirror === 'undefined') {
            setStatus('Editor resources are still loading. Please try again in a moment.');
            return;
        }

        const sectionDetails = options?.section;
        let activeSection = null;
        if (sectionDetails && typeof sectionDetails.content === 'string') {
            activeSection = setSectionEditState(sectionDetails);
            editorState.draftContent = sectionDetails.content;
        } else {
            clearSectionEditState();
            editorState.draftContent = getCurrentContent();
        }

        setEditing(true);
        setPreviewing(false);
        const editor = ensureEditorInstance();
        if (!editor) {
            setEditing(false);
            clearSectionEditState();
            setStatus('Editor resources are still loading. Please try again in a moment.');
            updateActionVisibility();
            return;
        }

        editorState.suppressChangeEvents = true;
        try {
            editor.setValue(editorState.draftContent);
            if (activeSection) {
                editor.setCursor({ line: 0, ch: 0 });
            }
        } finally {
            editorState.suppressChangeEvents = false;
        }
        setHasPendingChanges(getFullDraftContent() !== getCurrentContent());
        window.setTimeout(() => {
            editor.refresh();
            editor.focus();
        }, 0);

        if (activeSection) {
            highlightEditorLine(0);
        } else {
            clearEditorHeadingHighlight();
        }

        content?.classList.add('hidden');
        editorContainer?.classList.add('visible');
        updateHeader();
        setStatus(getEditingStatusMessage());
    }

    function enterPreviewMode() {
        if (!isEditing()) {
            return;
        }
        const editor = ensureEditorInstance();
        if (editor) {
            editorState.draftContent = editor.getValue();
        }
        const fullDraft = getFullDraftContent();
        setHasPendingChanges(fullDraft !== getCurrentContent());
        setPreviewing(true);
        viewerApi?.render(fullDraft, { updateCurrent: false });
        editorContainer?.classList.remove('visible');
        content?.classList.remove('hidden');
        updateHeader();
        setStatus(getPreviewStatusMessage());
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
        setStatus(getEditingStatusMessage());
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
        clearSectionEditState();
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
        setStatus(getCancelStatusMessage());
    }

    async function saveCurrentFile() {
        if (!isEditing() || !getCurrentFile()) {
            return false;
        }

        const editor = ensureEditorInstance();
        if (editor && !isPreviewing()) {
            editorState.draftContent = editor.getValue();
        }

        const contentToSave = getFullDraftContent();
        setStatus('Saving changes…');

        try {
            await fetchJson(`/api/file${context.buildQuery({ file: getCurrentFile() })}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: contentToSave }),
            });
            context.setCurrentContent(contentToSave);
            exitEditMode();
            setStatus(getSaveSuccessMessage());
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

        const baseContent = isEditing() ? getFullDraftContent() : getCurrentContent();
        const sourceText = typeof baseContent === 'string' ? baseContent : '';

        let sectionDetails = viewerApi?.getHeadingSection(slug);
        if (!sectionDetails && sourceText) {
            viewerApi?.captureHeadings(sourceText);
            sectionDetails = viewerApi?.getHeadingSection(slug);
        }

        if (sectionDetails && typeof sectionDetails.startOffset === 'number' && typeof sectionDetails.endOffset === 'number') {
            const safeStart = Math.max(0, Math.min(sourceText.length, sectionDetails.startOffset));
            const safeEnd = Math.max(safeStart, Math.min(sourceText.length, sectionDetails.endOffset));
            const beforeContent = sourceText.slice(0, safeStart);
            const afterContent = sourceText.slice(safeEnd);
            const sectionContent = sourceText.slice(safeStart, safeEnd);

            const openSectionEditor = () => {
                enterEditMode({
                    section: {
                        slug,
                        title: sectionDetails.text,
                        level: sectionDetails.level,
                        startOffset: safeStart,
                        endOffset: safeEnd,
                        before: beforeContent,
                        after: afterContent,
                        content: sectionContent,
                    },
                });
                window.setTimeout(() => {
                    const editor = ensureEditorInstance();
                    if (!editor) {
                        return;
                    }
                    editor.focus();
                    editor.setCursor({ line: 0, ch: 0 });
                }, 120);
            };

            if (!isEditing()) {
                openSectionEditor();
                return;
            }

            if (isPreviewing()) {
                returnToCodeMode();
                window.setTimeout(openSectionEditor, 120);
                return;
            }

            openSectionEditor();
            return;
        }

        const focusEditorOnHeading = () => {
            const editor = ensureEditorInstance();
            if (!editor) {
                setStatus('Editor resources are still loading. Please try again in a moment.');
                return;
            }

            let location = viewerApi?.getHeadingLocation(slug);
            if (!location && sourceText) {
                viewerApi?.captureHeadings(sourceText);
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
