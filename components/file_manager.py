"""File management operations for markdown files."""

import logging
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class FileManager:
    """Handles file system operations for markdown files."""

    def __init__(self, markdown_dir: Path, sticky_files_ref: Optional[Dict[str, str]] = None):
        """Initialize the file manager.
        
        Args:
            markdown_dir: Path to the directory containing markdown files
            sticky_files_ref: Optional reference to sticky files dict (maps directory -> filename)
        """
        self.markdown_dir = markdown_dir
        self.markdown_dir.mkdir(exist_ok=True)
        self.sticky_files_ref = sticky_files_ref if sticky_files_ref is not None else {}

    def generate_file_id(self) -> str:
        """Generate a unique File Id for newly created content."""
        for _ in range(10):
            candidate = f"{secrets.token_hex(4)}.md"
            if not (self.markdown_dir / candidate).exists():
                return candidate
        raise RuntimeError("Unable to allocate a unique File Id")

    def sanitize_file_id(self, file_id: str) -> str:
        """Ensure the provided File Id maps to a safe filename."""
        sanitized = Path(file_id).name
        if not sanitized.endswith('.md'):
            sanitized += '.md'
        return sanitized

    def get_markdown_files(self, custom_path: Path = None) -> List[Dict[str, Any]]:
        """Get list of markdown files with metadata.
        
        Args:
            custom_path: Optional custom directory path. If None, uses default markdown_dir.
        
        Returns:
            List of dictionaries containing file information
        """
        target_path = custom_path if custom_path else self.markdown_dir
        
        try:
            md_files = sorted(
                target_path.glob('*.md'),
                key=lambda p: p.stat().st_mtime,
                reverse=True
            )
            
            files = []
            for file_path in md_files:
                try:
                    stat = file_path.stat()
                    created_time = stat.st_ctime
                    modified_time = stat.st_mtime
                    
                    files.append({
                        'name': file_path.name,
                        'path': file_path,
                        'created': created_time,
                        'updated': modified_time,
                        'size': stat.st_size
                    })
                except Exception as e:
                    logger.warning(f"Error reading file stats for {file_path}: {e}")
                    continue
            
            # Move sticky file to the top if one exists for this directory
            sticky_filename = self.sticky_files_ref.get(str(target_path))
            if sticky_filename and files:
                sticky_index = None
                for i, file_info in enumerate(files):
                    if file_info['name'] == sticky_filename:
                        sticky_index = i
                        break
                
                if sticky_index is not None and sticky_index > 0:
                    # Move sticky file to the beginning
                    sticky_file = files.pop(sticky_index)
                    files.insert(0, sticky_file)
            
            return files
            
        except Exception as e:
            logger.error(f"Error listing markdown files: {e}")
            return []

    def get_markdown_content_parts(self, custom_path: Path = None) -> List[str]:
        """Return markdown for each file as an ordered list.

        Args:
            custom_path: Optional custom directory path. If None, uses default markdown_dir.

        Returns:
            List of markdown strings in the same order as ``get_markdown_files``.
        """
        target_path = custom_path if custom_path else self.markdown_dir
        files = self.get_markdown_files(custom_path)

        if not files:
            # Ensure the UI still receives a single blob of markdown when the
            # directory is empty so it can render the fallback message.
            return [self.get_fallback_content(target_path)]

        content_parts: List[str] = []
        for file_info in files:
            try:
                file_content = file_info['path'].read_text(encoding='utf-8')
                content_parts.append(file_content)
            except Exception as e:
                logger.error(f"Error reading file {file_info['name']}: {e}")
                content_parts.append(f"# Error\n\nCould not read file: {file_info['name']}")

        return content_parts

    def get_unified_markdown(self, custom_path: Path = None) -> str:
        """Get unified markdown content from all files.

        Args:
            custom_path: Optional custom directory path. If None, uses default markdown_dir.

        Returns:
            Combined markdown content from all files
        """
        parts = self.get_markdown_content_parts(custom_path)
        return '\n\n---\n\n'.join(parts)

    def get_fallback_content(self, requested_path: Path) -> str:
        """Generate fallback content when directory is empty or inaccessible.
        
        Args:
            requested_path: The path that was requested
        
        Returns:
            Markdown formatted fallback message
        """
        return f"""# Directory Not Found or Empty

The directory `{requested_path}` is empty or no markdown files were found.

## Getting Started

Create markdown files in this directory to see them rendered here in real-time.

### Example

Create a file named `example.md` with some content to get started.
"""
