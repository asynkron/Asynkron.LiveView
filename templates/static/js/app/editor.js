export function setupEditor(ctx) {
    const {
        dom: {
            editorContainer,
            content,
        },
    } = ctx;

    function handleEditorContentChange(instance) {
        if (!instance || ctx.suppressEditorChangeEvents) {
            return;
        }
        ctx.draftContent = instance.getValue();
        ctx.setHasPendingChanges(ctx.draftContent !== ctx.currentContent);
    }

    function ensureEditorInstance() {
        if (ctx.editorInstance) {
            return ctx.editorInstance;
        }
        if (typeof window.CodeMirror === 'undefined' || !editorContainer) {
            return null;
        }

        editorContainer.innerHTML = '';
        ctx.suppressEditorChangeEvents = true;
        try {
            ctx.editorInstance = window.CodeMirror(editorContainer, {
                value: ctx.draftContent,
                mode: 'markdown',
                theme: 'one-dark',
                lineNumbers: true,
                lineWrapping: true,
                autofocus: true,
            });
            ctx.editorInstance.setSize('100%', '100%');
            ctx.editorInstance.on('change', handleEditorContentChange);
        } finally {
            ctx.suppressEditorChangeEvents = false;
        }
        ctx.setHasPendingChanges(ctx.draftContent !== ctx.currentContent);
        return ctx.editorInstance;
    }

    function enterEditMode() {
        if (!ctx.currentFile) {
            return;
        }
        if (typeof window.CodeMirror === 'undefined') {
            ctx.setStatus('Editor resources are still loading. Please try again in a moment.');
            return;
        }

        ctx.isEditing = true;
        ctx.isPreviewing = false;
        ctx.draftContent = ctx.currentContent;
        const editor = ensureEditorInstance();
        if (!editor) {
            ctx.isEditing = false;
            ctx.setStatus('Editor resources are still loading. Please try again in a moment.');
            ctx.updateActionVisibility();
            return;
        }

        ctx.suppressEditorChangeEvents = true;
        try {
            editor.setValue(ctx.draftContent);
        } finally {
            ctx.suppressEditorChangeEvents = false;
        }
        ctx.setHasPendingChanges(false);
        window.setTimeout(() => {
            editor.refresh();
            editor.focus();
        }, 0);

        if (content) {
            content.classList.add('hidden');
        }
        if (editorContainer) {
            editorContainer.classList.add('visible');
        }
        ctx.updateHeader();
        ctx.setStatus('Editing markdown…');
    }

    function enterPreviewMode() {
        if (!ctx.isEditing) {
            return;
        }
        const editor = ensureEditorInstance();
        if (editor) {
            ctx.draftContent = editor.getValue();
        }
        ctx.setHasPendingChanges(ctx.draftContent !== ctx.currentContent);
        ctx.isPreviewing = true;
        ctx.renderMarkdown(ctx.draftContent, { updateCurrent: false });
        if (editorContainer) {
            editorContainer.classList.remove('visible');
        }
        if (content) {
            content.classList.remove('hidden');
        }
        ctx.updateHeader();
        ctx.setStatus('Previewing changes.');
    }

    function returnToCodeMode() {
        if (!ctx.isPreviewing) {
            return;
        }
        ctx.isPreviewing = false;
        ctx.renderMarkdown(ctx.currentContent, { updateCurrent: true });
        if (content) {
            content.classList.add('hidden');
        }
        if (editorContainer) {
            editorContainer.classList.add('visible');
        }
        const editor = ensureEditorInstance();
        if (editor) {
            window.setTimeout(() => {
                editor.refresh();
                editor.focus();
            }, 0);
        }
        ctx.updateHeader();
        ctx.setStatus('Editing markdown…');
    }

    function exitEditMode(options = {}) {
        const { restoreContent = true } = options;
        if (!ctx.isEditing && !ctx.isPreviewing) {
            ctx.updateHeader();
            return;
        }
        ctx.isEditing = false;
        ctx.isPreviewing = false;
        ctx.draftContent = '';
        ctx.clearEditorHeadingHighlight?.();
        if (content) {
            content.classList.remove('hidden');
        }
        if (editorContainer) {
            editorContainer.classList.remove('visible');
        }
        if (restoreContent) {
            ctx.renderMarkdown(ctx.currentContent, { updateCurrent: true });
        }
        ctx.setHasPendingChanges(false);
        ctx.updateHeader();
    }

    ctx.ensureEditorInstance = ensureEditorInstance;
    ctx.enterEditMode = enterEditMode;
    ctx.enterPreviewMode = enterPreviewMode;
    ctx.returnToCodeMode = returnToCodeMode;
    ctx.exitEditMode = exitEditMode;
}
