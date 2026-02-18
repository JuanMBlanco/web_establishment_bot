#!/usr/bin/env node
/**
 * Script para ejecutar test-integrated.ts con la fecha del día actual en EST
 * 
 * Este script:
 * 1. Obtiene la fecha actual
 * 2. La convierte a hora EST (Eastern Standard Time)
 * 3. Formatea la fecha como YYYY-MM-DD
 * 4. Ejecuta yarn test:integrated --date=YYYY-MM-DD
 * 
 * Uso:
 *   node run-test-integrated-today.js
 *   npm run test:integrated:today
 *   yarn test:integrated:today
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Obtiene la fecha actual en EST (Eastern Standard Time)
 * EST es UTC-5 (o UTC-4 durante DST - Daylight Saving Time)
 * 
 * Nota: EST puede ser:
 * - EST (Eastern Standard Time): UTC-5 (noviembre a marzo)
 * - EDT (Eastern Daylight Time): UTC-4 (marzo a noviembre)
 * 
 * Este script usa la zona horaria "America/New_York" que maneja automáticamente DST
 */
function getCurrentDateEST(): string {
  // Crear fecha actual
  const now = new Date();
  
  // Obtener la fecha y hora en EST usando Intl.DateTimeFormat
  // Esto maneja correctamente la conversión de timezone y DST automáticamente
  const estFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  
  // Formatear fecha completa en EST
  const estParts = estFormatter.formatToParts(now);
  
  // Extraer componentes de fecha
  const year = estParts.find(p => p.type === 'year')?.value || '';
  const month = estParts.find(p => p.type === 'month')?.value || '';
  const day = estParts.find(p => p.type === 'day')?.value || '';
  const hour = estParts.find(p => p.type === 'hour')?.value || '';
  const minute = estParts.find(p => p.type === 'minute')?.value || '';
  const second = estParts.find(p => p.type === 'second')?.value || '';
  const dayPeriod = estParts.find(p => p.type === 'dayPeriod')?.value || '';
  
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hour}:${minute}:${second} ${dayPeriod}`;
  
  // Determinar si es EST o EDT usando el timezone name
  const timezoneFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  });
  
  const timezoneParts = timezoneFormatter.formatToParts(now);
  const timezoneName = timezoneParts.find(p => p.type === 'timeZoneName')?.value || 'EST';
  
  console.log('='.repeat(60));
  console.log('EZCater Test Integrated - Setup con Fecha Actual');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Fecha actual (local): ${now.toLocaleString()}`);
  console.log(`Fecha actual (${timezoneName}): ${month}/${day}/${year} ${timeStr}`);
  console.log(`Fecha formateada (YYYY-MM-DD): ${dateStr}`);
  console.log('');
  console.log(`Ejecutando: yarn test:integrated --date=${dateStr}`);
  console.log('');
  console.log('='.repeat(60));
  console.log('');
  
  return dateStr;
}

/**
 * Ejecuta el comando test-integrated con la fecha en EST
 */
function runTestIntegrated(dateStr: string): void {
  try {
    const command = `yarn test:integrated --date=${dateStr}`;
    console.log(`Comando: ${command}`);
    console.log('');
    
    // Ejecutar el comando de forma síncrona para ver la salida en tiempo real
    execSync(command, {
      cwd: __dirname,
      stdio: 'inherit', // Hereda stdin, stdout, stderr del proceso padre
      env: { ...process.env }
    });
    
    console.log('');
    console.log('='.repeat(60));
    console.log('✓ Proceso completado exitosamente');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('✗ Error ejecutando test-integrated');
    console.error('='.repeat(60));
    console.error('');
    
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error('Error desconocido:', error);
    }
    
    process.exit(1);
  }
}

// Función principal
function main() {
  try {
    // Obtener fecha actual en EST
    const dateStr = getCurrentDateEST();
    
    // Ejecutar test-integrated con la fecha
    runTestIntegrated(dateStr);
    
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('✗ Error en el script de setup');
    console.error('='.repeat(60));
    console.error('');
    
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error('Error desconocido:', error);
    }
    
    process.exit(1);
  }
}

// Ejecutar
main();
