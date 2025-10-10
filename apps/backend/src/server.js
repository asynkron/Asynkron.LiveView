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
