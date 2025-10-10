import path from 'path';

function wrapRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function createRoutes({ fileManager, watchHub, getTemplate, resolveRoot, handleFilesystemEvent = null }) {
  const loadTemplate = typeof getTemplate === 'function' ? getTemplate : async () => '';

  const emitFilesystemEvent =
    typeof handleFilesystemEvent === 'function'
      ? handleFilesystemEvent
      : (root, kind, relativePath) => watchHub.handleFilesystemEvent(root, kind, relativePath);

  return {
    handleIndex: wrapRoute(async (req, res) => {
      const pathParam = req.query.path;
      const fileParam = req.query.file;
      const { root, display } = resolveRoot(pathParam);

      let index;
      let files = [];
      let tree = [];
      let errorMessage;

      try {
        index = await fileManager.buildMarkdownIndex(root);
        files = index.files;
        tree = index.tree;
      } catch (error) {
        errorMessage = `Unable to list markdown files: ${error.message}`;
      }

      let selectedFile = null;
      let content;
      const fallback = fileManager.fallbackMarkdown(root);

      if (fileParam) {
        try {
          content = await fileManager.readMarkdown(root, fileParam);
          selectedFile = fileParam;
        } catch (error) {
          content = fallback;
          errorMessage = errorMessage || `Unable to read ${fileParam}: ${error.message}`;
        }
      } else if (files.length > 0) {
        selectedFile = files[0].relativePath;
        content = await fileManager.readMarkdown(root, selectedFile);
      } else {
        content = fallback;
      }

      const initialState = {
        rootPath: root,
        pathArgument: display,
        files,
        fileTree: tree,
        selectedFile,
        content,
        error: errorMessage,
        fallback,
      };

      let template;
      try {
        template = await loadTemplate();
      } catch (error) {
        res.status(500).send(`Failed to load frontend bundle: ${error.message}`);
        return;
      }

      const html = template.replace('__INITIAL_STATE_JSON__', JSON.stringify(initialState));
      res.type('html').send(html);
    }),

    handleListFiles: wrapRoute(async (req, res) => {
      const pathParam = req.query.path;
      const { root, display } = resolveRoot(pathParam);
      const index = await fileManager.buildMarkdownIndex(root);
      res.json({
        rootPath: root,
        pathArgument: display,
        files: index.files,
        tree: index.tree,
      });
    }),

    handleGetFile: wrapRoute(async (req, res) => {
      const pathParam = req.query.path;
      const fileParam = req.query.file;
      if (!fileParam) {
        res.status(400).json({ error: 'Missing file parameter' });
        return;
      }

      const { root, display } = resolveRoot(pathParam);
      try {
        const content = await fileManager.readMarkdown(root, fileParam);
        res.json({ rootPath: root, pathArgument: display, file: fileParam, content });
      } catch (error) {
        const status = error.code === 'ENOENT' ? 404 : 400;
        res.status(status).json({ error: error.message });
      }
    }),

    handleGetFileRaw: wrapRoute(async (req, res) => {
      const pathParam = req.query.path;
      const fileParam = req.query.file;
      if (!fileParam) {
        res.status(400).send('Missing file parameter');
        return;
      }

      const { root } = resolveRoot(pathParam);
      try {
        const content = await fileManager.readMarkdown(root, fileParam);
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fileParam)}"`);
        res.type('text/markdown').send(content);
      } catch (error) {
        const status = error.code === 'ENOENT' ? 404 : 400;
        res.status(status).send(error.message);
      }
    }),

    handleDeleteFile: wrapRoute(async (req, res) => {
      const pathParam = req.query.path;
      const fileParam = req.query.file;
      if (!fileParam) {
        res.status(400).json({ error: 'Missing file parameter' });
        return;
      }

      const { root } = resolveRoot(pathParam);
      try {
        await fileManager.deleteMarkdown(root, fileParam);
        await emitFilesystemEvent(root, 'deleted', fileParam);
        res.json({ success: true });
      } catch (error) {
        const status = error.code === 'ENOENT' ? 404 : 400;
        res.status(status).json({ error: error.message });
      }
    }),

    handleUpdateFile: wrapRoute(async (req, res) => {
      const pathParam = req.query.path;
      const fileParam = req.query.file;
      if (!fileParam) {
        res.status(400).json({ error: 'Missing file parameter' });
        return;
      }

      const { root } = resolveRoot(pathParam);
      const content = req.body?.content;
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'Missing content' });
        return;
      }

      try {
        await fileManager.writeMarkdown(root, fileParam, content);
        await emitFilesystemEvent(root, 'modified', fileParam);
        res.json({ success: true, file: fileParam, content });
      } catch (error) {
        const status = error.code === 'ENOENT' ? 404 : 400;
        res.status(status).json({ error: error.message });
      }
    }),
  };
}
