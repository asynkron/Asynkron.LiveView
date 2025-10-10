import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import request from 'supertest';
import WebSocket from 'ws';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const bindingRecords = [];

vi.mock('@asynkron/openagent', () => {
  return {
    createWebSocketBinding: vi.fn(({ socket, formatOutgoing, autoStart = true, runtimeOptions }) => {
      if (!socket) {
        throw new Error('Socket instance is required');
      }

      const record = {
        socket,
        formatOutgoing,
        runtimeOptions,
      };
      bindingRecords.push(record);

      let binding;

      const formatEvent = (event) => {
        if (typeof formatOutgoing === 'function') {
          return formatOutgoing(event);
        }
        return JSON.stringify(event ?? {});
      };

      const handleMessage = (raw) => {
        let value = raw;
        if (Buffer.isBuffer(raw)) {
          value = raw.toString('utf8');
        }
        if (typeof value === 'string') {
          let parsed;
          try {
            parsed = JSON.parse(value);
          } catch {
            parsed = value;
          }

          if (parsed && typeof parsed === 'object' && typeof parsed.prompt === 'string') {
            binding.runtime.submitPrompt(parsed.prompt);
          } else if (typeof parsed === 'string') {
            binding.runtime.submitPrompt(parsed);
          }
        }
      };

      binding = {
        runtime: {
          submitPrompt: vi.fn((prompt) => {
            const payload = formatEvent({ type: 'assistant-message', message: `Echo: ${prompt}` });
            if (typeof payload !== 'undefined' && socket.readyState === WebSocket.OPEN) {
              socket.send(payload);
            }
          }),
          cancel: vi.fn(),
        },
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {
          socket.off?.('message', handleMessage);
        }),
      };

      socket.on('message', handleMessage);

      if (autoStart !== false) {
        void binding.start();
      }

      record.binding = binding;
      return binding;
    }),
  };
});

const openAgentModule = await import('@asynkron/openagent');
const { UnifiedMarkdownServer } = await import('../src/server.js');

let tempDir;

beforeEach(async () => {
  bindingRecords.length = 0;
  openAgentModule.createWebSocketBinding.mockClear();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'liveview-node-srv-'));
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  bindingRecords.length = 0;
  vi.clearAllMocks();
});

describe('UnifiedMarkdownServer', () => {
  it('serves file listings and markdown content', async () => {
    const filePath = path.join(tempDir, 'welcome.md');
    await fs.writeFile(filePath, '# Hello', 'utf8');

    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    const listResponse = await request(app).get('/api/files').query({ path: tempDir }).expect(200);
    expect(listResponse.body.files).toHaveLength(1);
    expect(listResponse.body.files[0].relativePath).toBe('welcome.md');

    const fileResponse = await request(app).get('/api/file').query({ path: tempDir, file: 'welcome.md' }).expect(200);
    expect(fileResponse.body.content).toBe('# Hello');
  });

  it('updates markdown files through the API', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'initial', 'utf8');

    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    await request(app).put('/api/file').query({ path: tempDir, file: 'note.md' }).send({ content: 'refreshed' }).expect(200);

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toBe('refreshed');
  });

  it('returns a friendly fallback for empty directories', async () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    const response = await request(app).get('/').query({ path: tempDir }).expect(200);
    expect(response.text).toContain('No markdown files found');
  });

  it('expands home directories when resolving roots', () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) {
      return;
    }

    const { root } = server.resolveRoot('~/Documents');
    expect(root.startsWith(home)).toBe(true);
  });

  it('decodes encoded path arguments', () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const encoded = encodeURIComponent(tempDir);
    const { root } = server.resolveRoot(encoded);
    expect(root).toBe(path.resolve(tempDir));
  });

  it('serves raw markdown downloads with helpful headers', async () => {
    const filePath = path.join(tempDir, 'download.md');
    await fs.writeFile(filePath, 'download me', 'utf8');

    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    const response = await request(app).get('/api/file/raw').query({ path: tempDir, file: 'download.md' }).expect(200);

    expect(response.headers['content-type']).toMatch(/text\/markdown/);
    expect(response.headers['content-disposition']).toContain('download.md');
    expect(response.text).toBe('download me');
  });

  it('rejects markdown updates without content', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'initial', 'utf8');

    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    const response = await request(app).put('/api/file').query({ path: tempDir, file: 'note.md' }).expect(400);

    expect(response.body.error).toMatch(/Missing content/);
  });

  it('surfaces 404s when files are missing', async () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    const response = await request(app).get('/api/file').query({ path: tempDir, file: 'ghost.md' }).expect(404);

    expect(response.body.error).toBeDefined();
  });

  it('emits filesystem events after delete requests', async () => {
    const filePath = path.join(tempDir, 'removable.md');
    await fs.writeFile(filePath, 'remove me', 'utf8');

    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();
    const eventSpy = vi.spyOn(server, 'handleFilesystemEvent').mockResolvedValue();

    await request(app).delete('/api/file').query({ path: tempDir, file: 'removable.md' }).expect(200);

    expect(eventSpy).toHaveBeenCalledWith(path.resolve(tempDir), 'deleted', 'removable.md');
  });

  it('enables agent command auto-approval when configured', async () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir, port: 0, agent: { autoApprove: true } });
    await server.start();

    const address = server.server.address();
    const port = typeof address === 'object' && address?.port ? address.port : server.port;
    const url = `ws://127.0.0.1:${port}/ws/agent`;

    const client = new WebSocket(url);

    try {
      await new Promise((resolve, reject) => {
        client.on('open', resolve);
        client.on('error', reject);
      });

      expect(openAgentModule.createWebSocketBinding).toHaveBeenCalledTimes(1);
      const [record] = bindingRecords;
      expect(record?.runtimeOptions).toBeDefined();
      expect(typeof record?.runtimeOptions?.getAutoApproveFlag).toBe('function');
      expect(record?.runtimeOptions?.getAutoApproveFlag()).toBe(true);
      expect(record?.runtimeOptions?.emitAutoApproveStatus).toBe(true);
    } finally {
      await new Promise((resolve) => {
        client.once('close', resolve);
        client.close(1000);
      });

      await server.stop();
    }
  });

  it('bridges websocket traffic to the agent runtime binding', async () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir, port: 0 });
    await server.start();

    const address = server.server.address();
    const port = typeof address === 'object' && address?.port ? address.port : server.port;
    const url = `ws://127.0.0.1:${port}/ws/agent`;

    const client = new WebSocket(url);

    try {
      await new Promise((resolve, reject) => {
        client.on('open', resolve);
        client.on('error', reject);
      });

      const messagePromise = new Promise((resolve, reject) => {
        client.once('message', (data) => resolve(data.toString()));
        client.once('error', reject);
      });

      client.send(JSON.stringify({ type: 'prompt', prompt: 'Hello runtime' }));

      const raw = await messagePromise;
      const payload = JSON.parse(raw);
      expect(payload.type).toBe('agent_message');
      expect(payload.text).toBe('Echo: Hello runtime');

      expect(openAgentModule.createWebSocketBinding).toHaveBeenCalledTimes(1);
      const [record] = bindingRecords;
      expect(record?.binding.start).toHaveBeenCalledTimes(1);
      expect(record?.binding.runtime.submitPrompt).toHaveBeenCalledWith('Hello runtime');
    } finally {
      await new Promise((resolve) => {
        client.once('close', resolve);
        client.close(1000);
      });

      await server.stop();
      const [record] = bindingRecords;
      if (record) {
        expect(record.binding.stop).toHaveBeenCalled();
      }
    }
  });

  it('translates chat feed payloads into runtime prompts', async () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir, port: 0 });
    await server.start();

    const address = server.server.address();
    const port = typeof address === 'object' && address?.port ? address.port : server.port;
    const url = `ws://127.0.0.1:${port}/ws/agent`;

    const client = new WebSocket(url);

    try {
      await new Promise((resolve, reject) => {
        client.on('open', resolve);
        client.on('error', reject);
      });

      const messagePromise = new Promise((resolve, reject) => {
        client.once('message', (data) => resolve(data.toString()));
        client.once('error', reject);
      });

      client.send(JSON.stringify({ type: 'chat', text: 'Hello via chat feed' }));

      const raw = await messagePromise;
      const payload = JSON.parse(raw);
      expect(payload.type).toBe('agent_message');
      expect(payload.text).toBe('Echo: Hello via chat feed');

      expect(openAgentModule.createWebSocketBinding).toHaveBeenCalledTimes(1);
      const [record] = bindingRecords;
      expect(record?.binding.runtime.submitPrompt).toHaveBeenCalledWith('Hello via chat feed');
    } finally {
      await new Promise((resolve) => {
        client.once('close', resolve);
        client.close(1000);
      });

      await server.stop();
      const [record] = bindingRecords;
      if (record) {
        expect(record.binding.stop).toHaveBeenCalled();
      }
    }
  });
});
