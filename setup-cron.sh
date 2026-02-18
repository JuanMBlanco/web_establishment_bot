#!/bin/bash
#
# Script auxiliar para configurar el crontab automáticamente
# Este script facilita la configuración de la tarea de crontab
#
# Uso:
#   ./setup-cron.sh                    # Configurar para 10:10 PM (22:10)
#   ./setup-cron.sh 21 30             # Configurar para 9:30 PM (21:30)
#   ./setup-cron.sh --remove          # Eliminar la tarea de crontab
#

set -e  # Salir si hay algún error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Obtener el directorio del script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CRON_SCRIPT="$SCRIPT_DIR/cron-run-test-integrated-today.sh"

# Verificar que el script de cron existe
if [ ! -f "$CRON_SCRIPT" ]; then
    print_error "No se encontró el script: $CRON_SCRIPT"
    exit 1
fi

# Hacer el script ejecutable
chmod +x "$CRON_SCRIPT"
print_info "Permisos de ejecución configurados para: $CRON_SCRIPT"

# Función para eliminar la tarea
remove_cron_job() {
    print_info "Eliminando tarea de crontab..."
    
    # Obtener crontab actual
    CURRENT_CRON=$(crontab -l 2>/dev/null || echo "")
    
    if [ -z "$CURRENT_CRON" ]; then
        print_warning "No hay tareas de crontab configuradas"
        return 0
    fi
    
    # Eliminar líneas que contengan el script
    NEW_CRON=$(echo "$CURRENT_CRON" | grep -v "cron-run-test-integrated-today.sh" || true)
    
    if [ "$NEW_CRON" = "$CURRENT_CRON" ]; then
        print_warning "No se encontró la tarea en crontab"
        return 0
    fi
    
    # Actualizar crontab
    echo "$NEW_CRON" | crontab -
    print_info "✓ Tarea eliminada de crontab"
    
    return 0
}

# Verificar si se solicita eliminar
if [ "$1" = "--remove" ] || [ "$1" = "-r" ]; then
    remove_cron_job
    exit 0
fi

# Obtener hora y minuto de los argumentos o usar valores por defecto
HOUR=${1:-22}   # 22 = 10 PM
MINUTE=${2:-10} # 10 minutos

# Validar hora (0-23)
if ! [[ "$HOUR" =~ ^[0-9]+$ ]] || [ "$HOUR" -lt 0 ] || [ "$HOUR" -gt 23 ]; then
    print_error "Hora inválida: $HOUR (debe ser 0-23)"
    exit 1
fi

# Validar minuto (0-59)
if ! [[ "$MINUTE" =~ ^[0-9]+$ ]] || [ "$MINUTE" -lt 0 ] || [ "$MINUTE" -gt 59 ]; then
    print_error "Minuto inválido: $MINUTE (debe ser 0-59)"
    exit 1
fi

# Obtener la ruta absoluta del script
SCRIPT_PATH=$(realpath "$CRON_SCRIPT" 2>/dev/null || echo "$CRON_SCRIPT")

# Formatear hora para mostrar
if [ "$HOUR" -eq 0 ]; then
    HOUR_DISPLAY="12:${MINUTE} AM"
elif [ "$HOUR" -lt 12 ]; then
    HOUR_DISPLAY="${HOUR}:${MINUTE} AM"
elif [ "$HOUR" -eq 12 ]; then
    HOUR_DISPLAY="12:${MINUTE} PM"
else
    HOUR_12=$((HOUR - 12))
    HOUR_DISPLAY="${HOUR_12}:${MINUTE} PM"
fi

print_info "=========================================="
print_info "Configuración de Crontab"
print_info "=========================================="
print_info "Script: $SCRIPT_PATH"
print_info "Hora de ejecución: $HOUR_DISPLAY ($HOUR:$MINUTE)"
print_info ""

# Obtener crontab actual
CURRENT_CRON=$(crontab -l 2>/dev/null || echo "")

# Verificar si ya existe una tarea para este script
if echo "$CURRENT_CRON" | grep -q "cron-run-test-integrated-today.sh"; then
    print_warning "Ya existe una tarea de crontab para este script"
    echo ""
    echo "Tarea actual:"
    echo "$CURRENT_CRON" | grep "cron-run-test-integrated-today.sh"
    echo ""
    read -p "¿Deseas reemplazarla? (s/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[SsYy]$ ]]; then
        print_info "Operación cancelada"
        exit 0
    fi
    
    # Eliminar la tarea existente
    NEW_CRON=$(echo "$CURRENT_CRON" | grep -v "cron-run-test-integrated-today.sh" || true)
else
    NEW_CRON="$CURRENT_CRON"
fi

# Agregar la nueva tarea
CRON_LINE="$MINUTE $HOUR * * * $SCRIPT_PATH"
NEW_CRON=$(echo -e "$NEW_CRON\n$CRON_LINE")

# Actualizar crontab
echo "$NEW_CRON" | crontab -

print_info "✓ Tarea de crontab configurada exitosamente"
print_info ""
print_info "Tarea agregada:"
print_info "  $CRON_LINE"
print_info ""
print_info "Para verificar:"
print_info "  crontab -l"
print_info ""
print_info "Para eliminar:"
print_info "  ./setup-cron.sh --remove"
print_info ""
