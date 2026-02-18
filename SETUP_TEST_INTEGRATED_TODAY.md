# Setup para Ejecutar test-integrated.ts con Fecha Actual en EST

Este documento explica cómo usar el script de setup que ejecuta `test-integrated.ts` automáticamente con la fecha del día actual convertida a hora EST (Eastern Standard Time).

## Descripción

El script `run-test-integrated-today.js` realiza las siguientes acciones:

1. **Obtiene la fecha actual** del sistema
2. **Convierte la fecha a hora EST** (Eastern Standard Time / Eastern Daylight Time)
   - Maneja automáticamente el cambio entre EST (UTC-5) y EDT (UTC-4) según la época del año
   - Usa la zona horaria `America/New_York` que maneja DST automáticamente
3. **Formatea la fecha** como `YYYY-MM-DD` (ejemplo: `2026-02-07`)
4. **Ejecuta** `yarn test:integrated --date=YYYY-MM-DD`

## Uso

### Opción 1: Usando npm/yarn script (Recomendado)

```bash
# Usando yarn
yarn test:integrated:today

# Usando npm
npm run test:integrated:today
```

### Opción 2: Ejecutando directamente con Node.js

```bash
node run-test-integrated-today.js
```

## Ejemplo de Salida

Cuando ejecutas el script, verás algo como esto:

```
============================================================
EZCater Test Integrated - Setup con Fecha Actual
============================================================

Fecha actual (local): 2/7/2026, 10:30:45 AM
Fecha actual (EST): 02/07/2026 10:30:45 AM
Fecha formateada (YYYY-MM-DD): 2026-02-07

Ejecutando: yarn test:integrated --date=2026-02-07

============================================================

Comando: yarn test:integrated --date=2026-02-07

[... salida del test-integrated ...]
```

## Importante: Conversión a EST

El script convierte automáticamente la fecha actual a hora EST:

- **EST (Eastern Standard Time)**: UTC-5 (noviembre a marzo)
- **EDT (Eastern Daylight Time)**: UTC-4 (marzo a noviembre)

El script detecta automáticamente si es EST o EDT según la época del año y muestra el timezone correcto en la salida.

## Verificación de la Fecha

El script muestra:
- **Fecha actual (local)**: La fecha y hora en tu zona horaria local
- **Fecha actual (EST/EDT)**: La fecha y hora convertida a EST/EDT
- **Fecha formateada**: La fecha en formato `YYYY-MM-DD` que se usará para el test

## Troubleshooting

### Error: "yarn: command not found"

Si obtienes este error, asegúrate de tener yarn instalado o usa npm:

```bash
npm run test:integrated:today
```

### La fecha no es correcta

El script usa la API `Intl.DateTimeFormat` de JavaScript que maneja automáticamente las zonas horarias. Si la fecha no es correcta:

1. Verifica que tu sistema tenga la hora correcta
2. Verifica que Node.js esté actualizado (versión 12+)
3. El script usa `America/New_York` como timezone, que es la zona horaria estándar para EST/EDT

### Error al ejecutar test-integrated

Si el script de setup funciona pero `test-integrated` falla, revisa:
- La configuración en `config/ezcater_web_establishment_bot.yaml`
- Que las cuentas estén configuradas correctamente
- Los logs del proceso para más detalles

## Notas Técnicas

- El script usa `Intl.DateTimeFormat` con `timeZone: 'America/New_York'` para la conversión
- La fecha se formatea como `YYYY-MM-DD` que es el formato esperado por `test-integrated.ts`
- El script ejecuta el comando de forma síncrona para mostrar la salida en tiempo real
- Los errores se capturan y muestran con información detallada

## Archivos Relacionados

- `run-test-integrated-today.js`: Script principal de setup
- `src/test-integrated.ts`: Script de test que se ejecuta
- `package.json`: Contiene el script `test:integrated:today`
