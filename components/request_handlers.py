"""HTTP request handling utilities."""

import logging
import os
from pathlib import Path
from urllib.parse import unquote

logger = logging.getLogger(__name__)


class RequestHandlers:
    """Utilities for handling HTTP requests."""

    def __init__(self, default_markdown_dir: Path):
        """Initialize request handlers.
        
        Args:
            default_markdown_dir: Default directory for markdown files
        """
        self.default_markdown_dir = default_markdown_dir

    def resolve_markdown_path(self, path_param: str = None) -> Path:
        """Resolve the markdown directory path from various sources.
        
        Priority order:
        1. Query parameter: ?path=/some/path
        2. Environment variable: LIVEVIEW_PATH
        3. Default directory from constructor
        
        Args:
            path_param: Optional path from query parameter
        
        Returns:
            Resolved Path object
        """
        target_path = None
        
        if path_param:
            # Handle query parameter
            target_path = Path(unquote(path_param)).expanduser().resolve()
            logger.info(f"Using path from query parameter: {target_path}")
        else:
            # Check environment variable
            env_path = os.environ.get('LIVEVIEW_PATH')
            if env_path:
                target_path = Path(env_path).expanduser().resolve()
                logger.info(f"Using path from environment variable: {target_path}")
            else:
                # Use default
                target_path = self.default_markdown_dir
                logger.info(f"Using default path: {target_path}")
        
        return target_path
