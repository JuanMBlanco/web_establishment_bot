/**
 * Test script for Gmail API integration
 * 
 * This script tests the Gmail API connection and email search functionality
 * without requiring a full login process.
 * 
 * Usage:
 *   yarn test:gmail-api
 */

import { loadConfig, logMessage } from './main.js';
import { getVerificationCodeFromGmailAPI } from './main.js';
import type { BotConfig, Account } from './main.js';
import { readFileSync, existsSync } from 'fs';

/**
 * Test Gmail API connection and search
 */
async function testGmailAPI(): Promise<void> {
  try {
    logMessage('=== Testing Gmail API Integration ===');
    logMessage('');

    // Load configuration
    logMessage('Step 1: Loading configuration...');
    const config = loadConfig();
    
    if (!config.gmail) {
      logMessage('ERROR: Gmail configuration not found in YAML file', 'ERROR');
      logMessage('Please add gmail section to config/ezcater_web_establishment_bot.yaml', 'ERROR');
      process.exit(1);
    }

    if (!config.googleDrive?.credentialsPath || !config.googleDrive?.gmailUserEmail) {
      logMessage('ERROR: Gmail API credentials not configured', 'ERROR');
      logMessage('Please configure in config/ezcater_web_establishment_bot.yaml:', 'ERROR');
      logMessage('  googleDrive:', 'ERROR');
      logMessage('    credentialsPath: "./credentials/google-drive-credentials.json"', 'ERROR');
      logMessage('    gmailUserEmail: "your-email@domain.com"', 'ERROR');
      process.exit(1);
    }

    logMessage('✓ Configuration loaded');
    logMessage(`  - Gmail user: ${config.googleDrive.gmailUserEmail}`);
    logMessage(`  - Credentials path: ${config.googleDrive.credentialsPath}`);
    logMessage(`  - Email subject: ${config.gmail.subject}`);
    
    // Try to read and display Client ID from credentials
    try {
      const credentialsPath = config.googleDrive.credentialsPath;
      if (existsSync(credentialsPath)) {
        const credentials = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
        if (credentials.client_id) {
          logMessage(`  - Service Account Client ID: ${credentials.client_id}`);
          logMessage('');
          logMessage('⚠️  IMPORTANT: If you see "unauthorized_client" error:');
          logMessage('   1. Go to Google Workspace Admin Console');
          logMessage('   2. Security > API Controls > Domain-wide Delegation');
          logMessage('   3. Add Client ID: ' + credentials.client_id);
          logMessage('   4. Add Scope: https://www.googleapis.com/auth/gmail.readonly');
          logMessage('   5. See GMAIL_API_SETUP.md for detailed instructions');
          logMessage('');
        }
      }
    } catch (e) {
      // Ignore errors reading credentials
    }
    
    logMessage('');

    // Test with a sample account (optional - for label testing)
    const testAccount: Account | undefined = config.accounts && config.accounts.length > 0
      ? {
          username: config.accounts[0].username,
          password: '', // Not needed for API test
          gmailLabel: config.accounts[0].gmailLabel
        }
      : undefined;

    if (testAccount?.gmailLabel) {
      logMessage(`Testing with account label: "${testAccount.gmailLabel}"`);
      logMessage('');
    }

    // Test Gmail API
    logMessage('Step 2: Testing Gmail API connection...');
    logMessage('');

    const code = await getVerificationCodeFromGmailAPI(config, testAccount);

    logMessage('');
    logMessage('=== Test Results ===');
    
    if (code) {
      logMessage(`✓ SUCCESS: Verification code found: ${code}`);
      logMessage('');
      logMessage('Gmail API integration is working correctly!');
    } else {
      logMessage('⚠ WARNING: No verification code found', 'WARNING');
      logMessage('');
      logMessage('Possible reasons:');
      logMessage('  1. No emails matching the search criteria');
      logMessage('  2. Domain-Wide Delegation not configured');
      logMessage('  3. Gmail API not enabled in Google Cloud Console');
      logMessage('  4. Label filter too restrictive');
      logMessage('  5. Email subject or format has changed');
      logMessage('');
      logMessage('Check the logs above for more details.');
    }

    logMessage('');
    logMessage('=== Test Completed ===');

  } catch (error: any) {
    logMessage(`ERROR: Test failed: ${error.message}`, 'ERROR');
    logMessage(error.stack, 'ERROR');
    process.exit(1);
  }
}

// Run the test
void testGmailAPI().catch(error => {
  logMessage(`Unhandled error: ${error.message}`, 'ERROR');
  process.exit(1);
});
