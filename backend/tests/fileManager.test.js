import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { FileManager } from '../src/fileManager.js';

let tempDir;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'liveview-node-fm-'));
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe('FileManager', () => {
  it('collects markdown metadata recursively', async () => {
    const docsDir = path.join(tempDir, 'docs', 'notes');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'index.md'), '# Welcome', 'utf8');
    await fs.writeFile(path.join(docsDir, 'todo.md'), '- [ ] Tests', 'utf8');
    await fs.writeFile(path.join(tempDir, '.draft.md'), 'Hidden', 'utf8');
    await fs.mkdir(path.join(tempDir, '.git'));
    await fs.writeFile(path.join(tempDir, '.git', 'ignored.md'), 'Should stay hidden', 'utf8');

    const manager = new FileManager();
    const index = await manager.buildMarkdownIndex(tempDir);
    const relativePaths = index.files.map((file) => file.relativePath).sort();

    expect(relativePaths).toEqual(['.draft.md', 'docs/notes/todo.md', 'index.md']);
    const directoryNode = index.tree.find((node) => node.relativePath === 'docs');
    expect(directoryNode?.children?.length).toBe(1);
  });

  it('rejects attempts to escape the root directory', async () => {
    const manager = new FileManager();
    await expect(manager.readMarkdown(tempDir, '../outside.md')).rejects.toThrow(/outside the root directory/);
  });

  it('enforces markdown extensions during writes', async () => {
    const manager = new FileManager();
    const textPath = path.join(tempDir, 'notes.txt');
    await fs.writeFile(textPath, 'plain text', 'utf8');

    await expect(manager.writeMarkdown(tempDir, 'notes.txt', 'data')).rejects.toThrow(/Only markdown files/);
  });
});
