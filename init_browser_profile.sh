#!/bin/bash

# =============================================================================
# Browser Profile Initialization Script
# =============================================================================
# This script initializes browser profiles for the web establishment bot
# =============================================================================

set -e

# Colors for output
RED=$(tput setaf 1)
GREEN=$(tput setaf 2)
YELLOW=$(tput setaf 3)
BLUE=$(tput setaf 4)
BOLD=$(tput bold)
RESET=$(tput sgr0)

# Default values
CONTEXT="default"
PROFILE_FOLDER="detect"
INSTANCES=3
APP_NAME="ezcater_web_establishment_bot"
URL="https://example.com"
SKIP_CONFIRM=false

# =============================================================================
# Functions
# =============================================================================

print_error() {
    echo "${RED}ERROR: $1${RESET}" >&2
}

print_success() {
    echo "${GREEN}✓ $1${RESET}"
}

print_info() {
    echo "${BLUE}➜ $1${RESET}"
}

print_warning() {
    echo "${YELLOW}⚠ $1${RESET}"
}

print_help() {
    cat << EOF
${GREEN}Browser Profile Initialization Script${RESET}

${BLUE}USAGE:${RESET}
    $0 [OPTIONS]

${BLUE}OPTIONS:${RESET}
    --context=<name>        Context name for browser profile (default: default)
    --instances=<num>       Number of browser profile instances to create (default: 3)
    --url=<url>             URL to open in browser (default: https://example.com)
    -y                      Skip all confirmation prompts
    --help                  Show this help message

EOF
}

# Parse command line arguments
parse_arguments() {
    for arg in "$@"; do
        case $arg in
            --context=*)
                CONTEXT="${arg#*=}"
                shift
                ;;
            --instances=*)
                INSTANCES="${arg#*=}"
                shift
                ;;
            --url=*)
                URL="${arg#*=}"
                shift
                ;;
            -y)
                SKIP_CONFIRM=true
                shift
                ;;
            --help)
                print_help
                exit 0
                ;;
            *)
                print_error "Unknown option: $arg"
                print_help
                exit 1
                ;;
        esac
    done
}

confirm_action() {
    local message=$1
    local default_answer=${2:-n}

    if [ "$SKIP_CONFIRM" = true ]; then
        return 0
    fi

    local prompt="$message [y/n] "

    if [ "$default_answer" = "y" ]; then
        prompt="$message [Y/n] "
    else
        prompt="$message [y/N] "
    fi

    read -p "$prompt" answer

    if [ -z "$answer" ]; then
        answer=$default_answer
    fi

    answer=$(echo "$answer" | tr '[:upper:]' '[:lower:]')

    if [ "$answer" = "y" ] || [ "$answer" = "yes" ]; then
        return 0
    else
        return 1
    fi
}

detect_app_name() {
    print_info "Detecting app name from package.json..."

    local PACKAGE_JSON="./package.json"

    if [ ! -f "$PACKAGE_JSON" ]; then
        print_error "package.json not found"
        APP_NAME="ezcater_web_establishment_bot"
        return
    fi

    if command -v node &> /dev/null; then
        APP_NAME=$(node -e "try { const pkg = require('$PACKAGE_JSON'); console.log(pkg.name || ''); } catch(e) { console.log(''); }")
    else
        APP_NAME=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$PACKAGE_JSON" | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | head -n 1)
    fi

    if [ -z "$APP_NAME" ]; then
        APP_NAME="ezcater_web_establishment_bot"
    fi

    print_success "Detected app name: $APP_NAME"
}

check_pm2_status() {
    print_info "Checking PM2 status..."

    if ! command -v pm2 &> /dev/null; then
        print_warning "PM2 is not installed"
        PM2_INSTALLED=false
        return
    fi

    PM2_INSTALLED=true
    print_success "PM2 is installed"

    if pm2 list | grep -q "$APP_NAME"; then
        print_info "App '$APP_NAME' is running in PM2"
        APP_RUNNING=true
    else
        print_info "App '$APP_NAME' is not running in PM2"
        APP_RUNNING=false
    fi

    local CONFIG_FILE="./config/${APP_NAME}.yaml"
    EXECUTABLE_PATH=$(grep "executablePath:" "$CONFIG_FILE" | grep -v "_executablePath" | sed 's/.*executablePath:[[:space:]]*"\(.*\)".*/\1/' | head -n 1)

    if [ -z "$EXECUTABLE_PATH" ]; then
        EXECUTABLE_PATH=$(grep "executablePath:" "$CONFIG_FILE" | grep -v "_executablePath" | sed 's/.*executablePath:[[:space:]]*\(.*\)[[:space:]]*.*/\1/' | head -n 1)
    fi

    print_info "Executable path from config: $EXECUTABLE_PATH"
}

stop_pm2_app() {
    if [ "$PM2_INSTALLED" = true ] && [ "$APP_RUNNING" = true ]; then
        print_info "Stopping $APP_NAME..."
        pm2 stop "$APP_NAME"
        print_success "App stopped"
    fi
}

start_pm2_app() {
    if [ "$PM2_INSTALLED" = true ] && [ "$APP_RUNNING" = true ]; then
        print_info "Restarting $APP_NAME..."
        pm2 start "$APP_NAME"
        print_success "App restarted"
    fi
}

create_browser_profile() {
    local PROFILE_DIR="./browsers/$CONTEXT/chrome_profile_01"

    print_info "Creating/checking browser profile: $PROFILE_DIR"

    if [ ! -d "$PROFILE_DIR" ]; then
        print_info "Creating directory: $PROFILE_DIR"
        mkdir -p "$PROFILE_DIR"
        print_success "Directory created"
    else
        print_info "Profile directory already exists"
    fi

    return 0
}

launch_browser() {
    if [ -z "$EXECUTABLE_PATH" ]; then
        print_error "Executable path not found"
        exit 1
    fi

    local PROFILE_DIR="./browsers/$CONTEXT/chrome_profile_01"

    print_info "Launching browser to initialize profile..."
    print_info "Using executable: $EXECUTABLE_PATH"
    print_info "Using profile directory: $PROFILE_DIR"
    print_info "Opening URL: $URL"

    echo ""
    echo "${YELLOW}=== Browser Launch Summary ===${RESET}"
    echo "Context: $CONTEXT"
    echo "Profile Directory: $PROFILE_DIR"
    echo "App Name: $APP_NAME"
    echo "URL: $URL"
    echo "Executable: $EXECUTABLE_PATH"
    echo ""

    if ! confirm_action "Do you want to continue with browser launch?" "y"; then
        print_info "Browser launch aborted by user"
        exit 0
    fi

    if [ ! -d "$PROFILE_DIR" ]; then
        mkdir -p "$PROFILE_DIR"
    fi

    print_info "Starting browser with profile: $PROFILE_DIR"
    "$EXECUTABLE_PATH" --user-data-dir="$PROFILE_DIR" "$URL"

    if [ $? -eq 0 ]; then
        print_success "Browser closed, profile initialization complete"
    else
        print_error "Failed to launch browser with profile"
        exit 1
    fi
}

replicate_profiles() {
    local SOURCE_PROFILE="./browsers/$CONTEXT/chrome_profile_01"

    echo ""
    echo "${YELLOW}=== Profile Replication Summary ===${RESET}"
    echo "Source Profile: $SOURCE_PROFILE"
    echo "Number of Instances: $INSTANCES"
    echo "Target Profiles:"
    for i in $(seq -f "%02g" 2 $INSTANCES); do
        echo "  - ./browsers/$CONTEXT/chrome_profile_$i"
    done
    echo ""

    if ! confirm_action "Do you want to replicate the browser profile to $INSTANCES instances?" "y"; then
        print_info "Profile replication aborted by user"
        return 1
    fi

    print_info "Replicating browser profile to $INSTANCES instances..."

    for i in $(seq -f "%02g" 2 $INSTANCES); do
        local TARGET_PROFILE="./browsers/$CONTEXT/chrome_profile_$i"

        print_info "Replicating to: chrome_profile_$i"

        if [ -d "$TARGET_PROFILE" ]; then
            rm -rf "$TARGET_PROFILE"
        fi

        cp -r "$SOURCE_PROFILE" "$TARGET_PROFILE"
    done

    print_success "Profile replication completed"
    return 0
}

# =============================================================================
# Main Script
# =============================================================================

parse_arguments "$@"

detect_app_name

check_pm2_status

stop_pm2_app

create_browser_profile

launch_browser

replicate_profiles
REPLICATION_SUCCESS=$?

if [ "$REPLICATION_SUCCESS" -eq 0 ]; then
    start_pm2_app
    print_success "Browser profile initialization completed!"
else
    print_warning "Profile replication was skipped"
    if [ "$PM2_INSTALLED" = true ] && [ "$APP_RUNNING" = true ]; then
        if confirm_action "Do you want to restart the PM2 app anyway?" "n"; then
            start_pm2_app
        else
            print_info "PM2 app not restarted"
        fi
    fi
    print_info "Browser profile initialization partially completed"
fi

exit 0
