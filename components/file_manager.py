"""Helpers for working with markdown files on disk."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class FileManager:
    """Lightweight wrapper around the filesystem for markdown operations."""

    def list_markdown_files(self, root: Path) -> List[Dict[str, Any]]:
        """Return metadata for every ``*.md`` file directly under ``root``.

        The UI currently only needs the file name, its relative location and a
        couple of timestamps for display purposes.  We therefore expose just the
        pieces that the frontend consumes instead of mirroring the full
        :class:`os.stat_result`.
        """

        files: List[Dict[str, Any]] = []
        if not root.exists():
            return files

        try:
            for entry in sorted(root.glob("*.md")):
                try:
                    stat = entry.stat()
                except FileNotFoundError:
                    # The file may disappear between ``glob`` and ``stat`` when
                    # tests manipulate the directory quickly.  Skip those cases
                    # silently because the watcher will produce a fresh snapshot
                    # on the next tick.
                    continue

                files.append(
                    {
                        "name": entry.name,
                        "relativePath": entry.name,
                        "size": stat.st_size,
                        "updated": stat.st_mtime,
                    }
                )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Failed to list markdown files in %s: %s", root, exc)

        return files

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
