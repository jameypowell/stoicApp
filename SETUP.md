# Quick Start Script

This script helps automate the initial setup process.

## Usage

```bash
chmod +x setup.sh
./setup.sh
```

Or run commands manually:

```bash
# Install dependencies
npm install

# Build Docker image
docker build -t stoic-shop .

# Test locally
docker run -p 3000:3000 stoic-shop
```

