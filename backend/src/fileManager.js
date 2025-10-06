import fs from "fs/promises";
import path from "path";

/**
 * Lightweight helper that mirrors the Python FileManager behaviour.
 * The methods intentionally return plain JSON-friendly objects so that
 * the HTTP routes and websocket handlers can reuse the same data.
 */
export class FileManager {
  constructor() {
    this.allowedExtension = ".md";
  }

  /**
   * Recursively list markdown files and collect metadata for each file.
   */
  async buildMarkdownIndex(rootPath) {
    const root = path.resolve(rootPath);
    const tree = await this.#buildDirectoryTree(root, root);
    const files = [];

    const collect = (nodes) => {
      for (const node of nodes) {
        if (node.type === "file") {
          files.push({
            name: node.name,
            relativePath: node.relativePath,
            size: node.size,
            updated: node.updated,
          });
        } else if (node.type === "directory" && Array.isArray(node.children)) {
          collect(node.children);
        }
      }
    };

    collect(tree);
    return { tree, files };
  }

  async listMarkdownFiles(rootPath) {
    const index = await this.buildMarkdownIndex(rootPath);
    return index.files;
  }

  async readMarkdown(rootPath, relativePath) {
    const absolute = await this.#resolveRelative(rootPath, relativePath);
    const data = await fs.readFile(absolute, "utf8");
    return data;
  }

  async writeMarkdown(rootPath, relativePath, content) {
    const absolute = await this.#resolveRelative(rootPath, relativePath);
    if (!absolute.endsWith(this.allowedExtension)) {
      throw new Error("Only markdown files can be edited through this endpoint");
    }
    await fs.access(absolute);
    await fs.writeFile(absolute, String(content), "utf8");
  }

  async deleteMarkdown(rootPath, relativePath) {
    const absolute = await this.#resolveRelative(rootPath, relativePath);
    await fs.unlink(absolute);
  }

  fallbackMarkdown(rootPath) {
    return [
      "# No markdown files found",
      "",
      `The directory \`${path.resolve(rootPath)}\` does not contain any markdown files yet.`,
    ].join("\n");
  }

  async #buildDirectoryTree(root, current) {
    const nodes = [];
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      return nodes;
    }

    const sorted = entries
      .filter((entry) => !(entry.isDirectory() && entry.name.startsWith(".")))
      .sort((a, b) => {
        const aKey = `${a.isFile()}-${a.name.toLowerCase()}`;
        const bKey = `${b.isFile()}-${b.name.toLowerCase()}`;
        return aKey.localeCompare(bKey);
      });

    for (const entry of sorted) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");

      if (entry.isDirectory()) {
        const children = await this.#buildDirectoryTree(root, absolute);
        if (children.length === 0) {
          continue;
        }
        nodes.push({
          type: "directory",
          name: entry.name,
          relativePath: relative,
          children,
        });
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== this.allowedExtension) {
        continue;
      }

      try {
        const stat = await fs.stat(absolute);
        nodes.push({
          type: "file",
          name: entry.name,
          relativePath: relative,
          size: stat.size,
          updated: stat.mtimeMs / 1000,
        });
      } catch (error) {
        // Ignore files that disappear while we are collecting metadata.
      }
    }

    return nodes;
  }

  async #resolveRelative(rootPath, relativePath) {
    const root = path.resolve(rootPath);
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Attempted to access a file outside the root directory");
    }
    return candidate;
  }
}
