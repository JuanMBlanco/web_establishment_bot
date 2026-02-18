#!/bin/bash
#
# Script para ejecutar test-integrated con fecha actual en EST desde crontab
# Este script maneja todas las variables de entorno necesarias para ejecutar
# el proyecto en el contexto limitado de crontab
#
# Uso: Este script está diseñado para ser ejecutado desde crontab
#      10 22 * * * /ruta/completa/cron-run-test-integrated-today.sh
#

# =============================================================================
# Configuración
# =============================================================================

# Obtener el directorio donde está este script (ruta absoluta)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR"

# Archivo de log para crontab
LOG_DIR="$PROJECT_DIR/logs"
CRON_LOG="$LOG_DIR/cron-test-integrated-$(date +%Y-%m-%d).log"
ERROR_LOG="$LOG_DIR/cron-test-integrated-errors-$(date +%Y-%m-%d).log"

# Crear directorio de logs si no existe
mkdir -p "$LOG_DIR"

# Función para logging
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$CRON_LOG"
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" | tee -a "$CRON_LOG" | tee -a "$ERROR_LOG"
}

# =============================================================================
# Inicialización
# =============================================================================

log_message "=========================================="
log_message "Cron Job: test-integrated con fecha actual en EST"
log_message "=========================================="
log_message "Iniciado a las: $(date)"
log_message "Usuario: $(whoami)"
log_message "Directorio del proyecto: $PROJECT_DIR"
log_message ""

# Cambiar al directorio del proyecto
cd "$PROJECT_DIR" || {
    log_error "No se pudo cambiar al directorio del proyecto: $PROJECT_DIR"
    exit 1
}

# =============================================================================
# Configurar Variables de Entorno
# =============================================================================

# Configurar PATH básico (crontab tiene un PATH muy limitado)
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"

# Configurar DISPLAY para X11 (necesario para Puppeteer/Chrome)
# Intentar detectar DISPLAY automáticamente
if [ -z "$DISPLAY" ]; then
    # Intentar encontrar un display disponible
    for display_num in 1 0 2; do
        if DISPLAY=:${display_num} xdpyinfo >/dev/null 2>&1; then
            export DISPLAY=:${display_num}
            log_message "DISPLAY configurado a: $DISPLAY"
            break
        fi
    done
    
    # Si no se encontró, usar :0 como fallback
    if [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
        log_message "DISPLAY configurado a fallback: $DISPLAY"
    fi
fi

# Dar permisos X11
xhost +local: >/dev/null 2>&1 || true

# Cargar NVM si está disponible
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    log_message "Cargando NVM desde: $NVM_DIR"
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
    
    # Cargar nvm.sh puede no exportar nvm, intentar cargar también bash_completion
    [ -s "$NVM_DIR/bash_completion" ] && source "$NVM_DIR/bash_completion"
else
    log_message "NVM no encontrado en $NVM_DIR, usando Node.js del sistema"
fi

# =============================================================================
# Verificar Dependencias
# =============================================================================

# Verificar Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js no está disponible en el PATH"
    log_error "PATH actual: $PATH"
    exit 1
fi

NODE_VERSION=$(node --version)
log_message "Node.js versión: $NODE_VERSION"

# Verificar yarn
if ! command -v yarn &> /dev/null; then
    log_error "yarn no está disponible en el PATH"
    exit 1
fi

YARN_VERSION=$(yarn --version)
log_message "yarn versión: $YARN_VERSION"

# =============================================================================
# Ejecutar el Script
# =============================================================================

log_message ""
log_message "Ejecutando: yarn test:integrated:today"
log_message ""

# Ejecutar el script y capturar tanto stdout como stderr
if yarn test:integrated:today >> "$CRON_LOG" 2>> "$ERROR_LOG"; then
    EXIT_CODE=$?
    log_message ""
    log_message "=========================================="
    log_message "✓ Script ejecutado exitosamente"
    log_message "Código de salida: $EXIT_CODE"
    log_message "=========================================="
    exit 0
else
    EXIT_CODE=$?
    log_error ""
    log_error "=========================================="
    log_error "✗ Script falló con código de salida: $EXIT_CODE"
    log_error "=========================================="
    log_error "Revisa los logs en:"
    log_error "  - Log completo: $CRON_LOG"
    log_error "  - Errores: $ERROR_LOG"
    exit $EXIT_CODE
fi
