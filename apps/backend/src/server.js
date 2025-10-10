import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import chokidar from 'chokidar';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import { createWebSocketBinding } from '@asynkron/openagent';

import { FileManager } from './fileManager.js';
import { createTerminal } from './terminal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normaliseAgentText(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  try {
    return String(value);
  } catch (error) {
    console.warn('Failed to normalise agent value', error);
    return '';
  }
}

function formatAgentEvent(event) {
  if (!event || typeof event !== 'object') {
    return undefined;
  }

  switch (event.type) {
    case 'assistant-message': {
      const text = normaliseAgentText(event.message).trim();
      if (!text) {
        return undefined;
      }
      return JSON.stringify({ type: 'agent_message', text });
    }
    case 'status': {
      const text = normaliseAgentText(event.message);
      if (!text) {
        return undefined;
      }
      const payload = {
        type: 'agent_status',
        text,
        eventType: 'status',
      };
      if (typeof event.level === 'string' && event.level) {
        payload.level = event.level;
      }
      if (typeof event.details === 'string' && event.details) {
        payload.details = event.details;
      }
      if (typeof event.title === 'string' && event.title) {
        payload.title = normaliseAgentText(event.title);
      }
      return JSON.stringify(payload);
    }
    case 'error': {
      const message = normaliseAgentText(event.message) || 'Agent runtime reported an error.';
      const payload = {
        type: 'agent_error',
        message,
      };
      if (event.details) {
        payload.details = normaliseAgentText(event.details);
      }
      return JSON.stringify(payload);
    }
    case 'thinking': {
      if (event.state === 'start' || event.state === 'stop') {
        return JSON.stringify({ type: 'agent_thinking', state: event.state });
      }
      return undefined;
    }
    case 'banner': {
      const title = normaliseAgentText(event.title);
      if (!title) {
        return undefined;
      }
      const payload = {
        type: 'agent_status',
        text: title,
        title,
        level: 'info',
        eventType: 'banner',
      };
      if (typeof event.subtitle === 'string' && event.subtitle) {
        payload.subtitle = normaliseAgentText(event.subtitle);
      }
      if (typeof event.description === 'string' && event.description) {
        payload.description = normaliseAgentText(event.description);
      }
      if (typeof event.details === 'string' && event.details) {
        payload.details = normaliseAgentText(event.details);
      }
      return JSON.stringify(payload);
    }
    case 'plan': {
      if (Array.isArray(event.plan)) {
        return JSON.stringify({ type: 'agent_plan', plan: event.plan });
      }
      return undefined;
    }
    case 'command-result': {
      const command = event.command && typeof event.command === 'object' ? event.command : null;
      const result = event.result && typeof event.result === 'object' ? event.result : null;
      const preview = event.preview && typeof event.preview === 'object' ? event.preview : null;

      const payload = {
        type: 'agent_command',
      };

      if (command) {
        const normalizedCommand = {};

        const run = normaliseAgentText(command.run).trim();
        if (run) {
          normalizedCommand.run = run;
        }

        const description = normaliseAgentText(command.description).trim();
        if (description) {
          normalizedCommand.description = description;
        }

        if (typeof command.shell === 'string') {
          const shell = normaliseAgentText(command.shell).trim();
          if (shell) {
            normalizedCommand.shell = shell;
          }
        }

        if (typeof command.cwd === 'string') {
          const cwd = normaliseAgentText(command.cwd).trim();
          if (cwd) {
            normalizedCommand.cwd = cwd;
          }
        }

        const timeout =
          typeof command.timeout_sec === 'number'
            ? command.timeout_sec
            : typeof command.timeout === 'number'
              ? command.timeout
              : null;
        if (Number.isFinite(timeout)) {
          normalizedCommand.timeoutSeconds = timeout;
        }

        if (typeof command.filter_regex === 'string') {
          const filter = normaliseAgentText(command.filter_regex).trim();
          if (filter) {
            normalizedCommand.filterRegex = filter;
          }
        }

        if (typeof command.tail_lines === 'number' && Number.isFinite(command.tail_lines)) {
          normalizedCommand.tailLines = command.tail_lines;
        }

        if (Object.keys(normalizedCommand).length > 0) {
          payload.command = normalizedCommand;
        }
      }

      if (result) {
        if (typeof result.exit_code === 'number' || result.exit_code === null) {
          payload.exitCode = result.exit_code;
        }
        if (typeof result.runtime_ms === 'number' && Number.isFinite(result.runtime_ms)) {
          payload.runtimeMs = result.runtime_ms;
        }
        if (typeof result.killed === 'boolean') {
          payload.killed = result.killed;
        }
      }

      if (preview) {
        const stdout = normaliseAgentText(preview.stdoutPreview || preview.stdout);
        const stderr = normaliseAgentText(preview.stderrPreview || preview.stderr);
        const trimmedStdout = stdout.trim();
        const trimmedStderr = stderr.trim();
        if (trimmedStdout || trimmedStderr) {
          payload.preview = {};
          if (trimmedStdout) {
            payload.preview.stdout = stdout;
          }
          if (trimmedStderr) {
            payload.preview.stderr = stderr;
          }
        }
      }

      return JSON.stringify(payload);
    }
    case 'request-input': {
      const payload = {
        type: 'agent_request_input',
        prompt: normaliseAgentText(event.prompt),
      };
      if (typeof event.level === 'string' && event.level) {
        payload.level = event.level;
      }
      if (event.metadata && typeof event.metadata === 'object') {
        try {
          payload.metadata = JSON.parse(JSON.stringify(event.metadata));
        } catch (error) {
          console.warn('Failed to serialise agent metadata', error);
        }
      }
      return JSON.stringify(payload);
    }
    default:
      return undefined;
  }
}

function describeAgentError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown error';
}

/**
 * Rough Node.js clone of the original Python server implementation.
 * The class intentionally mirrors the method names so the port stays
 * recognizable to contributors that are familiar with the aiohttp code.
 */
export class UnifiedMarkdownServer {
  constructor({ markdownDir = 'markdown', port = 8080, agent = {} } = {}) {
    this.defaultRoot = path.resolve(markdownDir);
    this.port = port;
    this.fileManager = new FileManager();
    this.publicPath = path.resolve(__dirname, '..', 'public');
    this.templatePath = path.join(this.publicPath, 'unified_index.html');
    this.staticAssetsPath = path.join(this.publicPath, 'static');

    this.agentConfig = {
      autoApprove: agent?.autoApprove !== false,
    };

    // Track websocket clients and file system watchers so we can broadcast updates.
    this.clients = new Map(); // ws -> subscribed root
    this.watchers = new Map(); // root -> { watcher, clients }
    this.agentClients = new Map(); // ws -> { binding, cleaned }
  }

  #buildAgentRuntimeOptions() {
    if (this.agentConfig?.autoApprove === false) {
      return undefined;
    }

    return {
      getAutoApproveFlag: () => true,
      emitAutoApproveStatus: true,
    };
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

    const agentEntries = Array.from(this.agentClients.entries());
    for (const [ws, record] of agentEntries) {
      const binding = record?.binding ?? record;
      if (record?.cleanup) {
        try {
          await record.cleanup('server-stop');
        } catch (error) {
          console.warn('Failed to clean up agent binding', error);
        }
      } else if (binding) {
        try {
          await binding.stop?.({ reason: 'server-stop' });
        } catch (error) {
          console.warn('Failed to stop agent binding', error);
        }
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
    let binding;
    console.log('Agent websocket connection received - initialising runtime binding');
    try {
      const runtimeOptions = this.#buildAgentRuntimeOptions();
      const bindingOptions = {
        socket: ws,
        autoStart: false,
        formatOutgoing: (event) => {
          console.log('Agent runtime emitted event', event);
          return formatAgentEvent(event);
        },
      };

      if (runtimeOptions) {
        bindingOptions.runtimeOptions = runtimeOptions;
      }

      binding = createWebSocketBinding(bindingOptions);
    } catch (error) {
      const details = describeAgentError(error);
      this.#sendAgentPayload(ws, {
        type: 'agent_error',
        message: 'Failed to initialize the agent runtime.',
        details,
      });
      try {
        ws.close(1011, 'Agent runtime unavailable');
      } catch (closeError) {
        console.warn('Failed to close agent websocket after initialization error', closeError);
      }
      return;
    }

    const record = {
      binding,
      cleaned: false,
      cleanup: null,
    };

    let cleanup;

    const handleClose = () => {
      console.log('Agent websocket closed by client');
      void cleanup?.('socket-close');
    };

    const handleError = (socketError) => {
      if (socketError && socketError.message) {
        console.warn('Agent websocket error', socketError);
      }
      void cleanup?.('socket-error');
    };

    cleanup = async (reason = 'socket-close') => {
      if (record.cleaned) {
        return;
      }
      record.cleaned = true;
      this.agentClients.delete(ws);

      console.log('Cleaning up agent websocket binding', { reason });

      try {
        ws.off?.('close', handleClose);
        ws.off?.('error', handleError);
      } catch (error) {
        // Ignore listener removal failures; the socket may already be closed.
      }

      try {
        await binding.stop?.({ reason });
      } catch (error) {
        console.warn('Failed to stop agent binding cleanly', error);
      }
    };

    record.cleanup = cleanup;
    this.agentClients.set(ws, record);

    ws.on('close', handleClose);
    ws.on('error', handleError);

    ws.on('message', (raw, isBinary) => {
      // Log the control flow of the agent socket without disrupting existing consumers.
      let serialized;
      if (typeof raw === 'string') {
        serialized = raw;
      } else if (Buffer.isBuffer(raw)) {
        serialized = raw.toString('utf8');
      } else if (!isBinary && raw && typeof raw.toString === 'function') {
        serialized = raw.toString();
      } else {
        serialized = '';
      }

      console.log('Agent websocket received payload', serialized || raw);

      // Normalise CLI chat events ("type": "chat") and explicit prompt payloads
      // ("type": "prompt") into runtime submissions so they reach the agent
      // queue. The websocket binding only understands prompt-style payloads, so we
      // translate here while leaving existing formats untouched for backwards
      // compatibility.
      if (!serialized || !binding?.runtime?.submitPrompt) {
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(serialized);
      } catch (error) {
        // Non-JSON payloads are handled by the OpenAgent websocket binding.
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const type = typeof parsed.type === 'string' ? parsed.type.toLowerCase() : undefined;
      if (type !== 'chat' && type !== 'prompt') {
        return;
      }

      const promptSource =
        typeof parsed.prompt !== 'undefined'
          ? parsed.prompt
          : typeof parsed.text !== 'undefined'
          ? parsed.text
          : typeof parsed.value !== 'undefined'
            ? parsed.value
            : parsed.message;

      if (typeof promptSource === 'undefined') {
        return;
      }

      const prompt =
        typeof promptSource === 'string'
          ? promptSource.trim()
          : normaliseAgentText(promptSource).trim();

      if (!prompt) {
        return;
      }

      try {
        binding.runtime.submitPrompt(prompt);
        console.log('Forwarded agent prompt payload to runtime queue');
      } catch (error) {
        console.warn('Failed to forward agent prompt payload to runtime queue', error);
      }
    });

    try {
      const startResult = binding.start?.();
      if (startResult && typeof startResult.then === 'function') {
        startResult
          .then(() => {
            console.log('Agent runtime reported async start completion');
          })
          .catch(async (startError) => {
            const details = describeAgentError(startError);
            this.#sendAgentPayload(ws, {
              type: 'agent_error',
              message: 'Agent runtime failed to start.',
              details,
            });
            await cleanup('runtime-error');
            try {
              ws.close(1011, 'Agent runtime failed to start');
            } catch (closeError) {
              console.warn('Failed to close agent websocket after runtime error', closeError);
            }
          });
      } else {
        console.log('Agent runtime started synchronously');
      }
    } catch (error) {
      const details = describeAgentError(error);
      this.#sendAgentPayload(ws, {
        type: 'agent_error',
        message: 'Agent runtime failed to start.',
        details,
      });
      void cleanup('runtime-error');
      try {
        ws.close(1011, 'Agent runtime failed to start');
      } catch (closeError) {
        console.warn('Failed to close agent websocket after synchronous runtime error', closeError);
      }
    }
  }

  #sendAgentPayload(ws, payload) {
    if (!payload) {
      return false;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      console.warn('Failed to send agent payload to client', error);
      return false;
    }
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
