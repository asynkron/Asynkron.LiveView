import { spawn } from 'child_process';

function detectDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || 'bash';
}

function normalizeText(chunk) {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
}

function createSpawnTerminal({ shell, cwd, env }) {
  const child = spawn(shell, [], {
    cwd,
    env,
    stdio: 'pipe',
    windowsHide: process.platform === 'win32',
  });

  child.stdin.setDefaultEncoding('utf8');

  const dataHandlers = new Set();

  const forwardChunk = (chunk) => {
    const text = normalizeText(chunk);
    for (const handler of dataHandlers) {
      handler(text);
    }
  };

  child.stdout?.on('data', forwardChunk);
  child.stderr?.on('data', forwardChunk);

  return {
    backend: 'child_process',
    onData(handler) {
      dataHandlers.add(handler);
    },
    onExit(handler) {
      child.on('exit', (code, signal) => {
        handler({ code, signal });
      });
    },
    write(data) {
      if (!child.killed) {
        child.stdin.write(data);
      }
    },
    resize() {
      // The raw child process transport cannot be resized, but callers expect the method.
    },
    kill() {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

async function tryLoadNodePty() {
  try {
    const module = await import('node-pty');
    return module?.default ?? module;
  } catch (error) {
    if (error && error.code !== 'ERR_MODULE_NOT_FOUND') {
      // eslint-disable-next-line no-console
      console.warn('Failed to load optional dependency node-pty. Falling back to child_process:', error);
    }
    return undefined;
  }
}

export async function createTerminal({
  shell = detectDefaultShell(),
  cols = 80,
  rows = 30,
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const nodePty = await tryLoadNodePty();
  if (nodePty) {
    const term = nodePty.spawn(shell, [], {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env,
    });
    return {
      backend: 'node-pty',
      onData(handler) {
        term.onData(handler);
      },
      onExit(handler) {
        term.onExit(({ exitCode, signal }) => handler({ code: exitCode, signal }));
      },
      write(data) {
        term.write(data);
      },
      resize(nextCols, nextRows) {
        term.resize(nextCols, nextRows);
      },
      kill() {
        term.kill();
      },
    };
  }

  return createSpawnTerminal({ shell, cwd, env });
}
