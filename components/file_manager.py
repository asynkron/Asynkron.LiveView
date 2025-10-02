"""Helpers for working with markdown files on disk."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class FileManager:
    """Lightweight wrapper around the filesystem for markdown operations."""

    def list_markdown_files(self, root: Path) -> List[Dict[str, Any]]:
        """Return metadata for every markdown file under ``root``.

        Historically the UI only presented the top-level files.  The recursive
        tree view introduced for the sidebar still needs a flat collection for
        tasks such as determining the "first" document.  To keep that logic
        simple we maintain this helper as a thin wrapper around the richer index
        builder.
        """

        return self.build_markdown_index(root)["files"]

    def build_markdown_index(self, root: Path) -> Dict[str, Any]:
        """Return both a recursive tree and a flat list for ``root``.

        The tree keeps directories so the frontend can render an expandable
        browser, while the flat list retains the existing API contract for
        callers that only care about files.  Both structures share the same
        metadata to avoid inconsistencies.
        """

        tree = self._build_directory_tree(root, root)
        files: List[Dict[str, Any]] = []

        def collect(nodes: List[Dict[str, Any]]) -> None:
            for node in nodes:
                if node.get("type") == "file":
                    files.append(
                        {
                            "name": node["name"],
                            "relativePath": node["relativePath"],
                            "size": node["size"],
                            "updated": node["updated"],
                        }
                    )
                elif node.get("type") == "directory":
                    collect(node.get("children", []))

        collect(tree)
        return {"tree": tree, "files": files}

    def _build_directory_tree(self, root: Path, current: Path) -> List[Dict[str, Any]]:
        """Recursively build a directory tree rooted at ``current``."""

        nodes: List[Dict[str, Any]] = []
        if not current.exists():
            return nodes

        try:
            entries = sorted(
                current.iterdir(),
                key=lambda entry: (entry.is_file(), entry.name.lower()),
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Failed to list directory %s: %s", current, exc)
            return nodes

        for entry in entries:
            relative = entry.relative_to(root).as_posix()
            if entry.is_dir():
                children = self._build_directory_tree(root, entry)
                if not children:
                    # Skip directories that do not contain markdown files so we
                    # avoid showing empty containers in the UI.
                    continue
                nodes.append(
                    {
                        "type": "directory",
                        "name": entry.name,
                        "relativePath": relative,
                        "children": children,
                    }
                )
                continue

            if entry.suffix.lower() != ".md" or not entry.is_file():
                continue

            try:
                stat = entry.stat()
            except FileNotFoundError:
                # The file may disappear between ``iterdir`` and ``stat`` when
                # tests manipulate the directory quickly.  Skip those cases
                # silently because the watcher will produce a fresh snapshot on
                # the next tick.
                continue

            nodes.append(
                {
                    "type": "file",
                    "name": entry.name,
                    "relativePath": relative,
                    "size": stat.st_size,
                    "updated": stat.st_mtime,
                }
            )

        return nodes

    def read_markdown(self, root: Path, relative_path: str) -> str:
        """Return the markdown contents for ``relative_path`` under ``root``."""

        file_path = self._resolve_relative(root, relative_path)
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError(relative_path)

        return file_path.read_text(encoding="utf-8")

    def write_markdown(self, root: Path, relative_path: str, content: str) -> None:
        """Persist ``content`` to the markdown file located at ``relative_path``."""

        file_path = self._resolve_relative(root, relative_path)
        if file_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files can be edited through this endpoint")

        if not file_path.exists():
            raise FileNotFoundError(relative_path)

        file_path.write_text(content, encoding="utf-8")

    def delete_markdown(self, root: Path, relative_path: str) -> None:
        """Remove a markdown file from disk if it exists."""

        file_path = self._resolve_relative(root, relative_path)
        if not file_path.exists():
            raise FileNotFoundError(relative_path)

        file_path.unlink()

    @staticmethod
    def fallback_markdown(root: Path) -> str:
        """Return a user friendly fallback message when a directory is empty."""

        return (
            "# No markdown files found\n\n"
            f"The directory `{root}` does not contain any markdown files yet."
        )

    @staticmethod
    def _resolve_relative(root: Path, relative_path: str) -> Path:
        """Resolve ``relative_path`` relative to ``root`` with safety checks."""

        candidate = (root / relative_path).expanduser().resolve()
        try:
            candidate.relative_to(root.resolve())
        except ValueError:
            raise ValueError("Attempted to access a file outside the root directory")
        return candidate
