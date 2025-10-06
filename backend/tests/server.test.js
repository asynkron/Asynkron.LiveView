import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { UnifiedMarkdownServer } from '../src/server.js';

let tempDir;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'liveview-node-srv-'));
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
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
});
