import tempfile
from pathlib import Path
import sys

# Ensure imports resolve to the repository modules.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from components.file_manager import FileManager


def test_hidden_directories_are_filtered():
    """Verify that hidden directories (starting with .) are excluded from file listing."""
    
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        
        # Create regular directories and files
        (root / "docs").mkdir()
        (root / "docs" / "readme.md").write_text("# Regular Doc")
        (root / "src").mkdir()
        (root / "src" / "main.md").write_text("# Main")
        
        # Create hidden directories that should be filtered out
        (root / ".git").mkdir()
        (root / ".git" / "config.md").write_text("# Git Config")
        (root / ".github").mkdir()
        (root / ".github" / "workflows").mkdir() 
        (root / ".github" / "workflows" / "ci.md").write_text("# CI Workflow")
        (root / ".vscode").mkdir()
        (root / ".vscode" / "settings.md").write_text("# VSCode Settings")
        
        # Create root level markdown file
        (root / "README.md").write_text("# Root README")
        
        file_manager = FileManager()
        index = file_manager.build_markdown_index(root)
        
        # Check that only non-hidden files are included
        file_paths = [f['relativePath'] for f in index['files']]
        
        # Should include regular files
        assert "README.md" in file_paths
        assert "docs/readme.md" in file_paths  
        assert "src/main.md" in file_paths
        
        # Should NOT include files from hidden directories
        assert ".git/config.md" not in file_paths
        assert ".github/workflows/ci.md" not in file_paths
        assert ".vscode/settings.md" not in file_paths
        
        # Check tree structure - should not include hidden directories
        def find_directory_names(nodes):
            names = []
            for node in nodes:
                if node.get("type") == "directory":
                    names.append(node["name"])
                    names.extend(find_directory_names(node.get("children", [])))
            return names
        
        dir_names = find_directory_names(index['tree'])
        
        # Should include regular directories
        assert "docs" in dir_names
        assert "src" in dir_names
        
        # Should NOT include hidden directories  
        assert ".git" not in dir_names
        assert ".github" not in dir_names
        assert ".vscode" not in dir_names
        assert "workflows" not in dir_names  # This is inside .github


if __name__ == "__main__":
    test_hidden_directories_are_filtered()
    print("✅ Hidden directory filtering test passed!")