/**
 * Test script for login functionality with Gmail verification
 * 
 * Usage: yarn test:login
 * 
 * This script tests the login flow including:
 * - Loading configuration
 * - Initializing browser
 * - Checking login status
 * - Performing login with username/password
 * - Retrieving verification code from Gmail
 * - Entering verification code
 */

import { 
  loadConfig, 
  isLoggedIn, 
  performLogin, 
  getVerificationCodeFromGmail,
  logMessage,
  waitRandomTime,
  type BotConfig,
  type Account,
  initBrowser,
  type InitBrowserResult
} from './main.js';

/**
 * Main test function
 */
async function testLogin(): Promise<void> {
  try {
    logMessage('=== Starting Login Test ===');
    logMessage('');

    // Load configuration
    logMessage('Step 1: Loading configuration...');
    const config = loadConfig();

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

    logMessage(`✓ Configuration loaded`);
    logMessage(`  - Found ${config.accounts.length} account(s)`);
    logMessage(`  - Gmail: ${config.gmail.email}`);
    logMessage(`  - Email subject: ${config.gmail.subject}`);
    logMessage('');

    // Initialize browser using the same pool/profile logic as main process
    logMessage('Step 2: Initializing browser (using BrowserPool/initBrowser)...');
    const browserResult: InitBrowserResult = await initBrowser(config.task.url, 'default');

    if (!browserResult.browser || !browserResult.page) {
      logMessage(`ERROR: Failed to initialize browser: ${browserResult.error ?? 'Unknown error'}`, 'ERROR');
      process.exit(1);
    }

    const browser = browserResult.browser;
    const page = browserResult.page;

    logMessage('✓ Browser initialized using BrowserPool');
    logMessage('');

    // Check if already logged in
    logMessage('Step 3: Checking login status...');
    const alreadyLoggedIn = await isLoggedIn(page, config);
    
    if (alreadyLoggedIn) {
      logMessage('✓ User is already logged in (detected by indicators)');
      logMessage('');
      logMessage('Performing automatic logout to test full login flow...');
      
      // Import performLogout dynamically (it's not exported, so we'll need to export it or use a workaround)
      // For now, let's manually perform logout steps with improved DOM search
      try {
        logMessage('Looking for footer element and user menu button to logout...');
        await waitRandomTime(1000, 2000);
        
        // First, find the footer element
        let footerElement = await page.$('div[data-sidebar="footer"]');
        let userMenuButton: any | null = null;
        
        if (!footerElement) {
          // Search in DOM using evaluate
          const footerExists = await page.evaluate(() => {
            return document.querySelector('div[data-sidebar="footer"]') !== null;
          });
          
          if (footerExists) {
            const allElements = await page.$$('div');
            for (const element of allElements) {
              const dataSidebar = await page.evaluate(el => el.getAttribute('data-sidebar'), element);
              if (dataSidebar === 'footer') {
                footerElement = element;
                logMessage('Found footer element in DOM');
                break;
              }
            }
          }
        }
        
        if (footerElement) {
          logMessage('Found footer element, searching for menu button inside...');
          // Look for menu-button inside the footer
          userMenuButton = await footerElement.$('[data-sidebar="menu-button"]') ||
                           await footerElement.$('div[data-sidebar="menu-button"]') ||
                           await footerElement.$('button[data-sidebar="menu-button"]');
          
          if (!userMenuButton) {
            // Search all children of footer
            const footerChildren = await footerElement.$$('div, button');
            for (const child of footerChildren) {
              const dataSidebar = await page.evaluate(el => el.getAttribute('data-sidebar'), child);
              if (dataSidebar === 'menu-button') {
                userMenuButton = child;
                logMessage('Found menu button inside footer');
                break;
              }
            }
          }
        }
        
        // Fallback: if footer not found, try direct search
        if (!userMenuButton) {
          logMessage('Footer not found, searching for menu button directly...', 'WARNING');
          userMenuButton = await page.$('div[data-sidebar="menu-button"]') || 
                          await page.$('button[data-sidebar="menu-button"]') ||
                          await page.$('[data-sidebar="menu-button"]');
          
          if (!userMenuButton) {
            // Search in DOM using evaluate
            const menuButtonExists = await page.evaluate(() => {
              return document.querySelector('[data-sidebar="menu-button"]') !== null;
            });
            
            if (menuButtonExists) {
              const allElements = await page.$$('div, button');
              for (const element of allElements) {
                const dataSidebar = await page.evaluate(el => el.getAttribute('data-sidebar'), element);
                if (dataSidebar === 'menu-button') {
                  userMenuButton = element;
                  break;
                }
              }
            }
          }
        }
        
        if (userMenuButton) {
          logMessage('Found user menu button, looking for clickable internal elements...');
          // Scroll into view if needed
          await page.evaluate((el) => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, userMenuButton);
          await waitRandomTime(300, 500);
          
          // Try to click on internal clickable elements first
          let clicked = false;
          try {
            // Look for section element inside the button
            const sectionElement = await userMenuButton.$('section');
            if (sectionElement) {
              logMessage('Found section element inside button, clicking...');
              await sectionElement.click();
              clicked = true;
            }
          } catch (e) {
            // Continue to try other elements
          }
          
          // If section click didn't work, try clicking on the button itself
          if (!clicked) {
            try {
              // Try to find any clickable child element
              const clickableChild = await userMenuButton.$('div, span, section');
              if (clickableChild) {
                logMessage('Found clickable child element, clicking...');
                await clickableChild.click();
                clicked = true;
              }
            } catch (e) {
              // Continue to fallback
            }
          }
          
          // Fallback: click on the button itself
          if (!clicked) {
            logMessage('Clicking on button container directly...');
            await userMenuButton.click();
          }
          
          await waitRandomTime(1500, 2000);
          
          // Wait for menu to appear - try multiple times clicking footer/menu until sign out appears
          let signOutAppeared = false;
          const maxWaitAttempts = 5;
          for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
            try {
              // Check if sign out link exists in DOM
              const signOutExists = await page.evaluate(() => {
                return document.querySelector('a[href*="/sessions/"]') !== null ||
                       Array.from(document.querySelectorAll('a')).some(link => {
                         const text = link.textContent?.trim() || '';
                         return text.toLowerCase().includes('sign out') || text.toLowerCase().includes('logout');
                       });
              });
              
              if (signOutExists) {
                signOutAppeared = true;
                logMessage('Sign out link appeared in DOM');
                break;
              }
              
              // If not found, wait a bit and try clicking footer or menu button again
              if (attempt < maxWaitAttempts - 1) {
                logMessage(`Sign out not found yet, attempt ${attempt + 1}/${maxWaitAttempts}, trying to click footer/menu again...`);
                
                // Try clicking footer if we have it
                if (footerElement) {
                  try {
                    await footerElement.click();
                    await waitRandomTime(500, 800);
                  } catch (e) {
                    // Ignore errors
                  }
                }
                
                // Try clicking menu button again
                if (userMenuButton) {
                  try {
                    // Try clicking internal elements
                    const sectionElement = await userMenuButton.$('section');
                    if (sectionElement) {
                      await sectionElement.click();
                    } else {
                      await userMenuButton.click();
                    }
                    await waitRandomTime(500, 800);
                  } catch (e) {
                    // Ignore errors
                  }
                }
              }
              
              await waitRandomTime(500, 800);
            } catch (e) {
              // Continue to next attempt
            }
          }
          
          await waitRandomTime(500, 1000);
          
          // Find and click sign out link - multiple strategies
          let signOutLink = await page.$('a[href*="/sessions/"]');
          
          if (!signOutLink) {
            // Search in DOM by text
            const linkInfo = await page.evaluate(() => {
              const allLinks = document.querySelectorAll('a');
              for (const link of allLinks) {
                const text = link.textContent?.trim() || '';
                const href = link.getAttribute('href') || '';
                if (text.toLowerCase().includes('sign out') || 
                    text.toLowerCase().includes('logout') ||
                    href.includes('/sessions/')) {
                  return { found: true, text, href };
                }
              }
              return { found: false, text: '', href: '' };
            });
            
            if (linkInfo.found) {
              const allLinks = await page.$$('a');
              for (const link of allLinks) {
                const text = await page.evaluate(el => el.textContent?.trim() || '', link);
                const href = await page.evaluate(el => el.getAttribute('href') || '', link);
                if (text.toLowerCase().includes('sign out') || 
                    text.toLowerCase().includes('logout') ||
                    href.includes('/sessions/')) {
                  signOutLink = link;
                  break;
                }
              }
            }
          }
          
          if (signOutLink) {
            logMessage('Found sign out link, clicking...');
            await signOutLink.click();
            await waitRandomTime(2000, 3000);
            logMessage('✓ Logout completed');
          } else {
            logMessage('Sign out link not found, navigating directly to sign_in page...', 'WARNING');
            await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
            logMessage('✓ Navigated to sign_in page');
          }
        } else {
          logMessage('User menu button not found, navigating directly to sign_in page...', 'WARNING');
          await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
          logMessage('✓ Navigated to sign_in page');
        }
      } catch (logoutError: any) {
        logMessage(`Error during logout: ${logoutError.message}`, 'WARNING');
        // Try to navigate to sign_in page anyway
        try {
          await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
          logMessage('✓ Navigated to sign_in page as fallback');
        } catch (navError) {
          // Ignore
        }
      }
      
      logMessage('✓ Logout completed, proceeding with login test...');
      logMessage('');
      
      // Wait a bit after logout
      await waitRandomTime(2000, 3000);
      
      // Navigate to sign_in page if needed
      const currentUrl = page.url();
      const signInUrl = 'https://www.ezcater.com/caterer_portal/sign_in';
      
      if (!currentUrl.includes('/sign_in')) {
        logMessage('Navigating to sign_in page...');
        await page.goto(signInUrl, { waitUntil: 'networkidle2' });
        await waitRandomTime(2000, 3000);
      }
    }

    logMessage('✗ User is not logged in, proceeding with login test');
    logMessage('');

    // Test login with each account
    logMessage('Step 4: Testing login flow...');
    let loginSuccess = false;

    for (let i = 0; i < config.accounts.length; i++) {
      const account = config.accounts[i];
      logMessage(`Attempting login with account ${i + 1}/${config.accounts.length}: ${account.username}`);
      logMessage('');

      const loginResult = await performLogin(page, browser, account, config);

      if (loginResult.success) {
        logMessage(`✓ Login successful with account: ${account.username}`);
        loginSuccess = true;
        break;
      } else {
        logMessage(`✗ Login failed: ${loginResult.error}`, 'WARNING');
        if (i < config.accounts.length - 1) {
          logMessage('Trying next account...');
          logMessage('');
        }
      }
    }

    logMessage('');

    if (loginSuccess) {
      logMessage('=== TEST RESULT: SUCCESS ===');
      logMessage('✓ Login flow completed successfully');
      logMessage('');
      
      // Verify final login status
      logMessage('Step 5: Verifying final login status...');
      const finalLoginStatus = await isLoggedIn(page, config);
      
      if (finalLoginStatus) {
        logMessage('✓ Login verification: User is logged in');
      } else {
        logMessage('⚠ Login verification: Could not confirm login status', 'WARNING');
        logMessage('  (This may be normal if loggedInIndicator is not configured)');
      }
    } else {
      logMessage('=== TEST RESULT: FAILED ===');
      logMessage('✗ Login failed with all configured accounts', 'ERROR');
      logMessage('');
      logMessage('Please check:');
      logMessage('1. Account credentials are correct');
      logMessage('2. Selectors in YAML match your website');
      logMessage('3. Gmail is accessible and has the verification email');
    }

    logMessage('');
    logMessage('Browser will remain open for 30 seconds for manual inspection...');
    logMessage('You can close it manually or wait for auto-close');
    
    await waitRandomTime(30000, 30000);
    
    logMessage('Closing browser...');
    await browser.close();
    
    logMessage('');
    logMessage('=== Test Completed ===');

  } catch (error: any) {
    logMessage(`Test failed with error: ${error.message}`, 'ERROR');
    logMessage(error.stack, 'ERROR');
    process.exit(1);
  }
}

// Run the test
testLogin().catch(error => {
  logMessage(`Unhandled error: ${error.message}`, 'ERROR');
  process.exit(1);
});
