#!/bin/bash
# Shutdown script for Stoic Shop development environment

set -e

echo "════════════════════════════════════════════════"
echo "🛑 Shutting Down Development Environment"
echo "════════════════════════════════════════════════"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Stop nodemon/dev server
echo -e "${YELLOW}Step 1: Stopping dev server (nodemon)...${NC}"
NODEMON_PID=$(pgrep -f "nodemon server.js" || true)
if [ -n "$NODEMON_PID" ]; then
    echo "   Found nodemon process (PID: $NODEMON_PID)"
    kill $NODEMON_PID 2>/dev/null || true
    sleep 1
    # Check if it's still running and force kill if needed
    if ps -p $NODEMON_PID > /dev/null 2>&1; then
        echo "   Force killing nodemon..."
        kill -9 $NODEMON_PID 2>/dev/null || true
    fi
    echo -e "   ${GREEN}✅ Dev server stopped${NC}"
else
    echo "   No nodemon process found"
fi
echo ""

# Step 2: Stop all Docker containers
echo -e "${YELLOW}Step 2: Stopping Docker containers...${NC}"
RUNNING_CONTAINERS=$(docker ps -q 2>/dev/null || true)
if [ -n "$RUNNING_CONTAINERS" ]; then
    echo "   Found running containers:"
    docker ps --format "   - {{.Names}} ({{.ID}})"
    echo ""
    read -p "   Stop all Docker containers? (yes/no) [yes]: " STOP_CONTAINERS
    STOP_CONTAINERS=${STOP_CONTAINERS:-yes}
    
    if [ "$STOP_CONTAINERS" = "yes" ]; then
        docker stop $(docker ps -q) 2>/dev/null || true
        echo -e "   ${GREEN}✅ All containers stopped${NC}"
    else
        echo "   Skipping container shutdown"
    fi
else
    echo "   No running containers found"
fi
echo ""

# Step 3: Optionally stop Docker Desktop
echo -e "${YELLOW}Step 3: Docker Desktop...${NC}"
if pgrep -f "Docker.app" > /dev/null; then
    echo "   Docker Desktop is running"
    read -p "   Stop Docker Desktop? (yes/no) [no]: " STOP_DOCKER
    STOP_DOCKER=${STOP_DOCKER:-no}
    
    if [ "$STOP_DOCKER" = "yes" ]; then
        osascript -e 'quit app "Docker"' 2>/dev/null || killall Docker 2>/dev/null || true
        echo -e "   ${GREEN}✅ Docker Desktop stopped${NC}"
    else
        echo "   Docker Desktop left running"
    fi
else
    echo "   Docker Desktop is not running"
fi
echo ""

# Final check
echo -e "${YELLOW}Final check:${NC}"
echo "   Checking for remaining processes..."

REMAINING_NODE=$(pgrep -f "nodemon|node.*server.js" || true)
REMAINING_DOCKER=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ -n "$REMAINING_NODE" ]; then
    echo -e "   ${RED}⚠️  Node processes still running:${NC}"
    ps aux | grep -E "nodemon|node.*server.js" | grep -v grep | awk '{print "      PID", $2, "-", $11, $12, $13}'
else
    echo -e "   ${GREEN}✅ No node processes running${NC}"
fi

if [ "$REMAINING_DOCKER" != "0" ] && [ -n "$(docker ps -q 2>/dev/null)" ]; then
    echo -e "   ${RED}⚠️  Docker containers still running:${NC}"
    docker ps --format "      {{.Names}} ({{.ID}})"
else
    echo -e "   ${GREEN}✅ No Docker containers running${NC}"
fi

echo ""
echo "════════════════════════════════════════════════"
echo -e "${GREEN}✅ Shutdown complete!${NC}"
echo "════════════════════════════════════════════════"
echo ""















