# Publishing to PyPI

This document describes how to publish Asynkron.LiveView to PyPI so users can install it with `pip install asynkron-liveview`.

## Prerequisites

1. Create an account on [PyPI](https://pypi.org/) and [TestPyPI](https://test.pypi.org/)
2. Install build tools:
   ```bash
   pip install build twine
   ```

## Building the Package

1. Update the version in `pyproject.toml` if needed
2. Build the distribution packages:
   ```bash
   python -m build
   ```
   This creates both a source distribution (`.tar.gz`) and a wheel (`.whl`) in the `dist/` directory.

## Testing on TestPyPI (Recommended)

Before publishing to the main PyPI, test on TestPyPI:

1. Upload to TestPyPI:
   ```bash
   python -m twine upload --repository testpypi dist/*
   ```

2. Test installation from TestPyPI:
   ```bash
   pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple asynkron-liveview
   ```

3. Verify the package works:
   ```bash
   liveview --help
   ```

## Publishing to PyPI

Once testing is complete:

1. Upload to PyPI:
   ```bash
   python -m twine upload dist/*
   ```

2. Verify installation:
   ```bash
   pip install asynkron-liveview
   ```

## Automated Publishing with GitHub Actions

Consider setting up GitHub Actions to automate publishing when creating a new release:

```yaml
name: Publish to PyPI

on:
  release:
    types: [published]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.x'
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install build twine
      - name: Build package
        run: python -m build
      - name: Publish to PyPI
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_API_TOKEN }}
        run: python -m twine upload dist/*
```

## Version Bumping

Update the version in `pyproject.toml` following [Semantic Versioning](https://semver.org/):
- MAJOR version for incompatible API changes
- MINOR version for new functionality in a backwards compatible manner
- PATCH version for backwards compatible bug fixes

Example:
```toml
version = "0.2.0"  # Update this line
```
