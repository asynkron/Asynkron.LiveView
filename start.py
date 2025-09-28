#!/usr/bin/env python3
"""
Simple startup script for the Markdown Live View server.
"""

import sys
import subprocess
import os
from pathlib import Path

def install_dependencies():
    """Install required dependencies."""
    print("Installing dependencies...")
    try:
        # First try normal installation
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("Dependencies installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        # If it fails, try with --user flag for externally-managed environments
        print("Standard installation failed, trying user installation...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "-r", "requirements.txt"])
            print("Dependencies installed successfully in user directory!")
            return True
        except subprocess.CalledProcessError as e2:
            print(f"Failed to install dependencies: {e2}")
            print("\n💡 Installation failed. You may need to:")
            print("   1. Use a virtual environment: python3 -m venv venv && source venv/bin/activate")
            print("   2. Or install system-wide: pip install --break-system-packages -r requirements.txt")
            print("   3. Or use pipx if available: pipx install aiohttp watchdog")
            return False

def main():
    """Main startup function."""
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    # Ensure current directory is in Python path for imports
    if str(script_dir) not in sys.path:
        sys.path.insert(0, str(script_dir))
    
    print("🚀 Starting Unified Markdown Live View Server with MCP Integration")
    print("=" * 40)
    
    # Check if dependencies are installed
    try:
        import aiohttp
        import watchdog
        import mcp
        print("✅ Dependencies already installed")
    except ImportError:
        print("📦 Installing dependencies...")
        if not install_dependencies():
            print("❌ Failed to install dependencies. Please run: pip install -r requirements.txt")
            return 1
    
    # Start the unified server
    print("🌐 Starting unified server...")
    try:
        from unified_server import main as unified_main
        unified_main()
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
        return 0
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())