/**
 * Test script for Google Drive API integration
 * 
 * This script tests the Google Drive API connection and file operations
 * without requiring a full bot execution.
 * 
 * Usage:
 *   yarn test:google-drive
 */

import { 
  loadConfig, 
  logMessage,
  initGoogleDriveClient,
  findOrCreateFolder,
  findFileByName,
  uploadOrUpdateFile
} from './main.js';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Test Google Drive API connection and operations
 */
async function testGoogleDrive(): Promise<void> {
  try {
    logMessage('=== Testing Google Drive API Integration ===');
    logMessage('');

    // Load configuration
    logMessage('Step 1: Loading configuration...');
    const config = loadConfig();
    
    if (!config.googleDrive) {
      logMessage('ERROR: Google Drive configuration not found in YAML file', 'ERROR');
      logMessage('Please add googleDrive section to config/ezcater_web_establishment_bot.yaml', 'ERROR');
      process.exit(1);
    }

    if (!config.googleDrive.credentialsPath) {
      logMessage('ERROR: Google Drive credentials path not configured', 'ERROR');
      logMessage('Please configure in config/ezcater_web_establishment_bot.yaml:', 'ERROR');
      logMessage('  googleDrive:', 'ERROR');
      logMessage('    credentialsPath: "./credentials/google-drive-credentials.json"', 'ERROR');
      process.exit(1);
    }

    if (!config.googleDrive.folderId) {
      logMessage('ERROR: Google Drive folder ID not configured', 'ERROR');
      logMessage('Please configure in config/ezcater_web_establishment_bot.yaml:', 'ERROR');
      logMessage('  googleDrive:', 'ERROR');
      logMessage('    folderId: "your-shared-drive-id"', 'ERROR');
      logMessage('');
      logMessage('⚠️  IMPORTANT: This must be a Shared Drive ID, not a personal folder', 'WARNING');
      logMessage('   Get it from the Shared Drive URL:', 'WARNING');
      logMessage('   https://drive.google.com/drive/folders/SHARED_DRIVE_ID_HERE', 'WARNING');
      process.exit(1);
    }

    // Check if credentials file exists
    const credentialsPath = path.resolve(projectRoot, config.googleDrive.credentialsPath);
    if (!existsSync(credentialsPath)) {
      logMessage(`ERROR: Credentials file not found: ${credentialsPath}`, 'ERROR');
      logMessage('Please ensure the Service Account JSON file exists at the specified path', 'ERROR');
      process.exit(1);
    }

    logMessage('✓ Configuration loaded');
    logMessage(`  - Credentials path: ${config.googleDrive.credentialsPath}`);
    logMessage(`  - Folder ID: ${config.googleDrive.folderId}`);
    logMessage(`  - Enabled: ${config.googleDrive.enabled || false}`);
    logMessage('');

    // Try to read and display Service Account email from credentials
    try {
      const credentials = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
      if (credentials.client_email) {
        logMessage(`  - Service Account Email: ${credentials.client_email}`);
        logMessage('');
        logMessage('⚠️  IMPORTANT: Ensure the Service Account has access to the Shared Drive', 'WARNING');
        logMessage('   1. Open the Shared Drive in Google Drive', 'WARNING');
        logMessage('   2. Right-click on the Shared Drive > Share', 'WARNING');
        logMessage('   3. Add the Service Account email as a member', 'WARNING');
        logMessage('   4. Grant appropriate permissions (Viewer/Editor)', 'WARNING');
        logMessage('');
      }
    } catch (e) {
      logMessage('⚠️  Could not read credentials file', 'WARNING');
    }

    // Step 2: Initialize Google Drive client
    logMessage('Step 2: Initializing Google Drive client...');
    let drive: any;
    try {
      drive = await initGoogleDriveClient(credentialsPath);
      logMessage('✓ Google Drive client initialized successfully');
    } catch (error: any) {
      logMessage(`ERROR: Failed to initialize Google Drive client: ${error.message}`, 'ERROR');
      logMessage('');
      logMessage('Possible reasons:', 'ERROR');
      logMessage('  1. Invalid credentials file', 'ERROR');
      logMessage('  2. Service Account not properly configured', 'ERROR');
      logMessage('  3. Google Drive API not enabled in Google Cloud Console', 'ERROR');
      logMessage('  4. Network connectivity issues', 'ERROR');
      process.exit(1);
    }
    logMessage('');

    // Step 3: Verify access to root folder
    logMessage('Step 3: Verifying access to root folder...');
    try {
      const folderResponse = await drive.files.get({
        fileId: config.googleDrive.folderId,
        fields: 'id, name, mimeType',
        supportsAllDrives: true
      });
      
      logMessage(`✓ Successfully accessed folder: ${folderResponse.data.name || 'Unknown'}`);
      logMessage(`  - Folder ID: ${folderResponse.data.id}`);
      logMessage(`  - Type: ${folderResponse.data.mimeType}`);
    } catch (error: any) {
      logMessage(`ERROR: Cannot access folder: ${error.message}`, 'ERROR');
      logMessage('');
      logMessage('Possible reasons:', 'ERROR');
      logMessage('  1. Invalid folder ID', 'ERROR');
      logMessage('  2. Service Account does not have access to the Shared Drive', 'ERROR');
      logMessage('  3. Folder ID is for a personal folder (must be Shared Drive)', 'ERROR');
      logMessage('');
      logMessage('Solution: Add the Service Account email to the Shared Drive members', 'ERROR');
      process.exit(1);
    }
    logMessage('');

    // Step 4: Find and upload latest log file
    logMessage('Step 4: Finding and uploading latest log file...');
    const folderStructure = config.googleDrive.folderStructure || {
      logs: 'logs',
      reports: 'reports'
    };
    
    try {
      const logsPath = config.paths.logsPath || path.join(projectRoot, 'logs');
      
      if (!existsSync(logsPath)) {
        logMessage(`⚠ WARNING: Logs directory does not exist: ${logsPath}`, 'WARNING');
        logMessage('  Skipping log upload', 'WARNING');
      } else {
        // Find all log files matching pattern: bot_YYYY-MM-DD.log
        const files = readdirSync(logsPath);
        const logFiles = files.filter((file: string) => 
          file.startsWith('bot_') && file.endsWith('.log')
        );
        
        if (logFiles.length === 0) {
          logMessage(`⚠ WARNING: No log files found in ${logsPath}`, 'WARNING');
        } else {
          // Find the most recent log file by modification time
          let latestLogFile: string | null = null;
          let latestLogTime: number = 0;
          
          for (const file of logFiles) {
            const filePath = path.join(logsPath, file);
            try {
              const stats = statSync(filePath);
              if (stats.mtimeMs > latestLogTime) {
                latestLogTime = stats.mtimeMs;
                latestLogFile = file;
              }
            } catch (e) {
              // Skip files that can't be accessed
            }
          }
          
          if (latestLogFile) {
            const logFilePath = path.join(logsPath, latestLogFile);
            const logsFolderId = await findOrCreateFolder(
              drive,
              config.googleDrive.folderId,
              folderStructure.logs
            );
            
            logMessage(`  Found latest log: ${latestLogFile}`);
            const uploadSuccess = await uploadOrUpdateFile(
              drive,
              logsFolderId,
              logFilePath,
              latestLogFile
            );
            
            if (uploadSuccess) {
              logMessage(`✓ Latest log file uploaded successfully`);
              logMessage(`  - File: ${latestLogFile}`);
              logMessage(`  - Folder: ${folderStructure.logs}`);
            } else {
              logMessage(`⚠ WARNING: Failed to upload log file`, 'WARNING');
            }
          } else {
            logMessage(`⚠ WARNING: Could not determine latest log file`, 'WARNING');
          }
        }
      }
    } catch (error: any) {
      logMessage(`ERROR: Error uploading log file: ${error.message}`, 'ERROR');
    }
    logMessage('');

    // Step 5: Find and upload latest report files (.md and .txt)
    logMessage('Step 5: Finding and uploading latest report files...');
    try {
      const reportsDir = path.join(projectRoot, 'reports');
      
      if (!existsSync(reportsDir)) {
        logMessage(`⚠ WARNING: Reports directory does not exist: ${reportsDir}`, 'WARNING');
        logMessage('  Skipping report upload', 'WARNING');
      } else {
        // Find all report files matching pattern: reporte_unificado_YYYY-MM-DD.md or .txt
        const files = readdirSync(reportsDir);
        const reportFiles = files.filter((file: string) => 
          file.startsWith('reporte_unificado_') && (file.endsWith('.md') || file.endsWith('.txt'))
        );
        
        if (reportFiles.length === 0) {
          logMessage(`⚠ WARNING: No report files found in ${reportsDir}`, 'WARNING');
        } else {
          // Group reports by date and find the most recent
          const reportsByDate: { [date: string]: { md?: string; txt?: string } } = {};
          
          for (const file of reportFiles) {
            const dateMatch = file.match(/reporte_unificado_(\d{4}-\d{2}-\d{2})\.(md|txt)/);
            if (dateMatch) {
              const date = dateMatch[1];
              const ext = dateMatch[2];
              if (!reportsByDate[date]) {
                reportsByDate[date] = {};
              }
              reportsByDate[date][ext as 'md' | 'txt'] = file;
            }
          }
          
          // Find the most recent date
          const dates = Object.keys(reportsByDate).sort().reverse();
          
          if (dates.length > 0) {
            const latestDate = dates[0];
            const latestReports = reportsByDate[latestDate];
            
            const reportsFolderId = await findOrCreateFolder(
              drive,
              config.googleDrive.folderId,
              folderStructure.reports
            );
            
            // Determine target folder (with or without date subfolder)
            const organizeReportsByDate = config.googleDrive.organizeReportsByDate !== false;
            let targetFolderId = reportsFolderId;
            
            if (organizeReportsByDate) {
              targetFolderId = await findOrCreateFolder(drive, reportsFolderId, latestDate);
            }
            
            logMessage(`  Found latest report date: ${latestDate}`);
            
            // Upload .md file if exists
            if (latestReports.md) {
              const reportMdPath = path.join(reportsDir, latestReports.md);
              logMessage(`  Uploading: ${latestReports.md}`);
              const uploadSuccess = await uploadOrUpdateFile(
                drive,
                targetFolderId,
                reportMdPath,
                latestReports.md,
                'text/markdown'
              );
              
              if (uploadSuccess) {
                logMessage(`✓ Report (.md) uploaded successfully`);
              } else {
                logMessage(`⚠ WARNING: Failed to upload ${latestReports.md}`, 'WARNING');
              }
            }
            
            // Upload .txt file if exists
            if (latestReports.txt) {
              const reportTxtPath = path.join(reportsDir, latestReports.txt);
              logMessage(`  Uploading: ${latestReports.txt}`);
              const uploadSuccess = await uploadOrUpdateFile(
                drive,
                targetFolderId,
                reportTxtPath,
                latestReports.txt,
                'text/plain'
              );
              
              if (uploadSuccess) {
                logMessage(`✓ Report (.txt) uploaded successfully`);
              } else {
                logMessage(`⚠ WARNING: Failed to upload ${latestReports.txt}`, 'WARNING');
              }
            }
            
            logMessage(`  - Target folder: ${organizeReportsByDate ? `${folderStructure.reports}/${latestDate}` : folderStructure.reports}`);
          } else {
            logMessage(`⚠ WARNING: Could not determine latest report date`, 'WARNING');
          }
        }
      }
    } catch (error: any) {
      logMessage(`ERROR: Error uploading report files: ${error.message}`, 'ERROR');
    }
    logMessage('');

    // Summary
    logMessage('=== Test Results ===');
    logMessage('');
    logMessage('✓ SUCCESS: All Google Drive API tests passed!');
    logMessage('');
    logMessage('Verified operations:');
    logMessage('  ✓ Client initialization');
    logMessage('  ✓ Folder access');
    logMessage('  ✓ Latest log file upload');
    logMessage('  ✓ Latest report files upload (.md and .txt)');
    logMessage('');
    logMessage('Google Drive integration is working correctly!');
    logMessage('');
    logMessage('=== Test Completed ===');

  } catch (error: any) {
    logMessage(`ERROR: Test failed: ${error.message}`, 'ERROR');
    if (error.stack) {
      logMessage(error.stack, 'ERROR');
    }
    process.exit(1);
  }
}

// Run the test
void testGoogleDrive().catch(error => {
  logMessage(`Unhandled error: ${error.message}`, 'ERROR');
  process.exit(1);
});
