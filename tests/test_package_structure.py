"""Test package structure for pip installation."""
import sys
from pathlib import Path


def test_server_module_is_importable():
    """Verify server module can be imported."""
    import server
    assert hasattr(server, 'main')
    assert hasattr(server, 'UnifiedMarkdownServer')


def test_components_package_is_importable():
    """Verify components package can be imported."""
    from components import FileManager
    assert FileManager is not None


def test_templates_directory_exists():
    """Verify templates directory exists in the package."""
    import server
    server_path = Path(server.__file__).parent
    templates_path = server_path / "templates"
    assert templates_path.exists(), f"Templates directory not found at {templates_path}"
    assert templates_path.is_dir(), "Templates path is not a directory"


def test_template_files_exist():
    """Verify required template files exist."""
    import server
    server_path = Path(server.__file__).parent
    templates_path = server_path / "templates"
    
    # Check HTML templates
    assert (templates_path / "unified_index.html").exists(), "unified_index.html not found"
    assert (templates_path / "print_view.html").exists(), "print_view.html not found"


def test_static_assets_exist():
    """Verify static assets directory exists."""
    import server
    server_path = Path(server.__file__).parent
    static_dist_path = server_path / "templates" / "static" / "dist"
    
    assert static_dist_path.exists(), f"Static dist directory not found at {static_dist_path}"
    assert (static_dist_path / "unified_index.js").exists(), "unified_index.js not found"
    assert (static_dist_path / "app.css").exists(), "app.css not found"


def test_entry_point_exists():
    """Verify the liveview entry point is configured."""
    # This test checks if the entry point would be created
    # We can't directly test the installed command without installing the package
    import server
    assert hasattr(server, 'main'), "server.main function not found"
    assert callable(server.main), "server.main is not callable"
