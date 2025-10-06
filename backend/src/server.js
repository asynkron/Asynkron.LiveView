import fs from "fs/promises";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import chokidar from "chokidar";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import pty from "node-pty";

import { FileManager } from "./fileManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Rough Node.js clone of the original Python server implementation.
 * The class intentionally mirrors the method names so the port stays
 * recognizable to contributors that are familiar with the aiohttp code.
 */
export class UnifiedMarkdownServer {
  constructor({ markdownDir = "markdown", port = 8080 } = {}) {
    this.defaultRoot = path.resolve(markdownDir);
    this.port = port;
    this.fileManager = new FileManager();
    this.templatePath = path.resolve(__dirname, "..", "..", "templates", "unified_index.html");
    this.staticAssetsPath = path.resolve(__dirname, "..", "..", "templates", "static");

    // Track websocket clients and file system watchers so we can broadcast updates.
    this.clients = new Map(); // ws -> subscribed root
    this.watchers = new Map(); // root -> { watcher, clients }
  }

  /**
    * Lazily create the Express app with all routes attached.
    */
  createApp() {
    const app = express();
    app.use(express.json({ limit: "1mb" }));

    app.get("/", this.#wrapRoute(this.handleIndex.bind(this)));
    app.get("/api/files", this.#wrapRoute(this.handleListFiles.bind(this)));
    app.get("/api/file", this.#wrapRoute(this.handleGetFile.bind(this)));
    app.get("/api/file/raw", this.#wrapRoute(this.handleGetFileRaw.bind(this)));
    app.delete("/api/file", this.#wrapRoute(this.handleDeleteFile.bind(this)));
    app.put("/api/file", this.#wrapRoute(this.handleUpdateFile.bind(this)));

    if (this.staticAssetsPath) {
      app.use("/static", express.static(this.staticAssetsPath));
    }

    return app;
  }

  /**
   * Start the HTTP server and attach websocket handlers for both the watcher
   * feed and the terminal transport.
   */
  async start() {
    await fs.mkdir(this.defaultRoot, { recursive: true });

    const app = this.createApp();
    const server = http.createServer(app);

    const directorySocket = new WebSocketServer({ noServer: true });
    const terminalSocket = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      if (request.url.startsWith("/ws/terminal")) {
        terminalSocket.handleUpgrade(request, socket, head, (ws) => {
          terminalSocket.emit("connection", ws, request);
        });
        return;
      }

      if (request.url.startsWith("/ws")) {
        directorySocket.handleUpgrade(request, socket, head, (ws) => {
          directorySocket.emit("connection", ws, request);
        });
        return;
      }

      socket.destroy();
    });

    directorySocket.on("connection", (ws) => this.#handleDirectorySocket(ws));
    terminalSocket.on("connection", (ws) => this.#handleTerminalSocket(ws));

    server.listen(this.port, () => {
      // eslint-disable-next-line no-console
      const address = server.address();
      if (typeof address === "object" && address?.port) {
        this.port = address.port;
      }
      console.log(`Node backend listening on port ${this.port}`);
    });

    this.server = server;
    this.directorySocket = directorySocket;
    this.terminalSocket = terminalSocket;
    return server;
  }

  async stop() {
    for (const record of this.watchers.values()) {
      await record.watcher.close();
    }
    this.watchers.clear();

    for (const ws of this.clients.keys()) {
      ws.close();
    }
    this.clients.clear();

    await new Promise((resolve) => this.server?.close(resolve));
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

    const template = await fs.readFile(this.templatePath, "utf8");
    const html = template.replace("__INITIAL_STATE_JSON__", JSON.stringify(initialState));
    res.type("html").send(html);
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
      res.status(400).json({ error: "Missing file parameter" });
      return;
    }

    const { root, display } = this.resolveRoot(pathParam);
    try {
      const content = await this.fileManager.readMarkdown(root, fileParam);
      res.json({ rootPath: root, pathArgument: display, file: fileParam, content });
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }

  async handleGetFileRaw(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    if (!fileParam) {
      res.status(400).send("Missing file parameter");
      return;
    }

    const { root } = this.resolveRoot(pathParam);
    try {
      const content = await this.fileManager.readMarkdown(root, fileParam);
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(fileParam)}"`);
      res.type("text/markdown").send(content);
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      res.status(status).send(error.message);
    }
  }

  async handleDeleteFile(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    if (!fileParam) {
      res.status(400).json({ error: "Missing file parameter" });
      return;
    }

    const { root } = this.resolveRoot(pathParam);
    try {
      await this.fileManager.deleteMarkdown(root, fileParam);
      await this.handleFilesystemEvent(root, "deleted", fileParam);
      res.json({ success: true });
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }

  async handleUpdateFile(req, res) {
    const pathParam = req.query.path;
    const fileParam = req.query.file;
    if (!fileParam) {
      res.status(400).json({ error: "Missing file parameter" });
      return;
    }

    const { root } = this.resolveRoot(pathParam);
    const content = req.body?.content;
    if (typeof content !== "string") {
      res.status(400).json({ error: "Missing content" });
      return;
    }

    try {
      await this.fileManager.writeMarkdown(root, fileParam, content);
      await this.handleFilesystemEvent(root, "modified", fileParam);
      res.json({ success: true, file: fileParam, content });
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }

  resolveRoot(pathArgument) {
    const display = pathArgument ?? this.defaultRoot;
    let candidate = display;
    if (typeof candidate === "string") {
      try {
        candidate = decodeURIComponent(candidate);
      } catch (error) {
        candidate = display;
      }
      if (candidate.startsWith("~")) {
        const home = process.env.HOME || process.env.USERPROFILE;
        if (home) {
          if (candidate === "~") {
            candidate = home;
          } else if (candidate.startsWith("~/")) {
            candidate = path.resolve(home, candidate.slice(2));
          }
        }
      }
    }

    return { root: path.resolve(candidate), display };
  }

  async handleFilesystemEvent(root, kind, relativePath) {
    if (["created", "deleted", "moved"].includes(kind)) {
      await this.notifyDirectoryUpdate(root);
    }
    if (["modified", "created", "moved"].includes(kind) && relativePath) {
      await this.notifyFileChanged(root, relativePath);
    }
  }

  async notifyDirectoryUpdate(root) {
    const index = await this.fileManager.buildMarkdownIndex(root);
    await this.#broadcast(root, {
      type: "directory_update",
      path: root,
      files: index.files,
      tree: index.tree,
    });
  }

  async notifyFileChanged(root, relativePath) {
    await this.#broadcast(root, {
      type: "file_changed",
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
      ignored: (watchedPath) => path.basename(watchedPath).startsWith("."),
    });

    const emitFile = async (kind, filePath) => {
      if (path.extname(filePath).toLowerCase() !== ".md") {
        return;
      }
      const relative = path.relative(root, filePath).split(path.sep).join("/");
      await this.handleFilesystemEvent(root, kind, relative);
    };

    watcher.on("add", (filePath) => emitFile("created", filePath));
    watcher.on("change", (filePath) => emitFile("modified", filePath));
    watcher.on("unlink", (filePath) => emitFile("deleted", filePath));
    watcher.on("addDir", () => this.handleFilesystemEvent(root, "created"));
    watcher.on("unlinkDir", () => this.handleFilesystemEvent(root, "deleted"));
    watcher.on("error", (error) => {
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
    ws.on("message", async (message) => {
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch (error) {
        return;
      }

      if (payload.type !== "subscribe") {
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
          type: "directory_update",
          path: root,
          files: index.files,
          tree: index.tree,
        }),
      );
    });

    ws.on("close", async () => {
      const root = this.clients.get(ws);
      this.clients.delete(ws);
      if (root) {
        await this.#releaseWatcher(root);
      }
    });
  }

  #handleTerminalSocket(ws) {
    // node-pty gives us a stable pseudo-terminal similar to the Python pty.fork logic.
    const shell = process.env.SHELL || "bash";
    const term = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env,
    });

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ws.send(JSON.stringify({ type: "state", message: "Shell ready" }));

    ws.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (error) {
        term.write(raw.toString());
        return;
      }

      if (payload.type === "input" && typeof payload.data === "string") {
        term.write(payload.data);
      } else if (payload.type === "resize") {
        const cols = Number(payload.cols) || 80;
        const rows = Number(payload.rows) || 30;
        term.resize(cols, rows);
      }
    });

    ws.on("close", () => {
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
