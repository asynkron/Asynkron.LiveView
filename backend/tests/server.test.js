import fs from "fs/promises";
import os from "os";
import path from "path";

import request from "supertest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { UnifiedMarkdownServer } from "../src/server.js";

let tempDir;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "liveview-node-srv-"));
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe("UnifiedMarkdownServer", () => {
  it("serves file listings and markdown content", async () => {
    const filePath = path.join(tempDir, "welcome.md");
    await fs.writeFile(filePath, "# Hello", "utf8");

    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    const listResponse = await request(app).get("/api/files").query({ path: tempDir }).expect(200);
    expect(listResponse.body.files).toHaveLength(1);
    expect(listResponse.body.files[0].relativePath).toBe("welcome.md");

    const fileResponse = await request(app)
      .get("/api/file")
      .query({ path: tempDir, file: "welcome.md" })
      .expect(200);
    expect(fileResponse.body.content).toBe("# Hello");
  });

  it("updates markdown files through the API", async () => {
    const filePath = path.join(tempDir, "note.md");
    await fs.writeFile(filePath, "initial", "utf8");

    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    await request(app)
      .put("/api/file")
      .query({ path: tempDir, file: "note.md" })
      .send({ content: "refreshed" })
      .expect(200);

    const updated = await fs.readFile(filePath, "utf8");
    expect(updated).toBe("refreshed");
  });

  it("returns a friendly fallback for empty directories", async () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const app = server.createApp();

    const response = await request(app).get("/").query({ path: tempDir }).expect(200);
    expect(response.text).toContain("No markdown files found");
  });

  it("expands home directories when resolving roots", () => {
    const server = new UnifiedMarkdownServer({ markdownDir: tempDir });
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) {
      return;
    }

    const { root } = server.resolveRoot("~/Documents");
    expect(root.startsWith(home)).toBe(true);
  });
});
