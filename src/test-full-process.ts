import { 
  loadConfig, 
  logMessage, 
  waitRandomTime, 
  type BotConfig,
  initializeLogFile
} from './main.js';

function getCliDateArg(): string | null {
  const args = process.argv.slice(2);
  const dateArg = args.find(a => a.startsWith('--date='));
  if (!dateArg) return null;

  const value = dateArg.split('=')[1]?.trim();
  if (!value) return null;

  const match = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return match ? value : null;
}

/**
 * Test script for FULL PROCESS:
 * - Login (con 2FA)
 * - Navegar a Completed
 * - Filtrar por fecha y códigos
 * - Analizar órdenes (Delivery Issue)
 * - Estadísticas por cuenta y globales
 * 
 * Uso:
 *   yarn test:full                    - Usa filterDate del config o ninguna
 *   yarn test:full --date=YYYY-MM-DD  - Sobrescribe filterDate con esta fecha
 */
async function testFullProcess(): Promise<void> {
  try {
    logMessage('=== Starting FULL PROCESS Test ===');
    logMessage('');

    // Step 1: Load configuration
    logMessage('Step 1: Loading configuration...');
    const config: BotConfig = loadConfig();
    
    // Override filterDate from CLI if provided
    const cliDate = getCliDateArg();
    if (cliDate) {
      config.task.filterDate = cliDate;
      logMessage(`Overriding filter date from CLI: ${cliDate}`);
    }
    
    // Initialize log file system
    initializeLogFile(config);

    if (!config.accounts || config.accounts.length === 0) {
      logMessage('ERROR: No accounts configured in YAML file', 'ERROR');
      logMessage('Please add accounts section to config/ezcater_web_establishment_bot.yaml', 'ERROR');
      process.exit(1);
    }

    if (!config.gmail) {
      logMessage('ERROR: Gmail configuration not found in YAML file', 'ERROR');
      logMessage('Please add gmail section to config/ezcater_web_establishment_bot.yaml', 'ERROR');
      process.exit(1);
    }

    logMessage('✓ Configuration loaded');
    logMessage(`  - Accounts: ${config.accounts.length}`);
    logMessage(`  - Task URL: ${config.task.url}`);
    if (config.task.filterDate) {
      logMessage(`  - Filter date: ${config.task.filterDate}`);
    }
    if (config.task.orderCodesFile) {
      logMessage(`  - Order codes file: ${config.task.orderCodesFile}`);
    }
    logMessage('');

    // Step 2: Run full process using main logic (checkListAndClick)
    logMessage('Step 2: Running full process (login + orders + analysis)...');

    // Import checkListAndClick dynamically (exported from main.ts)
    const { checkListAndClick } = await import('./main.js') as {
      checkListAndClick: (cfg: BotConfig) => Promise<{ processed: number; clicked: number; error?: string }>;
    };

    const result = await checkListAndClick(config);

    logMessage('');
    logMessage('=== FULL PROCESS RESULT ===');
    if (result.error) {
      logMessage(`✗ Process finished with error: ${result.error}`, 'ERROR');
    } else {
      logMessage('✓ Process completed successfully');
      logMessage(`  - Items processed: ${result.processed}`);
      logMessage(`  - Items clicked: ${result.clicked}`);
    }

    logMessage('');
    logMessage('Note: Detailed per-order statistics are logged by the main process');
    logMessage('      (per-account success/failure and global stats).');
    logMessage('');

    // Small wait before exit so logs are flushed
    await waitRandomTime(2000, 3000);

    logMessage('=== FULL PROCESS Test Completed ===');
  } catch (error: any) {
    logMessage(`FULL PROCESS test failed with error: ${error.message}`, 'ERROR');
    logMessage(error.stack, 'ERROR');
    process.exit(1);
  }
}

// Run the test
void testFullProcess().catch(error => {
  logMessage(`Unhandled error in FULL PROCESS test: ${error.message}`, 'ERROR');
  process.exit(1);
});