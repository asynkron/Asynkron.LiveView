# Installation Guide

This document provides detailed installation instructions for Asynkron.LiveView.

## Quick Install (Recommended)

Install directly from GitHub using pip:

```bash
pip install git+https://github.com/asynkron/Asynkron.LiveView.git
```

Then run:

```bash
liveview
```

This will start the server at `http://localhost:8080` watching the `markdown` directory in your current location.

### Custom Options

```bash
# Specify a custom directory
liveview --path /path/to/your/markdown/files

# Use a different port
liveview --port 3000

# Both options together
liveview --path ~/documents/notes --port 3000
```

## Installation Methods

### Method 1: pip install from GitHub (Easiest)

```bash
pip install git+https://github.com/asynkron/Asynkron.LiveView.git
```

**Pros:**
- ✅ Single command installation
- ✅ Installs `liveview` command globally
- ✅ Automatic dependency management
- ✅ Easy to update: just run the command again

**Cons:**
- ⚠️ Requires git to be installed
- ⚠️ Downloads from GitHub each time

### Method 2: Using run.sh Script

```bash
./run.sh
```

**Pros:**
- ✅ Creates isolated virtual environment
- ✅ Installs all dependencies automatically
- ✅ Starts server immediately

**Cons:**
- ⚠️ Requires cloning the repository first
- ⚠️ Creates `venv` directory in the project

### Method 3: Manual Installation (For Development)

```bash
# Clone the repository
git clone https://github.com/asynkron/Asynkron.LiveView.git
cd Asynkron.LiveView

# Install dependencies
pip install -r requirements.txt

# Run the server
python server.py --path /path/to/markdown
```

**Pros:**
- ✅ Full control over the installation
- ✅ Easy to modify and test changes
- ✅ Can run tests and contribute

**Cons:**
- ⚠️ Requires manual dependency management
- ⚠️ Multiple steps

### Method 4: Editable Install (For Development)

```bash
# Clone the repository
git clone https://github.com/asynkron/Asynkron.LiveView.git
cd Asynkron.LiveView

# Install in editable mode
pip install -e .

# Now you can use the liveview command
liveview
```

**Pros:**
- ✅ Installs `liveview` command
- ✅ Changes to source code take effect immediately
- ✅ Perfect for development and testing

**Cons:**
- ⚠️ Requires cloning the repository

## System Requirements

- **Python**: 3.7 or higher
- **Operating System**: Linux, macOS, or Windows
- **Dependencies**:
  - aiohttp >= 3.9.0
  - watchdog >= 3.0.0

## Frontend Assets

The frontend JavaScript bundle is pre-built and included in the package. You only need to rebuild it if you're modifying the frontend code:

```bash
cd frontend
npm install
npm run build
```

## Verifying Installation

After installation, verify everything works:

```bash
# Check the command is available
liveview --help

# Test with a sample directory
mkdir -p /tmp/test_markdown
echo "# Hello World" > /tmp/test_markdown/test.md
liveview --path /tmp/test_markdown
```

Then open your browser to `http://localhost:8080`.

## Updating

### From pip install:
```bash
pip install --upgrade git+https://github.com/asynkron/Asynkron.LiveView.git
```

### From git clone:
```bash
cd Asynkron.LiveView
git pull
pip install -e . --upgrade
```

## Uninstalling

```bash
pip uninstall asynkron-liveview
```

## Troubleshooting

### "liveview: command not found"

The installation directory may not be in your PATH. Try:
```bash
python -m pip show asynkron-liveview
```

Then add the `bin` directory to your PATH, or use:
```bash
python -m server --path /path/to/markdown
```

### "No module named 'aiohttp'"

Dependencies weren't installed. Install them manually:
```bash
pip install aiohttp watchdog
```

### "Templates not found"

This usually happens with development installations. Make sure you're running from the project directory or use `pip install -e .` to install in editable mode.

## Getting Help

- **Issues**: https://github.com/asynkron/Asynkron.LiveView/issues
- **Documentation**: See README.md in the repository
