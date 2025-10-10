import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import chokidar from 'chokidar';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import { FileManager } from './fileManager.js';
import { createTerminal } from './terminal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FakeAgent {
  constructor({ send }) {
    if (typeof send !== 'function') {
      throw new Error('FakeAgent requires a send function');
    }
    this.send = send;
    this.formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'long',
    });
  }

  respond() {
    const formatted = this.formatter.format(new Date());
    return `It is ${formatted} right now (server time).`;
  }

  handleUserMessage() {
    try {
      this.send({ type: 'agent_message', text: this.respond() });
    } catch (error) {
      console.warn('Failed to deliver fake agent response', error);
    }
  }

  dispose() {}
}

/**
 * Rough Node.js clone of the original Python server implementation.
 * The class intentionally mirrors the method names so the port stays
 * recognizable to contributors that are familiar with the aiohttp code.
 */
export class UnifiedMarkdownServer {
  constructor({ markdownDir = 'markdown', port = 8080 } = {}) {
    this.defaultRoot = path.resolve(markdownDir);
    this.port = port;
    this.fileManager = new FileManager();
    this.publicPath = path.resolve(__dirname, '..', 'public');
    this.templatePath = path.join(this.publicPath, 'unified_index.html');
    this.staticAssetsPath = path.join(this.publicPath, 'static');

    // Track websocket clients and file system watchers so we can broadcast updates.
    this.clients = new Map(); // ws -> subscribed root
    this.watchers = new Map(); // root -> { watcher, clients }
    this.agentClients = new Map(); // ws -> FakeAgent
  }

  /**
   * Lazily create the Express app with all routes attached.
   */
  createApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    app.get('/', this.#wrapRoute(this.handleIndex.bind(this)));
    app.get('/api/files', this.#wrapRoute(this.handleListFiles.bind(this)));
    app.get('/api/file', this.#wrapRoute(this.handleGetFile.bind(this)));
    app.get('/api/file/raw', this.#wrapRoute(this.handleGetFileRaw.bind(this)));
    app.delete('/api/file', this.#wrapRoute(this.handleDeleteFile.bind(this)));
    app.put('/api/file', this.#wrapRoute(this.handleUpdateFile.bind(this)));

    if (this.staticAssetsPath) {
      app.use('/static', express.static(this.staticAssetsPath));
    }

    return app;
  }

  /**
   * Start the HTTP server and attach websocket handlers for both the watcher
   * feed and the terminal transport.
   */
  async start() {
    await fs.mkdir(this.defaultRoot, { recursive: true });
    await this.#warnIfMissingBundle();

    const app = this.createApp();
    const server = http.createServer(app);

    const directorySocket = new WebSocketServer({ noServer: true });
    const terminalSocket = new WebSocketServer({ noServer: true });
    const agentSocket = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      if (request.url.startsWith('/ws/terminal')) {
        terminalSocket.handleUpgrade(request, socket, head, (ws) => {
          terminalSocket.emit('connection', ws, request);
        });
        return;
      }

      if (request.url.startsWith('/ws/agent')) {
        agentSocket.handleUpgrade(request, socket, head, (ws) => {
          agentSocket.emit('connection', ws, request);
        });
        return;
      }

      if (request.url.startsWith('/ws')) {
        directorySocket.handleUpgrade(request, socket, head, (ws) => {
          directorySocket.emit('connection', ws, request);
        });
        return;
      }

      socket.destroy();
    });

    directorySocket.on('connection', (ws) => this.#handleDirectorySocket(ws));
    terminalSocket.on('connection', (ws) => {
      this.#handleTerminalSocket(ws);
    });
    agentSocket.on('connection', (ws) => {
      this.#handleAgentSocket(ws);
    });

    server.listen(this.port, () => {
      // eslint-disable-next-line no-console
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        this.port = address.port;
      }
      console.log(`Node backend listening on port ${this.port}`);
    });

    this.server = server;
    this.directorySocket = directorySocket;
    this.terminalSocket = terminalSocket;
    this.agentSocket = agentSocket;
    return server;
  }

  async stop() {
    for (const record of this.watchers.values()) {
      await record.watcher.close();
    }
    this.watchers.clear();

    for (const [ws, agent] of this.agentClients.entries()) {
      try {
        agent?.dispose?.();
      } catch (error) {
        console.warn('Failed to dispose agent instance', error);
      }
      try {
        ws.close();
      } catch (error) {
        console.warn('Failed to close agent websocket', error);
      }
    }
    this.agentClients.clear();

    for (const ws of this.clients.keys()) {
      ws.close();
    }
    this.clients.clear();

    if (this.directorySocket) {
      for (const client of this.directorySocket.clients) {
        client.terminate();
      }
      await new Promise((resolve) => this.directorySocket?.close(resolve));
      this.directorySocket = undefined;
    }

    if (this.terminalSocket) {
      for (const client of this.terminalSocket.clients) {
        client.terminate();
      }
      await new Promise((resolve) => this.terminalSocket?.close(resolve));
      this.terminalSocket = undefined;
    }

    if (this.agentSocket) {
      for (const client of this.agentSocket.clients) {
        client.terminate();
      }
      await new Promise((resolve) => this.agentSocket?.close(resolve));
      this.agentSocket = undefined;
    }

    await new Promise((resolve) => this.server?.close(resolve));
    this.server = undefined;
  }

  async handleIndex(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    const { root, display } = this.resolveRoot(pathParam);

    let index;
    let files = [];
    let tree = [];
    let errorMessage;

    try {
      index = await this.fileManager.buildMarkdownIndex(root);
      files = index.files;
      tree = index.tree;
    } catch (error) {
      errorMessage = `Unable to list markdown files: ${error.message}`;
    }

    let selectedFile = null;
    let content;
    const fallback = this.fileManager.fallbackMarkdown(root);

    if (fileParam) {
      try {
        content = await this.fileManager.readMarkdown(root, fileParam);
        selectedFile = fileParam;
      } catch (error) {
        content = fallback;
        errorMessage = errorMessage || `Unable to read ${fileParam}: ${error.message}`;
      }
    } else if (files.length > 0) {
      selectedFile = files[0].relativePath;
      content = await this.fileManager.readMarkdown(root, selectedFile);
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

    const template = await fs.readFile(this.templatePath, 'utf8');
    const html = template.replace('__INITIAL_STATE_JSON__', JSON.stringify(initialState));
    res.type('html').send(html);
  }

  #handleAgentSocket(ws) {
    const agent = new FakeAgent({
      send: (payload) => {
        if (!payload) {
          return;
        }
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
          }
        } catch (error) {
          console.warn('Failed to send payload to agent client', error);
        }
      },
    });

    this.agentClients.set(ws, agent);

    const cleanup = () => {
      const stored = this.agentClients.get(ws);
      if (stored === agent) {
        this.agentClients.delete(ws);
      }
      agent.dispose?.();
    };

    ws.on('message', (data) => {
      let payload;
      try {
        payload = JSON.parse(data);
      } catch (error) {
        console.warn('Received malformed agent payload', error);
        return;
      }

      if (payload?.type === 'user_message' && typeof payload.text === 'string' && payload.text.trim()) {
        agent.handleUserMessage();
      }
    });

    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }

  async handleListFiles(req, res) {
    const pathParam = req.query.path;
    const { root, display } = this.resolveRoot(pathParam);
    const index = await this.fileManager.buildMarkdownIndex(root);
    res.json({
      rootPath: root,
      pathArgument: display,
      files: index.files,
      tree: index.tree,
    });
  }

  async handleGetFile(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    if (!fileParam) {
      res.status(400).json({ error: 'Missing file parameter' });
      return;
    }

    const { root, display } = this.resolveRoot(pathParam);
    try {
      const content = await this.fileManager.readMarkdown(root, fileParam);
      res.json({ rootPath: root, pathArgument: display, file: fileParam, content });
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }

  async handleGetFileRaw(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    if (!fileParam) {
      res.status(400).send('Missing file parameter');
      return;
    }

    const { root } = this.resolveRoot(pathParam);
    try {
      const content = await this.fileManager.readMarkdown(root, fileParam);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fileParam)}"`);
      res.type('text/markdown').send(content);
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 400;
      res.status(status).send(error.message);
    }
  }

  async handleDeleteFile(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    if (!fileParam) {
      res.status(400).json({ error: 'Missing file parameter' });
      return;
    }

    const { root } = this.resolveRoot(pathParam);
    try {
      await this.fileManager.deleteMarkdown(root, fileParam);
      await this.handleFilesystemEvent(root, 'deleted', fileParam);
      res.json({ success: true });
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }

  async handleUpdateFile(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    if (!fileParam) {
      res.status(400).json({ error: 'Missing file parameter' });
      return;
    }

    const { root } = this.resolveRoot(pathParam);
    const content = req.body?.content;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'Missing content' });
      return;
    }

    try {
      await this.fileManager.writeMarkdown(root, fileParam, content);
      await this.handleFilesystemEvent(root, 'modified', fileParam);
      res.json({ success: true, file: fileParam, content });
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }

  resolveRoot(pathArgument) {
    const display = pathArgument ?? this.defaultRoot;
    let candidate = display;
    if (typeof candidate === 'string') {
      try {
        candidate = decodeURIComponent(candidate);
      } catch (error) {
        candidate = display;
      }
      if (candidate.startsWith('~')) {
        const home = process.env.HOME || process.env.USERPROFILE;
        if (home) {
          if (candidate === '~') {
            candidate = home;
          } else if (candidate.startsWith('~/')) {
            candidate = path.resolve(home, candidate.slice(2));
          }
        }
      }
    }

    return { root: path.resolve(candidate), display };
  }

  async handleFilesystemEvent(root, kind, relativePath) {
    if (['created', 'deleted', 'moved'].includes(kind)) {
      await this.notifyDirectoryUpdate(root);
    }
    if (['modified', 'created', 'moved'].includes(kind) && relativePath) {
      await this.notifyFileChanged(root, relativePath);
    }
  }

  async notifyDirectoryUpdate(root) {
    const index = await this.fileManager.buildMarkdownIndex(root);
    await this.#broadcast(root, {
      type: 'directory_update',
      path: root,
      files: index.files,
      tree: index.tree,
    });
  }

  async notifyFileChanged(root, relativePath) {
    await this.#broadcast(root, {
      type: 'file_changed',
      path: root,
      file: relativePath,
    });
  }

  async #ensureWatcher(root) {
    const existing = this.watchers.get(root);
    if (existing) {
      existing.clients += 1;
      return existing.watcher;
    }

    await fs.mkdir(root, { recursive: true });
    const watcher = chokidar.watch(root, {
      persistent: true,
      ignoreInitial: true,
      ignored: (watchedPath) => path.basename(watchedPath).startsWith('.'),
    });

    const emitFile = async (kind, filePath) => {
      if (path.extname(filePath).toLowerCase() !== '.md') {
        return;
      }
      const relative = path.relative(root, filePath).split(path.sep).join('/');
      await this.handleFilesystemEvent(root, kind, relative);
    };

    watcher.on('add', (filePath) => emitFile('created', filePath));
    watcher.on('change', (filePath) => emitFile('modified', filePath));
    watcher.on('unlink', (filePath) => emitFile('deleted', filePath));
    watcher.on('addDir', () => this.handleFilesystemEvent(root, 'created'));
    watcher.on('unlinkDir', () => this.handleFilesystemEvent(root, 'deleted'));
    watcher.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.error(`Watcher error for ${root}:`, error);
    });

    this.watchers.set(root, { watcher, clients: 1 });
    return watcher;
  }

  async #releaseWatcher(root) {
    const record = this.watchers.get(root);
    if (!record) {
      return;
    }

    record.clients -= 1;
    if (record.clients > 0) {
      return;
    }

    this.watchers.delete(root);
    await record.watcher.close();
  }

  async #warnIfMissingBundle() {
    if (!this.staticAssetsPath) {
      return;
    }

    const distPath = path.join(this.staticAssetsPath, 'dist');
    const bundlePath = path.join(distPath, 'unified_index.js');
    try {
      await fs.access(bundlePath);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Frontend bundle not found in ${distPath}. ` + "Run 'npm run frontend:build' to generate the static assets.");
    }
  }

  async #broadcast(root, payload) {
    for (const [ws, subscribedRoot] of this.clients.entries()) {
      if (subscribedRoot !== root || ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      try {
        ws.send(JSON.stringify(payload));
      } catch (error) {
        ws.terminate();
        this.clients.delete(ws);
      }
    }
  }

  #handleDirectorySocket(ws) {
    ws.on('message', async (message) => {
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch (error) {
        return;
      }

      if (payload.type !== 'subscribe') {
        return;
      }

      const { root } = this.resolveRoot(payload.path);
      const previousRoot = this.clients.get(ws);
      if (previousRoot && previousRoot !== root) {
        await this.#releaseWatcher(previousRoot);
        await this.#ensureWatcher(root);
      } else if (!previousRoot) {
        await this.#ensureWatcher(root);
      }

      this.clients.set(ws, root);
      const index = await this.fileManager.buildMarkdownIndex(root);
      ws.send(
        JSON.stringify({
          type: 'directory_update',
          path: root,
          files: index.files,
          tree: index.tree,
        }),
      );
    });

    ws.on('close', async () => {
      const root = this.clients.get(ws);
      this.clients.delete(ws);
      if (root) {
        await this.#releaseWatcher(root);
      }
    });
  }

  async #handleTerminalSocket(ws) {
    let term;
    try {
      term = await createTerminal({ cols: 80, rows: 30, cwd: process.cwd(), env: process.env });
    } catch (error) {
      ws.send(JSON.stringify({ type: 'state', message: `Failed to start shell: ${error.message}` }));
      ws.close(1011, 'Terminal unavailable');
      return;
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onExit(({ code, signal }) => {
      if (ws.readyState === WebSocket.OPEN) {
        const details =
          typeof code === 'number' || signal
            ? ` (code: ${code ?? 'null'}${signal ? `, signal: ${signal}` : ''})`
            : '';
        ws.send(
          JSON.stringify({
            type: 'state',
            message: `Shell exited${details}`,
          }),
        );
        ws.close(1000, 'Shell exited');
      }
    });

    const backendLabel = term.backend === 'node-pty' ? 'pty' : 'stdio';
    ws.send(JSON.stringify({ type: 'state', message: `Shell ready (${backendLabel})` }));

    ws.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (error) {
        term.write(raw.toString());
        return;
      }

      if (payload.type === 'input' && typeof payload.data === 'string') {
        term.write(payload.data);
      } else if (payload.type === 'resize') {
        const cols = Number(payload.cols) || 80;
        const rows = Number(payload.rows) || 30;
        term.resize(cols, rows);
      }
    });

    ws.on('close', () => {
      term.kill();
    });
  }

  #wrapRoute(handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }
}
