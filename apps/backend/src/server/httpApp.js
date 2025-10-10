import express from 'express';

export function createHttpApp({ routes, staticAssetsPath }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/', routes.handleIndex);
  app.get('/api/files', routes.handleListFiles);
  app.get('/api/file', routes.handleGetFile);
  app.get('/api/file/raw', routes.handleGetFileRaw);
  app.delete('/api/file', routes.handleDeleteFile);
  app.put('/api/file', routes.handleUpdateFile);

  if (staticAssetsPath) {
    app.use('/static', express.static(staticAssetsPath));
  }

  return app;
}
