import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { WebSocketServer } from 'ws';

import { FileManager } from './fileManager.js';
import { DirectorySocketManager } from './server/directorySocket.js';
import { createHttpApp } from './server/httpApp.js';
import { createRoutes } from './server/routes.js';
import { WatchHub } from './server/watchHub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    this.watchHub = new WatchHub({ fileManager: this.fileManager });
    this.directorySocketManager = new DirectorySocketManager({
      watchHub: this.watchHub,
      resolveRoot: this.resolveRoot.bind(this),
      handleFilesystemEvent: (...args) => this.handleFilesystemEvent(...args),
    });
    this.watchHub.setBroadcaster((root, payload) => {
      this.directorySocketManager.broadcast(root, payload);
    });
  }

  async handleFilesystemEvent(rootPath, kind, relativePath) {
    return this.watchHub.handleFilesystemEvent(rootPath, kind, relativePath);
  }

  createApp() {
    const routes = createRoutes({
      fileManager: this.fileManager,
      watchHub: this.watchHub,
      getTemplate: () => fs.readFile(this.templatePath, "utf8"),
      resolveRoot: this.resolveRoot.bind(this),
      handleFilesystemEvent: (...args) => this.handleFilesystemEvent(...args),
    });

    return createHttpApp({
      routes,
      staticAssetsPath: this.staticAssetsPath,
    });
  }

  async start() {
    await fs.mkdir(this.defaultRoot, { recursive: true });
    await this.warnIfMissingBundle();

    const app = this.createApp();
    const server = http.createServer(app);

    const directorySocket = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      if (request.url.startsWith('/ws')) {
        directorySocket.handleUpgrade(request, socket, head, (ws) => {
          directorySocket.emit('connection', ws, request);
        });
        return;
      }

      socket.destroy();
    });

    directorySocket.on('connection', (ws) => this.directorySocketManager.handleConnection(ws));

    server.listen(this.port, () => {
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        this.port = address.port;
      }
      console.log(`Node backend listening on port ${this.port}`);
    });

    this.server = server;
    this.directorySocket = directorySocket;
    return server;
  }

  async stop() {
    await this.directorySocketManager.stopAll();

    if (this.directorySocket) {
      for (const client of this.directorySocket.clients) {
        client.terminate();
      }
      await new Promise((resolve) => this.directorySocket?.close(resolve));
      this.directorySocket = undefined;
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
