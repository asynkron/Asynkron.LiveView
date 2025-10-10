import { isWebSocketOpen } from './utils.js';

export class DirectorySocketManager {
  constructor({ watchHub, resolveRoot }) {
    this.watchHub = watchHub;
    this.resolveRoot = resolveRoot;
    this.clients = new Map(); // ws -> root
  }

  async handleConnection(ws) {
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
        await this.watchHub.releaseWatcher(previousRoot);
        await this.watchHub.ensureWatcher(root);
      } else if (!previousRoot) {
        await this.watchHub.ensureWatcher(root);
      }

      this.clients.set(ws, root);
      const index = await this.watchHub.fileManager.buildMarkdownIndex(root);
      if (isWebSocketOpen(ws)) {
        ws.send(
          JSON.stringify({
            type: 'directory_update',
            path: root,
            files: index.files,
            tree: index.tree,
          }),
        );
      }
    });

    ws.on('close', async () => {
      const root = this.clients.get(ws);
      this.clients.delete(ws);
      if (root) {
        await this.watchHub.releaseWatcher(root);
      }
    });
  }

  broadcast(root, payload) {
    for (const [ws, subscribedRoot] of this.clients.entries()) {
      if (subscribedRoot !== root || !isWebSocketOpen(ws)) {
        continue;
      }
      try {
        ws.send(JSON.stringify(payload));
      } catch (error) {
        ws.terminate?.();
        this.clients.delete(ws);
      }
    }
  }

  async stopAll() {
    for (const [ws] of Array.from(this.clients.entries())) {
      try {
        ws.close();
      } catch (error) {
        ws.terminate?.();
      }
      this.clients.delete(ws);
    }
    await this.watchHub.stopAll();
  }
}
