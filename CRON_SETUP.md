# Configuración de Crontab para Ejecutar test-integrated Automáticamente

Este documento explica cómo configurar una tarea de crontab que ejecute automáticamente `test-integrated.ts` con la fecha actual en EST a las 10:10 PM todos los días.

## Requisitos Previos

1. **Sistema operativo**: Linux (el script está diseñado para Linux)
2. **Node.js y yarn**: Deben estar instalados y disponibles en el PATH
3. **NVM (opcional)**: Si usas NVM para gestionar Node.js, debe estar configurado
4. **X11/Display**: El sistema debe tener un servidor X disponible para Puppeteer

## Paso 1: Hacer el Script Ejecutable

Primero, asegúrate de que el script tenga permisos de ejecución:

```bash
chmod +x cron-run-test-integrated-today.sh
```

## Paso 2: Obtener la Ruta Absoluta del Script

Necesitas la ruta absoluta del script para configurarlo en crontab:

```bash
# Desde el directorio del proyecto
cd /ruta/completa/a/ezcater_web_establishment_bot
pwd
# Esto mostrará algo como: /home/usuario/proyectos/ezcater_web_establishment_bot

# Obtener la ruta completa del script
realpath cron-run-test-integrated-today.sh
# O simplemente:
echo "$(pwd)/cron-run-test-integrated-today.sh"
```

## Paso 3: Configurar Crontab

### Opción A: Editar Crontab Interactivamente

```bash
crontab -e
```

### Opción B: Agregar Línea Directamente

```bash
# Agregar la tarea (reemplaza /ruta/completa con tu ruta real)
(crontab -l 2>/dev/null; echo "10 22 * * * /ruta/completa/a/ezcater_web_establishment_bot/cron-run-test-integrated-today.sh") | crontab -
```

## Formato de Crontab

La línea de crontab debe tener este formato:

```
10 22 * * * /ruta/completa/a/ezcater_web_establishment_bot/cron-run-test-integrated-today.sh
```

**Explicación del formato:**
- `10` = minuto (10)
- `22` = hora (22 = 10:10 PM en formato 24 horas)
- `*` = día del mes (cualquier día)
- `*` = mes (cualquier mes)
- `*` = día de la semana (cualquier día)
- Ruta completa al script

### Ejemplo Completo

```bash
# Ejecutar test-integrated todos los días a las 10:10 PM
10 22 * * * /home/usuario/proyectos/ezcater_web_establishment_bot/cron-run-test-integrated-today.sh
```

## Paso 4: Verificar la Configuración

Verifica que la tarea se agregó correctamente:

```bash
crontab -l
```

Deberías ver algo como:

```
10 22 * * * /home/usuario/proyectos/ezcater_web_establishment_bot/cron-run-test-integrated-today.sh
```

## Paso 5: Probar la Configuración (Opcional)

Puedes probar que el script funciona correctamente ejecutándolo manualmente:

```bash
# Ejecutar el script directamente
./cron-run-test-integrated-today.sh

# O con la ruta completa
/home/usuario/proyectos/ezcater_web_establishment_bot/cron-run-test-integrated-today.sh
```

## Logs

El script genera logs automáticamente en el directorio `logs/`:

- **Log completo**: `logs/cron-test-integrated-YYYY-MM-DD.log`
- **Log de errores**: `logs/cron-test-integrated-errors-YYYY-MM-DD.log`

### Ver los Logs

```bash
# Ver el log del día actual
tail -f logs/cron-test-integrated-$(date +%Y-%m-%d).log

# Ver errores del día actual
tail -f logs/cron-test-integrated-errors-$(date +%Y-%m-%d).log

# Ver todos los logs
ls -lh logs/cron-test-integrated-*.log
```

## Configuración Avanzada

### Cambiar la Hora de Ejecución

Para cambiar la hora, edita la línea de crontab:

```bash
# Ejecutar a las 9:30 PM
30 21 * * * /ruta/completa/cron-run-test-integrated-today.sh

# Ejecutar a las 11:00 PM
0 23 * * * /ruta/completa/cron-run-test-integrated-today.sh

# Ejecutar a las 8:00 AM
0 8 * * * /ruta/completa/cron-run-test-integrated-today.sh
```

### Ejecutar Solo en Días Específicos

```bash
# Solo lunes a viernes a las 10:10 PM
10 22 * * 1-5 /ruta/completa/cron-run-test-integrated-today.sh

# Solo los lunes
10 22 * * 1 /ruta/completa/cron-run-test-integrated-today.sh
```

### Redirigir Salida a un Archivo Específico

```bash
# Redirigir stdout y stderr a archivos específicos
10 22 * * * /ruta/completa/cron-run-test-integrated-today.sh >> /ruta/logs/output.log 2>> /ruta/logs/error.log
```

**Nota**: El script ya maneja los logs internamente, pero puedes agregar redirecciones adicionales si lo deseas.

## Troubleshooting

### El script no se ejecuta

1. **Verificar permisos**:
   ```bash
   ls -l cron-run-test-integrated-today.sh
   # Debe mostrar: -rwxr-xr-x o similar (x = ejecutable)
   ```

2. **Verificar que crontab esté ejecutando**:
   ```bash
   # Verificar el servicio cron
   sudo systemctl status cron
   # O en algunos sistemas:
   sudo service cron status
   ```

3. **Verificar logs del sistema**:
   ```bash
   # Ver logs de cron
   grep CRON /var/log/syslog
   # O en algunos sistemas:
   journalctl -u cron
   ```

### Error: "Node.js no está disponible"

El script intenta cargar NVM automáticamente, pero si falla:

1. **Verificar que NVM esté instalado**:
   ```bash
   ls -la ~/.nvm/nvm.sh
   ```

2. **Agregar PATH manualmente en el script**:
   Edita `cron-run-test-integrated-today.sh` y agrega la ruta de Node.js:
   ```bash
   export PATH="/ruta/a/node/bin:$PATH"
   ```

### Error: "DISPLAY not set"

Si Puppeteer necesita un display:

1. **Verificar que X11 esté disponible**:
   ```bash
   echo $DISPLAY
   xdpyinfo
   ```

2. **Configurar DISPLAY en crontab**:
   ```bash
   10 22 * * * DISPLAY=:0 /ruta/completa/cron-run-test-integrated-today.sh
   ```

### El script se ejecuta pero falla

1. **Revisar los logs**:
   ```bash
   tail -100 logs/cron-test-integrated-$(date +%Y-%m-%d).log
   tail -100 logs/cron-test-integrated-errors-$(date +%Y-%m-%d).log
   ```

2. **Ejecutar manualmente para debug**:
   ```bash
   bash -x cron-run-test-integrated-today.sh
   ```

## Eliminar la Tarea de Crontab

Para eliminar la tarea:

```bash
# Editar crontab
crontab -e
# Eliminar la línea correspondiente

# O eliminar todas las tareas
crontab -r
```

## Notas Importantes

1. **Rutas absolutas**: Crontab requiere rutas absolutas, no relativas
2. **Variables de entorno**: Crontab tiene un entorno muy limitado, el script configura las variables necesarias
3. **Permisos**: Asegúrate de que el script tenga permisos de ejecución
4. **Logs**: Los logs se guardan automáticamente en `logs/`
5. **Timezone**: El script convierte automáticamente la fecha a EST antes de ejecutar

## Ejemplo Completo de Configuración

```bash
# 1. Ir al directorio del proyecto
cd /home/usuario/proyectos/ezcater_web_establishment_bot

# 2. Hacer el script ejecutable
chmod +x cron-run-test-integrated-today.sh

# 3. Obtener la ruta absoluta
SCRIPT_PATH=$(realpath cron-run-test-integrated-today.sh)
echo "Ruta del script: $SCRIPT_PATH"

# 4. Agregar a crontab
(crontab -l 2>/dev/null; echo "10 22 * * * $SCRIPT_PATH") | crontab -

# 5. Verificar
crontab -l

# 6. Probar manualmente
./cron-run-test-integrated-today.sh
```

## Soporte

Si encuentras problemas, revisa:
- Los logs en `logs/cron-test-integrated-*.log`
- Los logs del sistema: `/var/log/syslog` o `journalctl -u cron`
- Ejecuta el script manualmente para ver errores en tiempo real
