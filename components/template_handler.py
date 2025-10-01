"""Template handling for HTML rendering."""

import logging
from html import escape
from pathlib import Path

logger = logging.getLogger(__name__)


class TemplateHandler:
    """Handles loading and rendering of HTML templates."""

    def __init__(self, template_path: Path):
        """Initialize the template handler.
        
        Args:
            template_path: Path to the HTML template file
        """
        self.template_path = template_path

    def load_template(self) -> str:
        """Load template from disk.
        
        Returns:
            Template content as string
        
        Raises:
            FileNotFoundError: If template file is not found
            Exception: For other read errors
        """
        try:
            return self.template_path.read_text(encoding='utf-8')
        except FileNotFoundError:
            logger.error(f"Template file not found: {self.template_path}")
            raise
        except Exception as exc:
            logger.error(f"Error reading template {self.template_path}: {exc}")
            raise

    def render_template(self, target_path: Path) -> str:
        """Populate the template with runtime values.
        
        Args:
            target_path: The current directory path to display
        
        Returns:
            Rendered HTML with placeholders replaced
        """
        template = self.load_template()
        safe_path = escape(str(target_path))
        return template.replace("__CURRENT_DIRECTORY__", safe_path)
