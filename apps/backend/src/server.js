import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { WebSocketServer } from 'ws';

import { FileManager } from './fileManager.js';
import { AgentSocketManager, sendAgentPayload } from './server/agentSocket.js';
import { DirectorySocketManager } from './server/directorySocket.js';
import { createHttpApp } from './server/httpApp.js';
import { createRoutes } from './server/routes.js';
import { TerminalSocketManager } from './server/terminalSocket.js';
import { WatchHub } from './server/watchHub.js';

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

    this.watchHub = new WatchHub({ fileManager: this.fileManager });
    this.directorySocketManager = new DirectorySocketManager({
      watchHub: this.watchHub,
      resolveRoot: this.resolveRoot.bind(this),
    });
    this.watchHub.setBroadcaster((root, payload) => {
      this.directorySocketManager.broadcast(root, payload);
    });

    this.agentSocketManager = new AgentSocketManager({
      agentConfig: this.agentConfig,
      sendPayload: (ws, payload) => sendAgentPayload(ws, payload),
    });

    this.terminalSocketManager = new TerminalSocketManager();
  }

  async start() {
    await fs.mkdir(this.defaultRoot, { recursive: true });
    await this.warnIfMissingBundle();

    const routes = createRoutes({
      fileManager: this.fileManager,
      watchHub: this.watchHub,
      getTemplate: () => fs.readFile(this.templatePath, 'utf8'),
      resolveRoot: this.resolveRoot.bind(this),
    });

    const app = createHttpApp({
      routes,
      staticAssetsPath: this.staticAssetsPath,
    });
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

    directorySocket.on('connection', (ws) => this.directorySocketManager.handleConnection(ws));
    terminalSocket.on('connection', (ws) => this.terminalSocketManager.handleConnection(ws));
    agentSocket.on('connection', (ws) => this.agentSocketManager.handleConnection(ws));

    server.listen(this.port, () => {
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
    await this.directorySocketManager.stopAll();
    await this.agentSocketManager.stopAll('server-stop');
    this.terminalSocketManager.stopAll();

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

  async warnIfMissingBundle() {
    if (!this.staticAssetsPath) {
      return;
    }

    const distPath = path.join(this.staticAssetsPath, 'dist');
    const bundlePath = path.join(distPath, 'unified_index.js');
    try {
      await fs.access(bundlePath);
    } catch (error) {
      console.warn(
        `Frontend bundle not found in ${distPath}. Run 'npm run frontend:build' to generate the static assets.`,
      );
    }
  }
}
