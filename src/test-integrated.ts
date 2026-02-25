/**
 * Integrated test script - Single browser instance for full process
 * 
 * Usage: 
 *   yarn test:integrated                                    - Run full automated process (using filterDate in config or none)
 *   yarn test:integrated --date=YYYY-MM-DD                  - Run process filtering by this date (overrides config.filterDate)
 *   yarn test:integrated --accounts=account1,account2       - Run process only for specified accounts (comma-separated usernames)
 *   yarn test:integrated --account=account1,account2        - Same as --accounts (both singular and plural work)
 *   yarn test:integrated --date=YYYY-MM-DD --accounts=...   - Combine both parameters (filter by date AND specific accounts)
 *   yarn test:integrated --setup                            - Open browser for manual configuration (no automation)
 *   yarn test:integrated --config                           - Same as --setup
 * 
 * Examples:
 *   # Process only specific accounts
 *   yarn test:integrated --accounts=carrot.orders@weknock.com,rice@weknock.com
 *   
 *   # Process with date filter only
 *   yarn test:integrated --date=2026-02-03
 *   
 *   # Combine both: process specific accounts with date filter
 *   yarn test:integrated --date=2026-02-03 --accounts=pincho.catering@weknock.com,rice@weknock.com
 * 
 * Note: Parameters can be combined. When using --date and --accounts together:
 *   - --date filters orders by the specified date
 *   - --accounts limits processing to only the specified accounts
 *   - Both filters are applied simultaneously
 * 
 * This script performs the complete flow in a SINGLE browser instance:
 * - Login (con 2FA via Gmail)
 * - Navigate to Completed
 * - Filter by date and order codes
 * - Analyze orders (Delivery Issue check)
 * - Statistics per account and global
 * 
 * Setup mode: Opens browser without any automation, allowing manual configuration
 *             of Gmail accounts or other necessary settings.
 * 
 * Based on test-login.ts structure but extended with full order processing
 */

import { readFileSync } from 'fs';
import puppeteer from 'puppeteer';
import { 
  loadConfig, 
  isLoggedIn, 
  performLogin, 
  logMessage,
  waitRandomTime,
  type BotConfig,
  type Account,
  initBrowser,
  type InitBrowserResult,
  performLogout,
  clickCompletedButton,
  filterOrdersByDate,
  filterOrdersByCodes,
  getOrderCodesFromConfig,
  clickMatchingOrderLinks,
  searchAndClickOrderCodes,
  displayStatistics,
  type OrderResult,
  initializeLogFile,
  cleanupBrowserTabs,
  generateUnifiedReport,
  saveUnifiedReport,
  uploadLogsAndReportsToGoogleDrive,
  sendFileToTelegram,
  detectTurnstileCaptcha,
  sendMessageToTelegramChatId,
  sendMessageToTelegram
} from './main.js';

// Initialize global results array
(global as any).orderResults = [] as OrderResult[];

/**
 * Check if script is running in setup/config mode
 */
function isSetupMode(): boolean {
  const args = process.argv.slice(2);
  return args.includes('--setup') || args.includes('--config') || args.includes('-s');
}

/**
 * Get CLI date argument (e.g., --date=2026-01-28)
 */
function getCliDateArg(): string | null {
  const args = process.argv.slice(2);
  const dateArg = args.find(a => a.startsWith('--date='));
  if (!dateArg) return null;

  const value = dateArg.split('=')[1]?.trim();
  if (!value) return null;

  // Basic validation: YYYY-MM-DD
  const match = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return match ? value : null;
}

/**
 * Get CLI accounts argument (e.g., --accounts=account1,account2,account3 or --account=account1,account2)
 * Supports both --account (singular) and --accounts (plural) for flexibility
 * Returns array of account usernames to filter, or null if not specified
 */
function getCliAccountsArg(): string[] | null {
  const args = process.argv.slice(2);
  // Support both --account and --accounts
  const accountsArg = args.find(a => a.startsWith('--accounts=') || a.startsWith('--account='));
  if (!accountsArg) return null;

  const value = accountsArg.split('=')[1]?.trim();
  if (!value) return null;

  // Split by comma and trim each account name
  const accounts = value.split(',').map(acc => acc.trim()).filter(acc => acc.length > 0);
  return accounts.length > 0 ? accounts : null;
}

/**
 * Setup mode: Open browser for manual configuration
 */
async function setupMode(): Promise<void> {
  let browser: puppeteer.Browser | null = null;
  let page: puppeteer.Page | null = null;

  try {
    logMessage('=== SETUP MODE: Manual Configuration ===');
    logMessage('');
    logMessage('This mode opens the browser WITHOUT any automation.');
    logMessage('You can manually configure:');
    logMessage('  - Gmail accounts (login to Gmail)');
    logMessage('  - ezCater accounts');
    logMessage('  - Any other necessary settings');
    logMessage('');
    logMessage('The browser will remain open until you close it manually.');
    logMessage('Press Ctrl+C in the terminal to close the browser and exit.');
    logMessage('');

    // Load configuration
    logMessage('Loading configuration...');
    const config = loadConfig();
    
    // Initialize log file system
    initializeLogFile(config);

    // Initialize browser
    logMessage('Initializing browser (using BrowserPool/initBrowser)...');
    const browserResult: InitBrowserResult = await initBrowser(config.task.url, 'default');

    if (!browserResult.browser || !browserResult.page) {
      logMessage(`ERROR: Failed to initialize browser: ${browserResult.error ?? 'Unknown error'}`, 'ERROR');
      process.exit(1);
    }

    browser = browserResult.browser;
    page = browserResult.page;

    logMessage('✓ Browser initialized');
    logMessage('');
    logMessage('=== Browser is now open for manual configuration ===');
    logMessage('  → Navigate to Gmail: https://mail.google.com');
    logMessage('  → Navigate to ezCater: https://www.ezcater.com/caterer_portal/sign_in');
    logMessage('  → Configure any accounts or settings you need');
    logMessage('');
    logMessage('The browser will stay open until you manually close it.');
    logMessage('When you close the browser window, the setup mode will exit automatically.');
    logMessage('Press Ctrl+C in the terminal to exit the setup mode at any time.');
    logMessage('');

    // Handle browser disconnection (user closes browser manually) - exit process
    let isExiting = false;
    browser.on('disconnected', () => {
      if (isExiting) {
        return; // Prevent multiple calls
      }
      isExiting = true;
      
      logMessage('');
      logMessage('Browser was closed manually by user');
      logMessage('Exiting setup mode...');
      logMessage('');
      
      browser = null; // Clear reference since browser is closed
      process.exit(0);
    });

    // Set up signal handlers to exit gracefully when user presses Ctrl+C
    const exitSetup = async () => {
      if (isExiting) {
        return; // Prevent multiple calls
      }
      isExiting = true;
      
      logMessage('');
      logMessage('Exiting setup mode...');
      
      // Only try to close browser if it's still connected
      // The script should NOT close the browser automatically, but if user presses Ctrl+C
      // we should clean up resources
      if (browser && browser.isConnected()) {
        try {
          await browser.close();
          logMessage('Browser closed.');
        } catch (closeError: any) {
          // Browser might already be closed, ignore error
        }
      }
      
      logMessage('Setup mode exited.');
      process.exit(0);
    };

    process.on('SIGINT', exitSetup);
    process.on('SIGTERM', exitSetup);

    // Wait indefinitely (user will close browser manually or press Ctrl+C to exit)
    // The process will exit automatically when browser is closed (handled by disconnected event)
    await new Promise<void>((resolve) => {
      // This promise never resolves, keeping the process alive
      // The process will exit when:
      // 1. User closes browser manually (disconnected event)
      // 2. User presses Ctrl+C (signal handlers)
    });

  } catch (error: any) {
    logMessage(`Setup mode error: ${error.message}`, 'ERROR');
    logMessage(error.stack, 'ERROR');
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

/**
 * Main integrated test function - Single browser instance for everything
 */
async function testIntegrated(): Promise<void> {
  let browser: puppeteer.Browser | null = null;
  let page: puppeteer.Page | null = null;
  let profile: any = null; // BrowserProfile from InitBrowserResult

  try {
    logMessage('=== Starting INTEGRATED Test (Single Browser Instance) ===');
    logMessage('');

    // Step 1: Load configuration
    logMessage('Step 1: Loading configuration...');
    const config = loadConfig();
    
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

    // Filter accounts based on CLI argument if provided
    const cliAccounts = getCliAccountsArg();
    let accountsToProcess = config.accounts;
    
    if (cliAccounts) {
      logMessage(`Filtering accounts based on CLI argument: ${cliAccounts.join(', ')}`);
      const cliAccountsSet = new Set(cliAccounts.map(acc => acc.toLowerCase()));
      accountsToProcess = config.accounts.filter(account => 
        cliAccountsSet.has(account.username.toLowerCase())
      );
      
      if (accountsToProcess.length === 0) {
        logMessage('ERROR: No matching accounts found for the specified usernames', 'ERROR');
        logMessage(`  Requested accounts: ${cliAccounts.join(', ')}`, 'ERROR');
        logMessage(`  Available accounts: ${config.accounts.map(a => a.username).join(', ')}`, 'ERROR');
        process.exit(1);
      }
      
      // Check for accounts that were requested but not found
      const foundUsernames = new Set(accountsToProcess.map(a => a.username.toLowerCase()));
      const notFound = cliAccounts.filter(acc => !foundUsernames.has(acc.toLowerCase()));
      if (notFound.length > 0) {
        logMessage(`⚠ Warning: Some requested accounts were not found: ${notFound.join(', ')}`, 'WARNING');
        logMessage(`  Will process only the ${accountsToProcess.length} matching account(s)`, 'WARNING');
      }
    }

    logMessage(`✓ Configuration loaded`);
    logMessage(`  - Total accounts in config: ${config.accounts.length}`);
    logMessage(`  - Accounts to process: ${accountsToProcess.length}`);
    if (cliAccounts) {
      logMessage(`  - Filtered accounts: ${accountsToProcess.map(a => a.username).join(', ')}`);
    }
    logMessage(`  - Gmail: ${config.gmail.email}`);
    logMessage(`  - Email subject: ${config.gmail.subject}`);
    if (config.task.filterDate) {
      logMessage(`  - Filter date: ${config.task.filterDate}`);
    }
    if (config.task.orderCodesFile) {
      logMessage(`  - Order codes file: ${config.task.orderCodesFile}`);
    }
    logMessage('');

    // Step 2: Initialize browser using BrowserPool (SINGLE instance for all accounts)
    logMessage('Step 2: Initializing browser (using BrowserPool/initBrowser)...');
    logMessage('  → This browser instance will be reused for ALL accounts');
    const browserResult: InitBrowserResult = await initBrowser(config.task.url, 'default');

    if (!browserResult.browser || !browserResult.page) {
      logMessage(`ERROR: Failed to initialize browser: ${browserResult.error ?? 'Unknown error'}`, 'ERROR');
      process.exit(1);
    }

    browser = browserResult.browser;
    page = browserResult.page;
    const profile = browserResult.profile;

    // Check for CAPTCHA immediately after browser initialization
    logMessage('Checking for CAPTCHA after browser initialization...');
    await waitRandomTime(2000, 3000); // Wait for page to load
    const captchaCheck = await detectTurnstileCaptcha(page);
    if (captchaCheck.isPresent) {
      const errorMessage = `🚨 CAPTCHA DETECTED - Process terminated\n\n` +
        `Cloudflare Turnstile CAPTCHA was detected on the page.\n` +
        `The process has been terminated to prevent automation detection.\n\n` +
        `Details:\n` +
        `- Iframe: ${captchaCheck.details?.iframeSrc || 'N/A'}\n` +
        `- Widget ID: ${captchaCheck.details?.widgetId || 'N/A'}\n` +
        `- Site Key: ${captchaCheck.details?.siteKey || 'N/A'}\n` +
        `- Timestamp: ${new Date().toISOString()}`;
      
      logMessage('CAPTCHA detected! Terminating process...', 'ERROR');
      logMessage(errorMessage, 'ERROR');
      
      // Send notification to specific Telegram chat ID
      const CAPTCHA_ALERT_CHAT_ID = '-4858164979';
      try {
        await sendMessageToTelegramChatId(CAPTCHA_ALERT_CHAT_ID, errorMessage);
        logMessage(`CAPTCHA alert sent to Telegram chat ${CAPTCHA_ALERT_CHAT_ID}`);
      } catch (telegramError: any) {
        logMessage(`Error sending CAPTCHA alert to Telegram: ${telegramError.message}`, 'ERROR');
      }
      
      // Close browser and exit
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }
      
      process.exit(1);
    }
    logMessage('✓ No CAPTCHA detected, proceeding...');

    // Mark browser as protected to prevent age check timer from closing it during process
    if (profile) {
      profile.protected = true;
      logMessage('Browser marked as protected (will not be closed by age check timer during process)');
    }

    logMessage('✓ Browser initialized using BrowserPool');
    logMessage('  → Single browser instance ready for all accounts');
    logMessage('');

    // Clean up browser tabs before starting the process
    logMessage('Cleaning up browser tabs before starting process...');
    try {
      await cleanupBrowserTabs(browser, page);
      logMessage('✓ Browser tabs cleaned up');
    } catch (cleanupError: any) {
      logMessage(`Warning: Error cleaning up tabs: ${cleanupError.message}`, 'WARNING');
    }
    logMessage('');

    // Step 3: Check initial login status and logout if needed
    logMessage('Step 3: Checking initial login status...');
    const alreadyLoggedIn = await isLoggedIn(page, config);
    
    if (alreadyLoggedIn) {
      logMessage('✓ User is already logged in, performing logout to start fresh...');
      await performLogout(page, config, browser);
      logMessage('✓ Logout completed, ready to start process');
      logMessage('');
    } else {
      logMessage('✓ User is not logged in, ready to start process');
      logMessage('');
    }

    // Step 4: Process each account in the SAME browser instance
    logMessage('Step 4: Processing accounts (using same browser instance)...');
    logMessage('');

    // Track accounts with issues for summary
    const accountsWithLoginIssues: string[] = [];
    const accountsWithNoOrders: string[] = [];
    
    // Initialize order code tracking at the start (shared across all accounts)
    // Pass CLI date to getOrderCodesFromConfig so it can find the correct clicked_orders file
    const allOrderCodes = getOrderCodesFromConfig(config, cliDate || undefined);
    if (allOrderCodes.length > 0) {
      const normalizedCodes = allOrderCodes.map(code => code.trim().toUpperCase());
      (global as any).orderCodeTracking = {
        valid: normalizedCodes,
        processed: [],  // Shared across all accounts
        notFound: []    // Shared across all accounts
      };
      logMessage('');
      logMessage('=== INITIAL ORDER CODE LIST (SHARED ACROSS ALL ACCOUNTS) ===');
      logMessage(`Total codes to process: ${normalizedCodes.length}`);
      logMessage(`Codes: ${normalizedCodes.join(', ')}`);
      logMessage('Note: Codes processed in one account will be skipped in subsequent accounts');
      logMessage('');
    }

    for (let i = 0; i < accountsToProcess.length; i++) {
      const account = accountsToProcess[i];
      logMessage('');
      logMessage(`=== Processing account ${i + 1}/${accountsToProcess.length}: ${account.username} ===`);
      logMessage('');

      try {
        // Ensure we're on sign_in page before login
        const currentUrl = page.url();
        const signInUrl = 'https://www.ezcater.com/caterer_portal/sign_in';
        
        if (!currentUrl.includes('/sign_in')) {
          logMessage(`Current page is not sign_in (${currentUrl}), navigating to sign_in...`);
          await page.goto(signInUrl, { waitUntil: 'networkidle2' });
          await waitRandomTime(2000, 3000);
        }

        // Check for CAPTCHA before attempting login
        logMessage('Checking for CAPTCHA before login...');
        const captchaCheckBeforeLogin = await detectTurnstileCaptcha(page);
        if (captchaCheckBeforeLogin.isPresent) {
          const errorMessage = `🚨 CAPTCHA DETECTED - Process terminated\n\n` +
            `Cloudflare Turnstile CAPTCHA was detected before login attempt.\n` +
            `Account: ${account.username}\n` +
            `The process has been terminated to prevent automation detection.\n\n` +
            `Details:\n` +
            `- Iframe: ${captchaCheckBeforeLogin.details?.iframeSrc || 'N/A'}\n` +
            `- Widget ID: ${captchaCheckBeforeLogin.details?.widgetId || 'N/A'}\n` +
            `- Site Key: ${captchaCheckBeforeLogin.details?.siteKey || 'N/A'}\n` +
            `- Timestamp: ${new Date().toISOString()}`;
          
          logMessage('CAPTCHA detected before login! Terminating process...', 'ERROR');
          logMessage(errorMessage, 'ERROR');
          
          // Send notification to specific Telegram chat ID
          const CAPTCHA_ALERT_CHAT_ID = '-4858164979';
          try {
            await sendMessageToTelegramChatId(CAPTCHA_ALERT_CHAT_ID, errorMessage);
            logMessage(`CAPTCHA alert sent to Telegram chat ${CAPTCHA_ALERT_CHAT_ID}`);
          } catch (telegramError: any) {
            logMessage(`Error sending CAPTCHA alert to Telegram: ${telegramError.message}`, 'ERROR');
          }
          
          // Close browser and exit
          if (browser) {
            try {
              await browser.close();
            } catch (closeError) {
              // Ignore close errors
            }
          }
          
          process.exit(1);
        }
        logMessage('✓ No CAPTCHA detected, proceeding with login...');

        // Perform login with retry logic (4 total attempts: 1 initial + 3 retries)
        const MAX_LOGIN_ATTEMPTS = 4;
        let loginResult: { success: boolean; error?: string } = { success: false };
        let loginSuccessful = false;
        
        for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
          logMessage(`Attempting login with account: ${account.username} (Attempt ${attempt}/${MAX_LOGIN_ATTEMPTS})...`);
          
          // Ensure we're on sign_in page before each login attempt
          const currentUrlBeforeLogin = page.url();
          const signInUrl = 'https://www.ezcater.com/caterer_portal/sign_in';
          
          if (!currentUrlBeforeLogin.includes('/sign_in')) {
            logMessage(`Navigating to sign_in page before login attempt ${attempt}...`);
            await page.goto(signInUrl, { waitUntil: 'networkidle2' });
            await waitRandomTime(2000, 3000);
          }
          
          // Check for CAPTCHA before each login attempt
          logMessage(`Checking for CAPTCHA before login attempt ${attempt}...`);
          const captchaCheck = await detectTurnstileCaptcha(page);
          if (captchaCheck.isPresent) {
            const errorMessage = `🚨 CAPTCHA DETECTED - Process terminated\n\n` +
              `Cloudflare Turnstile CAPTCHA was detected during login attempt ${attempt}.\n` +
              `Account: ${account.username}\n` +
              `The process has been terminated to prevent automation detection.\n\n` +
              `Details:\n` +
              `- Iframe: ${captchaCheck.details?.iframeSrc || 'N/A'}\n` +
              `- Widget ID: ${captchaCheck.details?.widgetId || 'N/A'}\n` +
              `- Site Key: ${captchaCheck.details?.siteKey || 'N/A'}\n` +
              `- Timestamp: ${new Date().toISOString()}`;
            
            logMessage('CAPTCHA detected during login! Terminating process...', 'ERROR');
            logMessage(errorMessage, 'ERROR');
            
            // Send notification to specific Telegram chat ID
            const CAPTCHA_ALERT_CHAT_ID = '-4858164979';
            try {
              await sendMessageToTelegramChatId(CAPTCHA_ALERT_CHAT_ID, errorMessage);
              logMessage(`CAPTCHA alert sent to Telegram chat ${CAPTCHA_ALERT_CHAT_ID}`);
            } catch (telegramError: any) {
              logMessage(`Error sending CAPTCHA alert to Telegram: ${telegramError.message}`, 'ERROR');
            }
            
            // Close browser and exit
            if (browser) {
              try {
                await browser.close();
              } catch (closeError) {
                // Ignore close errors
              }
            }
            
            process.exit(1);
          }
          
          // Perform logout before retry (except on first attempt if we already logged out)
          if (attempt > 1) {
            logMessage(`Performing logout before retry attempt ${attempt}...`);
            try {
              await performLogout(page, config, browser);
              await waitRandomTime(2000, 3000);
              // Ensure we're on sign_in page after logout
              const urlAfterLogout = page.url();
              if (!urlAfterLogout.includes('/sign_in')) {
                await page.goto(signInUrl, { waitUntil: 'networkidle2' });
                await waitRandomTime(2000, 3000);
              }
            } catch (logoutError: any) {
              logMessage(`Warning: Error during logout before retry: ${logoutError.message}`, 'WARNING');
              // Try to navigate to sign_in page directly
              try {
                await page.goto(signInUrl, { waitUntil: 'networkidle2' });
                await waitRandomTime(2000, 3000);
              } catch (navError) {
                // Ignore navigation errors
              }
            }
          }
          
          loginResult = await performLogin(page, browser, account, config);
          
          if (loginResult.success) {
            logMessage(`✓ Login successful with account: ${account.username} on attempt ${attempt}/${MAX_LOGIN_ATTEMPTS}`);
            loginSuccessful = true;
            break; // Exit retry loop on success
          } else {
            logMessage(`✗ Login attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} failed for account ${account.username}: ${loginResult.error}`, 'WARNING');
            
            // If this is not the last attempt, wait before retrying
            if (attempt < MAX_LOGIN_ATTEMPTS) {
              const waitTime = 3000 + (attempt * 1000); // Progressive wait: 3s, 4s, 5s
              logMessage(`Waiting ${waitTime}ms before retry attempt ${attempt + 1}...`);
              await waitRandomTime(waitTime, waitTime);
            }
          }
        }
        
        // After all attempts, check if login was successful
        if (!loginSuccessful) {
          logMessage(`✗ LOGIN FAILED for account ${account.username} after ${MAX_LOGIN_ATTEMPTS} attempts`, 'ERROR');
          logMessage(`  → Last error: ${loginResult.error}`, 'ERROR');
          logMessage(`  → Skipping account ${account.username} and continuing with next account`, 'WARNING');
          accountsWithLoginIssues.push(account.username);
          logMessage('');
          continue; // Try next account
        }
        await waitRandomTime(2000, 3000);

        // Navigate to task URL if needed
        try {
          const currentUrlAfterLogin = page.url();
          const taskUrlObj = new URL(config.task.url);
          if (!currentUrlAfterLogin.includes(taskUrlObj.hostname)) {
            logMessage('Navigating to task URL after login...');
            await page.goto(config.task.url, { waitUntil: 'networkidle2' });
            await waitRandomTime(2000, 3000);
          }
        } catch (urlError) {
          logMessage('Navigating to task URL after login...');
          await page.goto(config.task.url, { waitUntil: 'networkidle2' });
          await waitRandomTime(2000, 3000);
        }

        // Navigate to "Completed" section
        logMessage('Navigating to "Completed" section...');
        await waitRandomTime(1000, 2000);
        
        const completedSelectors = [
          'a[href="/completed"]',
          'a[data-sidebar="menu-sub-button"][href="/completed"]',
          'a:has-text("Completed")',
          'a[href="/completed"] span:has-text("Completed")',
          'a[data-sidebar="menu-sub-button"]:has-text("Completed")'
        ];
        
        let completedLink: puppeteer.ElementHandle | null = null;
        
        for (const selector of completedSelectors) {
          try {
            const elements = await page.$$(selector);
            if (elements.length > 0) {
              for (const element of elements) {
                const text = await page.evaluate(el => el.textContent || '', element);
                if (text.toLowerCase().includes('completed')) {
                  completedLink = element;
                  logMessage(`Found "Completed" link using selector: ${selector}`);
                  break;
                }
              }
              if (completedLink) break;
            }
          } catch (error) {
            continue;
          }
        }
        
        if (completedLink) {
          await page.evaluate((el) => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, completedLink);
          await waitRandomTime(500, 1000);
          await completedLink.click();
          logMessage('Clicked on "Completed" menu item');
          await waitRandomTime(2000, 3000);
          
          try {
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {});
          } catch (navError) {
            // Navigation timeout is okay
          }
          
          logMessage('Navigation to "Completed" section completed');
          await waitRandomTime(2000, 3000);

          // Wait for the order list to load completely
          logMessage('Waiting for order list to load...');
          try {
            // Wait for tbody with order rows to appear
            await page.waitForSelector('tbody tr[data-test="orderRow"]', { timeout: 10000 });
            logMessage('Order list loaded - found order rows');
            
            // Additional wait to ensure all rows are rendered
            await waitRandomTime(2000, 3000);
            
            // Verify rows are loaded by checking count
            const rowCount = await page.$$eval('tbody tr[data-test="orderRow"]', rows => rows.length);
            logMessage(`Order list loaded with ${rowCount} rows`);
          } catch (waitError: any) {
            logMessage(`Warning: Could not verify order list load: ${waitError.message}`, 'WARNING');
            // Still wait a bit before proceeding
            await waitRandomTime(2000, 3000);
          }

          // Get order codes from config (file or list)
          // Pass CLI date to getOrderCodesFromConfig so it can find the correct clicked_orders file
          const orderCodesToFilter = getOrderCodesFromConfig(config, cliDate || undefined);
          if (orderCodesToFilter.length > 0) {
            // Normalize codes
            const normalizedCodes = orderCodesToFilter.map(code => code.trim().toUpperCase());
            
            // Get already processed codes from global tracking (shared across all accounts)
            const tracking = (global as any).orderCodeTracking;
            const alreadyProcessed = tracking ? new Set(tracking.processed || []) : new Set<string>();
            
            // Filter out already processed codes for this account
            const codesToProcess = normalizedCodes.filter(code => !alreadyProcessed.has(code));
            
            logMessage('');
            logMessage(`=== PROCESSING ORDER CODES FOR ACCOUNT: ${account.username} ===`);
            logMessage(`Total codes in list: ${normalizedCodes.length}`);
            logMessage(`Already processed (from previous accounts): ${normalizedCodes.length - codesToProcess.length}`);
            logMessage(`Codes to process for this account: ${codesToProcess.length}`);
            
            if (codesToProcess.length === 0) {
              logMessage(`All codes have already been processed in previous accounts, skipping this account`);
              logMessage('');
            } else {
              logMessage(`Codes to process: ${codesToProcess.join(', ')}`);
              logMessage('');
              
              // Use search-based approach to find and click orders
              logMessage(`Starting search-based order processing for ${codesToProcess.length} codes`);
              const searchResult = await searchAndClickOrderCodes(page, codesToProcess, config, account.username);
              
              // Update global tracking (shared across all accounts)
              if (typeof (global as any).orderCodeTracking !== 'undefined') {
                const globalTracking = (global as any).orderCodeTracking;
                
                // First, add processed codes
                globalTracking.processed = [...new Set([...globalTracking.processed, ...searchResult.processed])];
                
                // Remove any codes from notFound that are now in processed
                const processedSet = new Set(globalTracking.processed);
                globalTracking.notFound = (globalTracking.notFound || []).filter((code: string) => !processedSet.has(code));
                
                // Then, add new notFound codes (only if not already processed)
                for (const notFoundCode of searchResult.notFound) {
                  if (!processedSet.has(notFoundCode) && !globalTracking.notFound.includes(notFoundCode)) {
                    globalTracking.notFound.push(notFoundCode);
                  }
                }
              }
              
              logMessage(`Search processing complete: ${searchResult.clicked} clicked, ${searchResult.notFound.length} not found`);
              
              // Check if account has no orders: if NO codes were found (all codes not found)
              // A account is considered to have no orders only if NONE of the codes were found
              if (searchResult.clicked === 0 && searchResult.notFound.length === codesToProcess.length) {
                logMessage(`⚠ Account ${account.username} has no orders: None of the ${codesToProcess.length} codes were found in this account`, 'WARNING');
                accountsWithNoOrders.push(account.username);
              } else if (searchResult.notFound.length > 0) {
                logMessage(`Codes not found for account ${account.username}: ${searchResult.notFound.join(', ')}`, 'WARNING');
                logMessage(`  → Account ${account.username} found ${searchResult.clicked} order(s) out of ${codesToProcess.length} codes`);
              } else {
                logMessage(`✓ Account ${account.username} found all ${searchResult.clicked} order(s)`);
              }
            }
          } else {
            logMessage(`⚠ No order codes to process for account ${account.username}`, 'WARNING');
            logMessage(`  → Account ${account.username} was opened successfully but no order codes were found in config/file`, 'WARNING');
            logMessage(`  → This may be normal if no order codes are configured for this account`, 'WARNING');
            accountsWithNoOrders.push(account.username);
          }
        } else {
          logMessage('Warning: "Completed" menu item not found', 'WARNING');
        }
        
        // Perform logout after processing each account (but keep browser open)
        logMessage(`All orders processed for account: ${account.username}, performing logout...`);
        try {
          await performLogout(page, config, browser);
          logMessage(`✓ Logout completed for account: ${account.username}`);
        } catch (logoutError: any) {
          logMessage(`Error during logout for account ${account.username}: ${logoutError.message}`, 'WARNING');
          // Try to navigate to sign_in page directly
          try {
            await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
          } catch (navError) {
            // Ignore navigation errors
          }
        }
        logMessage('');
        
      } catch (accountError: any) {
        logMessage(`Error processing account ${account.username}: ${accountError.message}`, 'WARNING');
        // Try to logout anyway
        try {
          await performLogout(page, config, browser);
        } catch (logoutError) {
          // Ignore logout errors
        }
        continue; // Try next account
      }
    }
    
    // Step 5: Display statistics after processing all accounts
    logMessage('');
    logMessage('Step 5: Displaying statistics...');
    const allResults = (global as any).orderResults || [];
    if (allResults.length > 0) {
      displayStatistics(allResults);
    } else {
      logMessage('No orders were processed');
    }

    logMessage('');
    logMessage('=== ACCOUNT PROCESSING SUMMARY ===');
    if (accountsWithLoginIssues.length > 0) {
      logMessage(`⚠ Accounts with login problems (${accountsWithLoginIssues.length}):`, 'WARNING');
      for (const account of accountsWithLoginIssues) {
        logMessage(`  - ${account}`, 'WARNING');
      }
      logMessage('');
    } else {
      logMessage('✓ All accounts logged in successfully');
      logMessage('');
    }
    
    if (accountsWithNoOrders.length > 0) {
      logMessage(`⚠ Accounts with no orders found (${accountsWithNoOrders.length}):`, 'WARNING');
      for (const account of accountsWithNoOrders) {
        logMessage(`  - ${account}`, 'WARNING');
      }
      logMessage('');
    }
    
    // Display order code tracking summary
    logMessage('');
    logMessage('=== ORDER CODE TRACKING SUMMARY ===');
    if (typeof (global as any).orderCodeTracking !== 'undefined') {
      const tracking = (global as any).orderCodeTracking;
      
      // Clean up notFound: remove any codes that are in processed
      const processedSet = new Set(tracking.processed || []);
      tracking.notFound = (tracking.notFound || []).filter((code: string) => !processedSet.has(code));
      
      logMessage(`Total valid codes: ${tracking.valid.length}`);
      logMessage(`Codes processed: ${tracking.processed.length}`);
      logMessage(`Codes not found: ${tracking.notFound.length}`);
      logMessage('');
      
      if (tracking.valid.length > 0) {
        logMessage(`Valid codes: ${tracking.valid.join(', ')}`);
        logMessage('');
      }
      
      if (tracking.processed.length > 0) {
        logMessage(`Processed codes: ${tracking.processed.join(', ')}`);
        logMessage('');
      }
      
      if (tracking.notFound.length > 0) {
        logMessage(`⚠ Codes not found during execution (${tracking.notFound.length}):`, 'WARNING');
        logMessage(`  ${tracking.notFound.join(', ')}`, 'WARNING');
        logMessage('');
      } else {
        logMessage('✓ All codes were found and processed');
        logMessage('');
      }
    } else {
      logMessage('No order code tracking data available');
      logMessage('');
    }
    
    // Step 6: Generate unified report
    logMessage('');
    logMessage('Step 6: Generating unified report...');
    let reportPath: string = '';
    try {
      const allResults = (global as any).orderResults || [];
      const orderCodeTracking = (global as any).orderCodeTracking;
      
      const reportContent = generateUnifiedReport(
        allResults,
        config.task.filterDate,
        accountsWithNoOrders,
        accountsWithLoginIssues,
        orderCodeTracking
      );
      
      reportPath = saveUnifiedReport(reportContent, config.task.filterDate, config);
      if (reportPath) {
        logMessage(`✓ Unified report generated successfully: ${reportPath}`);
      } else {
        logMessage('⚠ Warning: Report generation completed but file may not have been saved', 'WARNING');
      }
    } catch (reportError: any) {
      logMessage(`Error generating unified report: ${reportError.message}`, 'ERROR');
      logMessage('Process will continue despite report generation error', 'WARNING');
    }
    logMessage('');

    // Step 7: Upload logs and reports to Google Drive (if enabled)
    logMessage('');
    logMessage('Step 7: Uploading logs and reports to Google Drive...');
    try {
      await uploadLogsAndReportsToGoogleDrive(config);
      logMessage('✓ Google Drive upload completed');
    } catch (uploadError: any) {
      logMessage(`Error uploading to Google Drive: ${uploadError.message}`, 'ERROR');
      logMessage('Process will continue despite Google Drive upload error', 'WARNING');
    }
    logMessage('');

    logMessage('=== INTEGRATED TEST RESULT: SUCCESS ===');
    logMessage('✓ Full process completed successfully');
    logMessage('  → All accounts processed in single browser instance');
    logMessage('');

    // Step 8: Send report .txt file to Telegram (if report was generated)
    if (reportPath) {
      try {
        const reportDate = config.task.filterDate || new Date().toISOString().split('T')[0];
        const reportPathTxt = reportPath.replace('.md', '.txt');
        
        logMessage('');
        logMessage('Step 8: Sending report to Telegram...');
        
        // Read the report file content
        const reportContent = readFileSync(reportPathTxt, 'utf8');
        
        // First, send the report content as text message (maintaining file structure)
        logMessage('Sending report content as text message...');
        await sendMessageToTelegram(reportContent);
        
        // Then, send the file
        logMessage('Sending report file...');
        await sendFileToTelegram(reportPathTxt, `📄 Reporte Unificado ${reportDate}`);
        
        logMessage('✓ Report sent to Telegram successfully (both text and file)');
      } catch (telegramError: any) {
        logMessage(`Error sending report to Telegram: ${telegramError.message}`, 'ERROR');
        logMessage('Process will continue despite Telegram error', 'WARNING');
      }
      logMessage('');
    }

    // Unmark browser as protected now that process is complete
    if (profile) {
      profile.protected = false;
      logMessage('Browser protection removed (age check timer can now close it if needed)');
    }
    
  } catch (error: any) {
    logMessage(`INTEGRATED test failed with error: ${error.message}`, 'ERROR');
    logMessage(error.stack, 'ERROR');
  } finally {
    // Unmark browser as protected in case of error
    if (profile) {
      profile.protected = false;
      logMessage('Browser protection removed (due to error or completion)');
    }
    
    // Close browser at the end
    if (browser) {
      logMessage('Closing browser...');
      try {
        await browser.close();
        logMessage('✓ Browser closed successfully');
      } catch (closeError: any) {
        logMessage(`Error closing browser: ${closeError.message}`, 'WARNING');
      }
    }
    
    logMessage('');
    logMessage('=== INTEGRATED Test Completed ===');
    logMessage('Waiting 10 seconds before finalizing process...');
    
    // Wait 10 seconds before finalizing
    await waitRandomTime(10000, 10000);
    
    logMessage('Process finalized');
    process.exit(0);
  }
}

// Main entry point
async function main(): Promise<void> {
  // Check if running in setup mode
  if (isSetupMode()) {
    await setupMode();
  } else {
    await testIntegrated();
  }
}

// Run the test
void main().catch(error => {
  logMessage(`Unhandled error: ${error.message}`, 'ERROR');
  process.exit(1);
});
