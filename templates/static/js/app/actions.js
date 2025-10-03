export function setupActions(ctx) {
    const {
        dom: {
            editButton,
            previewButton,
            cancelButton,
            saveButton,
            downloadButton,
            deleteButton,
        },
    } = ctx;

    if (editButton) {
        editButton.addEventListener('click', () => {
            if (ctx.isEditing && ctx.isPreviewing) {
                ctx.returnToCodeMode?.();
                return;
            }
            if (!ctx.isEditing) {
                ctx.enterEditMode?.();
            }
        });
    }

    if (previewButton) {
        previewButton.addEventListener('click', () => {
            if (!ctx.currentFile) {
                return;
            }
            ctx.enterPreviewMode?.();
        });
    }

    if (cancelButton) {
        cancelButton.addEventListener('click', () => {
            if (!ctx.isEditing && !ctx.isPreviewing) {
                return;
            }
            ctx.exitEditMode?.();
            ctx.setStatus('Edits cancelled.');
        });
    }

    if (saveButton) {
        saveButton.addEventListener('click', async () => {
            await ctx.saveCurrentFile?.();
        });
    }

    if (downloadButton) {
        downloadButton.addEventListener('click', async () => {
            if (!ctx.currentFile) {
                return;
            }
            try {
                const data = await ctx.fetchJson(`/api/file${ctx.buildQuery({ file: ctx.currentFile })}`);
                const blob = new Blob([data.content || ''], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = ctx.currentFile;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (err) {
                ctx.setStatus(err.message);
                console.error('Download failed', err);
            }
        });
    }

    if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
            if (!ctx.currentFile) {
                return;
            }
            const confirmed = window.confirm(`Delete ${ctx.currentFile}?`);
            if (!confirmed) {
                return;
            }
            try {
                await ctx.fetchJson(`/api/file${ctx.buildQuery({ file: ctx.currentFile })}`, { method: 'DELETE' });
                ctx.setStatus('File deleted.');
                await ctx.refreshFiles();
            } catch (err) {
                ctx.setStatus(err.message);
                console.error('Delete failed', err);
            }
        });
    }
}
