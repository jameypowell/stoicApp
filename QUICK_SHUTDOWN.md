# Quick Shutdown Guide

## Easy Method: Use the Shutdown Script

```bash
./shutdown.sh
```

This will:
- Stop the dev server (nodemon)
- Stop all Docker containers (with confirmation)
- Optionally stop Docker Desktop
- Show a summary of what's still running

---

## Manual Method: Stop Everything Yourself

### 1. Stop Dev Server (nodemon)

**Find and kill the process:**
```bash
# Find nodemon process
pgrep -f "nodemon server.js"

# Kill it (replace PID with actual process ID)
kill <PID>

# Or kill all nodemon processes at once
pkill -f "nodemon server.js"
```

**Or if it's running in your terminal:**
- Press `Ctrl + C` to stop it

---

### 2. Stop Docker Containers

```bash
# List running containers
docker ps

# Stop all running containers
docker stop $(docker ps -q)

# Or stop specific containers by name
docker stop kind_austin elegant_solomon
```

---

### 3. Stop Docker Desktop (Optional)

```bash
# On macOS - quit Docker Desktop
osascript -e 'quit app "Docker"'

# Or use Activity Monitor / Force Quit
```

---

## Quick One-Liner (All at Once)

```bash
# Stop everything in one command
pkill -f "nodemon server.js" && docker stop $(docker ps -q) && echo "✅ Everything stopped!"
```

---

## Verify Everything is Stopped

```bash
# Check for node processes
ps aux | grep -E "nodemon|node.*server.js" | grep -v grep

# Check for Docker containers
docker ps

# Should show no results if everything is stopped
```

---

## What to Keep Running (Optional)

You can leave Docker Desktop running if:
- You have other containers you want to keep
- You'll be using Docker again soon
- It doesn't use much resources when idle

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `./shutdown.sh` | Interactive shutdown script |
| `pkill -f nodemon` | Kill all nodemon processes |
| `docker ps` | List running containers |
| `docker stop $(docker ps -q)` | Stop all containers |
| `docker ps -a` | List all containers (stopped too) |
| `docker rm $(docker ps -aq)` | Remove all stopped containers |















