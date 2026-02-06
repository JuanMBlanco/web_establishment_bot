#!/bin/bash

# =============================================================================
# Configuration
# =============================================================================
APP_NAME="ezcater_web_establishment_bot"  # Change this for different projects
RUN_BUILD=true          # Set to false to skip build step

# =============================================================================
# Script Start
# =============================================================================

# Log file for debugging
LOG_FILE="$HOME/start_${APP_NAME}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "Script started at: $(date)"
echo "Current user: $(whoami)"
echo "Current directory: $(pwd)"
echo "Initial DISPLAY: $DISPLAY"
echo "=========================================="

# Wait for X server with retries
wait_for_display() {
    local max_attempts=30
    local attempt=0

    echo "Waiting for X server to be ready..."

    while [ $attempt -lt $max_attempts ]; do
        # Try multiple display numbers
        for display_num in 1 0 2; do
            if DISPLAY=:${display_num} xdpyinfo >/dev/null 2>&1; then
                echo "X server is ready on DISPLAY :${display_num}"
                export DISPLAY=:${display_num}
                return 0
            fi
        done

        echo "Waiting for X server... attempt $((attempt+1))/$max_attempts"
        sleep 2
        attempt=$((attempt+1))
    done

    echo "ERROR: X server not available after $max_attempts attempts"
    return 1
}

# Wait for X server to be ready
wait_for_display || exit 1

echo "Final DISPLAY variable: $DISPLAY"

# Give X11 permissions
xhost +local: 2>/dev/null || true

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Verify Node.js is available
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not available. Please install Node.js first."
    exit 1
fi

# Verify yarn is available
if ! command -v yarn &> /dev/null; then
    echo "ERROR: yarn is not available. Please install yarn first."
    exit 1
fi

# Verify PM2 is available
if ! command -v pm2 &> /dev/null; then
    echo "ERROR: PM2 is not installed. Please install PM2 first: yarn global add pm2"
    exit 1
fi

echo "Node version: $(node --version)"
echo "Yarn version: $(yarn --version)"
echo "PM2 version: $(pm2 --version)"

# Start PM2 daemon if not running
pm2 ping > /dev/null 2>&1

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Project directory: $SCRIPT_DIR"

# Navigate to project directory
cd "$SCRIPT_DIR"

# Clean up any errored instances
echo "Checking for errored instances of $APP_NAME..."
if pm2 list | grep "$APP_NAME" | grep -q "errored"; then
    echo "Found errored instance(s), cleaning up..."
    pm2 delete "$APP_NAME" 2>/dev/null || true
    sleep 1
fi

# Check if app is already running properly
if pm2 list | grep "$APP_NAME" | grep -q "online"; then
    echo "App '$APP_NAME' is already running online"
    echo "Restarting to ensure latest code..."
    pm2 restart "$APP_NAME"
    echo "Application restarted successfully!"
    exit 0
fi

# Install dependencies if package.json exists
if [ -f "package.json" ]; then
    echo "Installing dependencies..."
    if ! yarn install; then
        echo "ERROR: Failed to install dependencies"
        exit 1
    fi
    echo "Dependencies installed successfully"
fi

# Run build if enabled and build script exists
if [ "$RUN_BUILD" = "true" ] && [ -f "package.json" ]; then
    if grep -q '"build"' package.json; then
        echo "Running build..."
        if ! yarn build; then
            echo "ERROR: Build failed"
            exit 1
        fi
        
        # Verify build output exists
        if [ ! -d "dist" ] && [ ! -f "dist/main.js" ]; then
            echo "WARNING: Build completed but dist/main.js not found"
            echo "Checking if dist directory exists..."
            ls -la dist/ 2>/dev/null || echo "dist/ directory does not exist"
        else
            echo "Build completed successfully"
        fi
    fi
fi

# Start application with PM2
echo "Starting application with PM2..."

# Check if dist/main.js exists before starting
if [ ! -f "dist/main.js" ]; then
    echo "ERROR: dist/main.js not found. Please run 'yarn build' first."
    exit 1
fi

# Start the application
if pm2 start dist/main.js --name "$APP_NAME"; then
    echo "Application started successfully!"
    
    # Wait a moment and check status
    sleep 2
    if pm2 list | grep "$APP_NAME" | grep -q "online"; then
        echo "Application is running and online"
    elif pm2 list | grep "$APP_NAME" | grep -q "errored"; then
        echo "WARNING: Application started but is in errored state"
        echo "Check logs with: pm2 logs $APP_NAME"
        exit 1
    else
        echo "Application status: $(pm2 list | grep "$APP_NAME" | awk '{print $10}')"
    fi
else
    echo "ERROR: Failed to start application with PM2"
    exit 1
fi

# IMPORTANT: DO NOT save PM2 state
echo "Note: PM2 state NOT saved - XFCE autostart will manage restarts"

exit 0
