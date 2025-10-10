import { createTerminal } from '../terminal.js';
import { isWebSocketOpen } from './utils.js';

export class TerminalSocketManager {
  constructor({ cols = 80, rows = 30, cwd = process.cwd(), env = process.env } = {}) {
    this.defaultConfig = { cols, rows, cwd, env };
    this.clients = new Map(); // ws -> term
  }

  async handleConnection(ws) {
    let term;
    try {
      term = await createTerminal(this.defaultConfig);
    } catch (error) {
      ws.send(JSON.stringify({ type: 'state', message: `Failed to start shell: ${error.message}` }));
      ws.close(1011, 'Terminal unavailable');
      return;
    }

    this.clients.set(ws, term);

    term.onData((data) => {
      if (isWebSocketOpen(ws)) {
        ws.send(data);
      }
    });

    term.onExit(({ code, signal }) => {
      if (isWebSocketOpen(ws)) {
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
    if (isWebSocketOpen(ws)) {
      ws.send(JSON.stringify({ type: 'state', message: `Shell ready (${backendLabel})` }));
    }

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
        const cols = Number(payload.cols) || this.defaultConfig.cols;
        const rows = Number(payload.rows) || this.defaultConfig.rows;
        term.resize(cols, rows);
      }
    });

    ws.on('close', () => {
      term.kill();
      this.clients.delete(ws);
    });
  }

  stopAll() {
    for (const [ws, term] of Array.from(this.clients.entries())) {
      try {
        term.kill();
      } catch (error) {
        console.warn('Failed to kill terminal process during shutdown', error);
      }
      try {
        ws.close();
      } catch (error) {
        console.warn('Failed to close terminal websocket during shutdown', error);
      }
      this.clients.delete(ws);
    }
  }
}
