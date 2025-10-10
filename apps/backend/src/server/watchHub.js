import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';

export class WatchHub {
  constructor({ fileManager }) {
    this.fileManager = fileManager;
    this.watchers = new Map(); // root -> { watcher, clients }
    this.broadcast = async () => {};
  }

  setBroadcaster(broadcaster) {
    if (typeof broadcaster === 'function') {
      this.broadcast = broadcaster;
    }
  }

  async ensureWatcher(root) {
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

  async releaseWatcher(root) {
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
    await this.broadcast(root, {
      type: 'directory_update',
      path: root,
      files: index.files,
      tree: index.tree,
    });
  }

  async notifyFileChanged(root, relativePath) {
    await this.broadcast(root, {
      type: 'file_changed',
      path: root,
      file: relativePath,
    });
  }

  async stopAll() {
    const entries = Array.from(this.watchers.values());
    this.watchers.clear();
    await Promise.allSettled(entries.map((record) => record.watcher.close())) ;
  }
}
