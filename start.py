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
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("Dependencies installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Failed to install dependencies: {e}")
        return False

def main():
    """Main startup function."""
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    print("🚀 Starting Markdown Live View Server")
    print("=" * 40)
    
    # Check if dependencies are installed
    try:
        import aiohttp
        import watchdog
        print("✅ Dependencies already installed")
    except ImportError:
        print("📦 Installing dependencies...")
        if not install_dependencies():
            print("❌ Failed to install dependencies. Please run: pip install -r requirements.txt")
            return 1
    
    # Start the server
    print("🌐 Starting server...")
    try:
        from server import main as server_main
        server_main()
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
        return 0
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())