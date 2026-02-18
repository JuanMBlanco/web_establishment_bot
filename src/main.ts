import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import { mkdirSync, writeFileSync, unlinkSync, readFileSync, statSync, accessSync, constants, appendFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';
import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { launch } from 'puppeteer-core';
import yaml from 'js-yaml';
import { Bot } from 'grammy';
import { google } from 'googleapis';
import { readdirSync } from 'fs';

interface ApiResponse {
  success: boolean;
  message: string;
  error: string | null;
  data?: undefined | string | any;
  [key: string]: any;
}

interface Token {
  token: string;
  role: string;
  description: string;
}

export interface Account {
  username: string;
  password: string;
  gmailLabel?: string;  // Gmail label to filter emails for this account
}

export interface OrderResult {
  orderCode: string;
  account: string;
  status: 'success' | 'failure';
  timestamp: Date;
  issueDetails?: string;  // Text content from Delivery Issue element (if found)
}

export interface AccountStats {
  account: string;
  orderCodes: string[];
  successCount: number;
  failureCount: number;
  totalCount: number;
  successRate: number;  // Percentage
}

export interface GmailConfig {
  email: string;
  subject: string;
  codePattern?: string;
  loginSelector?: string;
  passwordSelector?: string;
  codeInputSelector?: string;
  loginButtonSelector?: string;
  continueButtonSelector?: string;
  loggedInIndicator?: string;
  codeWaitTimeout?: number;
  maxCodeRetries?: number;
}

export interface BotConfig {
  browser: {
    executablePath: string;
    userDataPath: string;
    args: string[];
    poolSize?: number;
    checkBrowserInterval?: number;
    browserAge?: number;
  };
  viewport?: {
    width?: number;
    height?: number;
  };
  task: {
    url: string;
    checkInterval: number;
    clickSelectors?: string[];
    listSelector?: string;
    maxItemsPerCycle?: number;
    filterDate?: string;  // Date to filter orders (format: YYYY-MM-DD)
    orderCodes?: string[];  // List of specific order codes to process
    orderCodesFile?: string;  // Path to log file containing order codes
  };
  paths: {
    pidFile: string;
    dataPath: string;
    logsPath?: string;  // Path for log files (optional, defaults to ./logs)
  };
  server: {
    basePath: string;
    port: number;
  };
  cleanup?: {
    days?: number;
  };
  tokens?: Token[];
  accounts?: Account[];
  gmail?: GmailConfig;
  googleDrive?: {
    credentialsPath: string;
    folderId: string;
    enabled: boolean;
    uploadIntervalHours?: number;
    folderStructure?: {
      logs: string;
      reports: string;
    };
    organizeReportsByDate?: boolean;
    gmailUserEmail?: string;  // For Domain-Wide Delegation (optional)
    useGmailAPI?: boolean;  // Use Gmail API instead of Puppeteer for verification codes
  };
}

let validTokens: Token[] = [];
let telegramBot: Bot | null = null;
let telegramChatIds: string[] = [];
let taskInterval: NodeJS.Timeout | null = null;
let logFileHandle: string | null = null; // Current log file path
let logQueue: string[] = []; // Queue for async log writing
let logWriting = false; // Flag to prevent concurrent writes

/**
 * Initialize log file system
 */
export function initializeLogFile(config: BotConfig): void {
  try {
    const logsPath = config.paths.logsPath || path.join(projectRoot, 'logs');
    
    // Create logs directory if it doesn't exist
    if (!existsSync(logsPath)) {
      mkdirSync(logsPath, { recursive: true });
    }

    // Generate log file name with current date
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const logFileName = `bot_${dateStr}.log`;
    logFileHandle = path.join(logsPath, logFileName);

    // Write header to log file if it's a new file
    if (!existsSync(logFileHandle)) {
      const header = `\n${'='.repeat(80)}\n`;
      const startTime = now.toISOString();
      const headerContent = `${header}EZCater Web Establishment Bot - Log File Started\n`;
      const headerInfo = `Date: ${dateStr}\nStart Time: ${startTime}\n${'='.repeat(80)}\n\n`;
      appendFileSync(logFileHandle, headerContent + headerInfo);
    }
  } catch (error: any) {
    console.error(`Failed to initialize log file: ${error.message}`);
    logFileHandle = null;
  }
}

/**
 * Write log entry to file asynchronously
 */
function writeLogToFile(logEntry: string): void {
  if (!logFileHandle) {
    return;
  }

  // Add to queue
  logQueue.push(logEntry);

  // Process queue if not already processing
  if (!logWriting) {
    processLogQueue();
  }
}

/**
 * Process log queue asynchronously
 */
async function processLogQueue(): Promise<void> {
  if (logWriting || logQueue.length === 0) {
    return;
  }

  logWriting = true;

  try {
    while (logQueue.length > 0) {
      const entry = logQueue.shift();
      if (entry && logFileHandle) {
        try {
          appendFileSync(logFileHandle, entry + '\n');
        } catch (error: any) {
          // If file write fails, try to reinitialize
          console.error(`Failed to write to log file: ${error.message}`);
          logFileHandle = null;
          break;
        }
      }
    }
  } finally {
    logWriting = false;
  }
}

/**
 * Custom logging function with timestamp, colored output, and file logging
 */
export function logMessage(message: string, level: string = 'INFO'): void {
  const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m'
  };

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}:${seconds}`;

  const isPM2 = typeof process.env.PM2_HOME !== 'undefined' ||
    process.env.PM2_JSON_PROCESSING === 'true' ||
    process.env.pm_id !== undefined;

  const supportsColor = !isPM2 && process.stdout.isTTY && !process.env.NO_COLOR;

  const timestamp = `[${dateStr} ${timeStr}]`;
  const levelFormatted = `[${level}]`;

  let logEntry;

  if (supportsColor) {
    let colorCode = '';
    switch (level) {
      case 'INFO':
        colorCode = colors.green;
        break;
      case 'ERROR':
        colorCode = colors.red;
        break;
      case 'WARNING':
        colorCode = colors.yellow;
        break;
      default:
        colorCode = colors.reset;
    }
    logEntry = `${timestamp} ${colorCode}${levelFormatted}${colors.reset} ${message}`;
  } else {
    logEntry = `${timestamp} ${levelFormatted} ${message}`;
  }

  if (isPM2) {
    if (level === 'ERROR') {
      process.stderr.write(logEntry + '\n');
    } else {
      process.stdout.write(logEntry + '\n');
    }
  } else {
    if (level === 'ERROR') {
      console.error(logEntry);
    } else if (level === 'WARNING') {
      console.warn(logEntry);
    } else {
      console.log(logEntry);
    }
  }

  // Write to file (plain text, no colors)
  const fileLogEntry = `${timestamp} ${levelFormatted} ${message}`;
  writeLogToFile(fileLogEntry);
}

/**
 * Interface representing a browser profile in the pool
 */
interface BrowserProfile {
  profile: string;
  pid: string;
  instance: number;
  browser: puppeteer.Browser | null;
  usedSince: Date | null;
  protected?: boolean; // Flag to prevent browser from being closed during active process
}

/**
 * Class to manage a pool of browser profiles
 */
class BrowserPool {
  private available: BrowserProfile[] = [];
  private used: BrowserProfile[] = [];
  private config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.initPool();
  }

  private initPool(): void {
    const poolSize = this.config.browser.poolSize || 3;

    for (let i = 1; i <= poolSize; i++) {
      const instanceNum = i.toString().padStart(2, '0');
      const profile: BrowserProfile = {
        instance: i,
        profile: this.getProfilePath(instanceNum),
        pid: this.getPidFilePath(instanceNum),
        browser: null,
        usedSince: null
      };
      this.available.push(profile);
    }

    logMessage(`Initialized browser pool with ${poolSize} profiles`);
  }

  private getProfilePath(instanceNum: string): string {
    return this.config.browser.userDataPath.replaceAll('{__instance__}', instanceNum);
  }

  private getPidFilePath(instanceNum: string): string {
    const profilePath = this.getProfilePath(instanceNum);
    return `${profilePath}/pid.txt`;
  }

  getBrowserProfile(context: string): BrowserProfile | null {
    if (this.available.length === 0) {
      logMessage("No available browser profiles in pool");
      return null;
    }

    const profile = this.available.shift()!;
    profile.profile = profile.profile.replaceAll('{__context__}', context);
    profile.pid = profile.pid.replaceAll('{__context__}', context);
    profile.usedSince = new Date();
    this.used.push(profile);

    logMessage(`Allocated browser profile: ${profile.profile}, remaining: ${this.available.length}`);
    return profile;
  }

  returnBrowserProfile(profile: BrowserProfile, deleteFile: boolean = true): void {
    const index = this.used.findIndex(p => p.instance === profile.instance);

    if (index !== -1) {
      this.used.splice(index, 1);

      if (deleteFile && fileExists(profile.pid)) {
        try {
          unlinkSync(profile.pid);
          logMessage(`Deleted PID file: ${profile.pid}`);
        } catch (error) {
          logMessage(`Failed to delete PID file: ${profile.pid}: ${error}`, 'ERROR');
        }
      }

      const instanceNum = profile.instance.toString().padStart(2, '0');
      profile.profile = this.getProfilePath(instanceNum);
      profile.pid = this.getPidFilePath(instanceNum);
      profile.browser = null;
      profile.usedSince = null;

      this.available.push(profile);
      logMessage(`Returned browser profile to pool: ${profile.instance}, available: ${this.available.length}`);
    } else {
      logMessage(`Attempted to return unknown browser profile: ${profile.instance}`, 'WARNING');
    }
  }

  get availableCount(): number {
    return this.available.length;
  }

  get usedCount(): number {
    return this.used.length;
  }

  findProfileByBrowser(browser: puppeteer.Browser): BrowserProfile | null {
    const profile = this.used.find(p => p.browser === browser);
    return profile || null;
  }

  getProfileAgeInSeconds(profile: BrowserProfile): number {
    if (!profile.usedSince) {
      return 0;
    }
    const now = new Date();
    const diffMs = now.getTime() - profile.usedSince.getTime();
    return Math.floor(diffMs / 1000);
  }

  async manageBrowserTabs(browser: puppeteer.Browser, instanceId: string | number): Promise<puppeteer.Page> {
    try {
      let pages = await browser.pages();
      let blankTabToKeep = pages.find(p => p.url() === 'about:blank' || p.url() === '');

      if (!blankTabToKeep) {
        logMessage(`No about:blank tab found for profile ${instanceId}, creating one`);
        blankTabToKeep = await browser.newPage();
      } else {
        logMessage(`Found existing about:blank tab to keep for profile ${instanceId}`);
      }

      pages = await browser.pages();

      // Do NOT close any tabs for this profile; keep all existing tabs
      logMessage(`Tab cleanup disabled for profile ${instanceId} (keeping all tabs)`);

      // Reuse the first available page or open a new one if none
      if (pages.length > 0) {
        return pages[0];
      }

      return await browser.newPage();
    } catch (error) {
      logMessage(`Error managing tabs for profile ${instanceId}: ${error}`, 'ERROR');
      return await browser.newPage();
    }
  }

  async forceCloseBrowsersOlderThan(maxTimeSeconds: number): Promise<{ processed: number, closed: number }> {
    const result = { processed: 0, closed: 0 };

    if (this.used.length === 0) {
      logMessage("No used browser profiles to check");
      return result;
    }

    logMessage(`Checking for browsers used for ${maxTimeSeconds} seconds or more`);

    const usedProfilesToCheck = [...this.used];

    for (const profile of usedProfilesToCheck) {
      const ageInSeconds = this.getProfileAgeInSeconds(profile);
      result.processed++;

      if (ageInSeconds >= maxTimeSeconds) {
        // Skip protected browsers (in active use during full process)
        if (profile.protected) {
          logMessage(`Profile ${profile.instance} is protected (in active use), skipping age check`);
          continue;
        }
        
        logMessage(`Profile ${profile.instance} has been used for ${ageInSeconds} seconds, which exceeds the limit of ${maxTimeSeconds} seconds`);

        try {
          if (profile.browser) {
            try {
              await this.manageBrowserTabs(profile.browser, profile.instance);
            } catch (tabError) {
              logMessage(`Error managing tabs for profile ${profile.instance}: ${tabError}`, 'ERROR');
            }

            try {
              logMessage(`Attempting to close browser for profile ${profile.instance}`);
              await profile.browser.close();
            } finally {
              // Avoid the error
            }
          }

          await waitRandomTime(2000, 2000);

          if (fileExists(profile.pid)) {
            try {
              const pidData = readFileSync(profile.pid, { encoding: 'utf8' });
              const pid = parseInt(pidData.trim(), 10);

              if (isRunning(pid)) {
                logMessage(`Process ${pid} for profile ${profile.instance} is still running after browser.close(), forcefully terminating`);

                try {
                  process.kill(pid);
                } catch (killError) {
                  logMessage(`Error terminating process ${pid}: ${killError}`, 'ERROR');
                }
              }
            } catch (pidError) {
              logMessage(`Error reading PID file for profile ${profile.instance}: ${pidError}`, 'ERROR');
            }
          }

          this.returnBrowserProfile(profile, true);
          result.closed++;
        } catch (error) {
          logMessage(`Error closing browser for profile ${profile.instance}: ${error}`, 'ERROR');
        }
      } else {
        logMessage(`Profile ${profile.instance} has been used for ${ageInSeconds} seconds, which is within the limit of ${maxTimeSeconds} seconds`);
      }
    }

    logMessage(`Force close operation completed. Processed: ${result.processed}, Closed: ${result.closed}`);
    return result;
  }
}

let browserPool: BrowserPool;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Check if a file exists and is executable
 */
function fileExistsAndAccessible(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find Chrome in system PATH using which/where command
 */
function findChromeInPath(): string | null {
  const platform = os.platform();
  const commands = platform === 'win32' 
    ? ['chrome.exe', 'google-chrome.exe', 'chromium.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

  for (const cmd of commands) {
    try {
      if (platform === 'win32') {
        // Use 'where' command on Windows
        const result = execSync(`where ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (result && fileExistsAndAccessible(result)) {
          return result;
        }
      } else {
        // Use 'which' command on Unix-like systems
        const result = execSync(`which ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (result && fileExistsAndAccessible(result)) {
          return result;
        }
      }
    } catch {
      // Command not found, continue to next
      continue;
    }
  }

  return null;
}

/**
 * Automatically detect Chrome executable path based on the operating system
 */
function detectChromePath(): string | null {
  const platform = os.platform();
  const possiblePaths: string[] = [];

  // First, try to find Chrome in system PATH
  const pathChrome = findChromeInPath();
  if (pathChrome) {
    logMessage(`Chrome found in system PATH: ${pathChrome}`);
    return pathChrome;
  }

  // If not in PATH, check common installation locations
  if (platform === 'win32') {
    // Windows paths
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');

    possiblePaths.push(
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
    );
  } else if (platform === 'darwin') {
    // macOS paths
    possiblePaths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
    );
  } else {
    // Linux paths
    possiblePaths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/local/bin/google-chrome',
      '/usr/local/bin/google-chrome-stable',
      '/usr/local/bin/chromium',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome'
    );
  }

  // Check each possible path
  for (const chromePath of possiblePaths) {
    if (fileExistsAndAccessible(chromePath)) {
      logMessage(`Chrome detected at: ${chromePath}`);
      return chromePath;
    }
  }

  return null;
}

/**
 * Load configuration from YAML file
 */
export function loadConfig(): BotConfig {
  try {
    const fileContents = readFileSync(path.join(projectRoot, 'config', 'ezcater_web_establishment_bot.yaml'), 'utf8');
    const config = yaml.load(fileContents) as BotConfig;

    if (config.browser.userDataPath.endsWith('/') || config.browser.userDataPath.endsWith('\\')) {
      config.browser.userDataPath = config.browser.userDataPath.slice(0, -1);
    }

    if (config.paths.dataPath.endsWith('/') || config.paths.dataPath.endsWith('\\')) {
      config.paths.dataPath = config.paths.dataPath.slice(0, -1);
    }

    if (config.paths.pidFile) {
      const pidDir = path.dirname(config.paths.pidFile);
      if (!fileExists(pidDir)) {
        logMessage(`Creating directory for PID file: ${pidDir}`);
        mkdirSync(pidDir, { recursive: true });
      }
    }

    // Auto-detect Chrome path if configured path is empty or doesn't exist
    const configuredPath = config.browser.executablePath?.trim() || '';
    
    if (!configuredPath || !fileExistsAndAccessible(configuredPath)) {
      if (configuredPath) {
        logMessage(`Configured Chrome path not found: ${configuredPath}`, 'WARNING');
      } else {
        logMessage('No Chrome path configured, attempting auto-detection...');
      }
      
      logMessage('Attempting to auto-detect Chrome...');
      
      const detectedPath = detectChromePath();
      
      if (detectedPath) {
        logMessage(`Using auto-detected Chrome path: ${detectedPath}`);
        config.browser.executablePath = detectedPath;
      } else {
        logMessage('ERROR: Could not auto-detect Chrome. Please configure executablePath in YAML file.', 'ERROR');
        logMessage('Common locations:');
        if (os.platform() === 'win32') {
          logMessage('  Windows: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
          logMessage('  Windows (x86): C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
        } else if (os.platform() === 'darwin') {
          logMessage('  macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
        } else {
          logMessage('  Linux: /usr/bin/google-chrome or /usr/bin/google-chrome-stable');
          logMessage('  Linux: /usr/bin/chromium or /usr/bin/chromium-browser');
        }
        throw new Error('Chrome executable not found and auto-detection failed');
      }
    } else {
      logMessage(`Using configured Chrome path: ${config.browser.executablePath}`);
    }

    return config;
  } catch (error) {
    logMessage('Error loading configuration: ' + error, 'ERROR');
    throw error;
  }
}

/**
 * Initialize the Telegram bot
 */
function initTelegramBot(): Bot | null {
  try {
    const envPath = path.join(projectRoot, 'config', '.env.secrets');
    const envContent = readFileSync(envPath, 'utf8');

    const tokenMatch = envContent.match(/TELEGRAM_API_TOKEN=(.+)/);

    if (!tokenMatch) {
      logMessage('TELEGRAM_API_TOKEN not found in .env.secrets');
      return null;
    }

    const chatIdsMatch = envContent.match(/TELEGRAM_CHAT_IDS=(.+)/);

    if (chatIdsMatch) {
      telegramChatIds = chatIdsMatch[1].trim().split(',').map(id => id.trim());
      logMessage(`Loaded ${telegramChatIds.length} Telegram chat IDs successfully`);
    } else {
      logMessage('TELEGRAM_CHAT_IDS not found in .env.secrets, notifications will be disabled', 'WARNING');
    }

    const token = tokenMatch[1].trim();
    logMessage('Initializing Telegram bot...');

    return new Bot(token);
  } catch (error) {
    logMessage('Error initializing Telegram bot: ' + error, 'ERROR');
  }

  return null;
}

/**
 * Send a text message to all configured Telegram chats
 */
async function sendMessageToTelegram(message: string): Promise<void> {
  try {
    if (!telegramBot) {
      logMessage('Telegram bot not initialized');
      return;
    }

    if (telegramChatIds.length === 0) {
      logMessage('No Telegram chat IDs configured');
      return;
    }

    logMessage(`Sending message to ${telegramChatIds.length} Telegram chat(s): "${message}"`);

    for (const chatId of telegramChatIds) {
      try {
        await telegramBot.api.sendMessage(chatId, message);
        logMessage(`Message sent to Telegram chat ${chatId} successfully`);
      } catch (chatError) {
        logMessage(`Error sending message to Telegram chat ${chatId}: ${chatError}`, 'ERROR');
      }
    }
  } catch (error) {
    logMessage('Error sending message to Telegram: ' + error, 'ERROR');
  }
}

/**
 * Load tokens from config
 */
async function loadTokens(): Promise<void> {
  try {
    const config = loadConfig();

    if (config.tokens && Array.isArray(config.tokens)) {
      validTokens = config.tokens.filter(token => token.token && token.token.trim() !== '');
      logMessage(`Loaded ${validTokens.length} valid tokens from config`);
    } else {
      logMessage("No tokens found in configuration", 'WARNING');
      validTokens = [];
    }
  } catch (error: any) {
    logMessage('Error loading tokens: ' + error, 'ERROR');
    throw error;
  }
}

/**
 * Create a standardized API response
 */
function createApiResponse(
  success: boolean,
  message: string,
  error: string | null = null,
  additionalData: Record<string, any> = {}
): ApiResponse {
  return {
    success,
    message,
    error,
    ...additionalData
  };
}

/**
 * Token authentication middleware
 */
function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json(
      createApiResponse(
        false,
        'Authentication failed',
        'Missing authentication token'
      )
    );
    return;
  }

  const validToken = validTokens.find(t => t.token === token);

  if (!validToken) {
    res.status(403).json(
      createApiResponse(
        false,
        'Authentication failed',
        'Invalid token'
      )
    );
    return;
  }

  next();
}

/**
 * Check if a file exists
 */
function fileExists(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Check if a process with the given PID is running
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error.code === 'ESRCH') {
      return false;
    } else if (error.code === 'EPERM') {
      return true;
    } else {
      logMessage(`Error checking PID ${pid}: ${error.message}`, 'ERROR');
      return false;
    }
  }
}

function checkFilePidIsRunning(filePathPid: string, deleteFile: boolean): boolean {
  let result = false;

  if (fileExists(filePathPid)) {
    const data = readFileSync(filePathPid, { encoding: 'utf8' });
    const pidString = data.trim();
    const pid = parseInt(pidString, 10);

    if (isRunning(pid)) {
      result = true;
    } else if (deleteFile) {
      if (fileExists(filePathPid)) {
        unlinkSync(filePathPid);
      }
    }
  }

  return result;
}

/**
 * Wait for a random amount of time between min and max milliseconds
 */
export async function waitRandomTime(minMs: number, maxMs: number): Promise<void> {
  let waitTime = minMs;

  if (minMs > maxMs) {
    [minMs, maxMs] = [maxMs, minMs];
    waitTime = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }

  return new Promise(resolve => setTimeout(resolve, waitTime));
}

export interface InitBrowserResult {
  browser?: puppeteer.Browser | null,
  page?: puppeteer.Page | null,
  profile?: BrowserProfile | null,
  error?: string | null
}

/**
 * Initialize Puppeteer browser using the browser pool
 */
export async function initBrowser(url: string, context: string): Promise<InitBrowserResult> {
  const result: InitBrowserResult = { browser: null, page: null, profile: null, error: null };

  try {
    const profile = browserPool.getBrowserProfile(context);

    if (!profile) {
      result.error = "No browser profiles available in the pool";
      logMessage("No browser profiles available in the pool", "ERROR");
      return result;
    }

    mkdirSync(profile.profile, { recursive: true });

    if (checkFilePidIsRunning(profile.pid, true)) {
      result.error = `Browser process for profile ${profile.profile} is already running`;
      logMessage(`Browser process for profile ${profile.profile} is already running`, "ERROR");
      browserPool.returnBrowserProfile(profile, false);
      return result;
    }

    const config = loadConfig();

    const browser = await launch({
      executablePath: config.browser.executablePath,
      headless: false,
      devtools: false,
      userDataDir: profile.profile,
      args: config.browser.args,
    });

    profile.browser = browser;

    const pid = browser.process()!.pid;
    writeFileSync(profile.pid, pid + "");

    await waitRandomTime(1500, 1500);

    let page = await browserPool.manageBrowserTabs(browser, profile.instance);

    await waitRandomTime(2000, 2000);

    await page.setViewport({
      width: config.viewport?.width || 1920,
      height: config.viewport?.height || 1080,
      deviceScaleFactor: 1
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

    const title = await page.title();
    logMessage('Page title: ' + title);

    await waitRandomTime(1500, 1500);

    result.browser = browser;
    result.page = page;
    result.profile = profile;

  } catch (error: any) {
    result.error = (error as Error).message;
  }

  return result;
}

/**
 * Check if user is already logged in
 */
export async function isLoggedIn(page: puppeteer.Page, config: BotConfig): Promise<boolean> {
  if (!config.gmail?.loggedInIndicator) {
    logMessage('No loggedInIndicator configured, assuming not logged in');
    return false;
  }

  try {
    // Wait a bit for page to be ready
    await waitRandomTime(1000, 1500);
    
    const indicatorSelector = config.gmail.loggedInIndicator;
    logMessage(`Checking for login indicator: ${indicatorSelector}`);
    
    // Try the configured selector first - search in DOM (not just visible elements)
    let indicator: puppeteer.ElementHandle | null = await page.$(indicatorSelector);
    
    if (indicator) {
      logMessage('✓ Login indicator found - user is logged in');
      return true;
    }
    
    // If not found, try alternative common selectors - search in DOM
    logMessage('Primary indicator not found, trying alternative selectors in DOM...');
    const alternativeSelectors = [
      '[data-sidebar="menu-button"]',  // User menu button
      'div[data-sidebar="menu-button"]',
      'button[data-sidebar="menu-button"]',
      '.user-menu',
      '[class*="user"]',
      '[class*="menu-button"]',
      'a[href*="/sessions/"]'  // Sign out link (indicates logged in)
    ];
    
    // Search in DOM using evaluate to find elements even if hidden
    for (const altSelector of alternativeSelectors) {
      try {
        // First try standard method
        indicator = await page.$(altSelector);
        if (indicator) {
          logMessage(`✓ Found alternative login indicator: ${altSelector} - user is logged in`);
          return true;
        }
        
        // If not found, search in DOM using evaluate (finds hidden elements too)
        const foundInDOM = await page.evaluate((selector) => {
          return document.querySelector(selector) !== null;
        }, altSelector);
        
        if (foundInDOM) {
          // Element exists in DOM, try to get it again
          indicator = await page.$(altSelector);
          if (indicator) {
            logMessage(`✓ Found alternative login indicator in DOM: ${altSelector} - user is logged in`);
            return true;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    logMessage('✗ Login indicator not found with any selector - user is not logged in');
    
    // Additional check: look for sign_in page elements as negative indicator
    try {
      const signInElements = await page.$$('input[name*="username"], input[id*="username"], #contact_username, input[type="password"][id*="password"]');
      if (signInElements.length > 0) {
        logMessage(`Found ${signInElements.length} sign-in form element(s), confirming user is not logged in`);
      }
    } catch (e) {
      // Ignore errors in additional check
    }
    
    // Debug: Check current URL
    const currentUrl = page.url();
    logMessage(`Current URL: ${currentUrl}`);
    if (currentUrl.includes('/sign_in') || currentUrl.includes('/login')) {
      logMessage('URL indicates login page, confirming user is not logged in');
    }
    
    return false;
  } catch (error: any) {
    logMessage(`Error checking login status: ${error.message}`, 'WARNING');
    return false;
  }
}

/**
 * Get verification code from Gmail
 */
export async function getVerificationCodeFromGmail(
  browser: puppeteer.Browser,
  config: BotConfig,
  account?: Account
): Promise<string | null> {
  if (!config.gmail) {
    logMessage('Gmail configuration not found', 'ERROR');
    return null;
  }

  const gmailConfig = config.gmail;
  let gmailPage: puppeteer.Page | null = null;

  try {
    logMessage('Opening Gmail to retrieve verification code...');

    // Check if Gmail tab already exists
    const pages = await browser.pages();
    gmailPage = pages.find(p => p.url().includes('mail.google.com')) || null;

    if (!gmailPage) {
      // Open new tab for Gmail
      gmailPage = await browser.newPage();
      await gmailPage.goto('https://mail.google.com', { waitUntil: 'networkidle2' });
      await waitRandomTime(2000, 3000);
      logMessage('Gmail page opened');
    } else {
      logMessage('Reusing existing Gmail tab');
      await gmailPage.bringToFront();
      await gmailPage.reload({ waitUntil: 'networkidle2' });
      await waitRandomTime(2000, 3000);
    }

    // Click on Gmail label if configured for this account
    if (account?.gmailLabel) {
      logMessage(`Looking for Gmail label: "${account.gmailLabel}"`);
      
      try {
        // Wait for Gmail sidebar to load
        await waitRandomTime(1000, 2000);
        
        // Try multiple selectors for Gmail labels
        const labelSelectors = [
          `a[title="${account.gmailLabel}"]`,
          `a[aria-label="${account.gmailLabel}"]`,
          `span:has-text("${account.gmailLabel}")`,
          `div:has-text("${account.gmailLabel}")`,
          `a[data-label-name="${account.gmailLabel}"]`
        ];
        
        let labelFound = false;
        
        for (const selector of labelSelectors) {
          try {
            const labelElement = await gmailPage.$(selector);
            if (labelElement) {
              // Check if it's visible
              const isVisible = await gmailPage.evaluate(el => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
              }, labelElement);
              
              if (isVisible) {
                await labelElement.click();
                logMessage(`Clicked on Gmail label: "${account.gmailLabel}"`);
                await waitRandomTime(2000, 3000);
                labelFound = true;
                break;
              }
            }
          } catch (error) {
            // Continue to next selector
            continue;
          }
        }
        
        // Alternative: Search for label by text content in sidebar
        if (!labelFound) {
          logMessage(`Trying to find label by text content...`);
          const allLinks = await gmailPage.$$('a, div, span');
          
          for (const link of allLinks) {
            try {
              const text = await gmailPage.evaluate(el => el.textContent?.trim() || '', link);
              if (text === account.gmailLabel) {
                const isVisible = await gmailPage.evaluate(el => {
                  const style = window.getComputedStyle(el);
                  return style.display !== 'none' && style.visibility !== 'hidden';
                }, link);
                
                if (isVisible) {
                  await link.click();
                  logMessage(`Clicked on Gmail label by text: "${account.gmailLabel}"`);
                  await waitRandomTime(2000, 3000);
                  labelFound = true;
                  break;
                }
              }
            } catch (error) {
              continue;
            }
          }
        }
        
        if (!labelFound) {
          logMessage(`Warning: Could not find Gmail label "${account.gmailLabel}", continuing without label filter`, 'WARNING');
        }
      } catch (error: any) {
        logMessage(`Error clicking Gmail label: ${error.message}`, 'WARNING');
        // Continue anyway
      }
    }

    // Flexible search for email with multiple search strategies
    logMessage(`Searching for email with subject: "${gmailConfig.subject}" from support`);

    // Multiple search strategies to try in order
    const searchStrategies = [
      `subject:${gmailConfig.subject} from:support`,  // Strategy 1: Subject + from support
      `subject:"${gmailConfig.subject}" from:support`,  // Strategy 2: Subject with quotes + from support
      `${gmailConfig.subject} from:support`,  // Strategy 3: Just subject text + from support
      `from:support "${gmailConfig.subject}"`,  // Strategy 4: From support + subject in quotes
      `"${gmailConfig.subject}" support`,  // Strategy 5: Subject in quotes + support keyword
      `from:support mfa code`,  // Strategy 6: From support + mfa code keywords
      `support verification code`,  // Strategy 7: Support + verification code keywords
    ];

    let searchSuccessful = false;
    
    // Try to find search box with multiple selectors
    let searchBox = await gmailPage.$('input[aria-label="Search mail"]') || 
                    await gmailPage.$('input[aria-label*="Search"]') ||
                    await gmailPage.$('input[type="text"][placeholder*="Search"]') ||
                    await gmailPage.$('input[type="search"]');

    // If no search box found, try to find any search input
    if (!searchBox) {
      const searchInputs = await gmailPage.$$('input[type="text"], input[type="search"], input[aria-label*="Search"], input[placeholder*="Search"]');
      if (searchInputs.length > 0) {
        searchBox = searchInputs[0];
      }
    }

    // Try each search strategy until one works
    for (let strategyIndex = 0; strategyIndex < searchStrategies.length; strategyIndex++) {
      const searchQuery = searchStrategies[strategyIndex];
      logMessage(`Trying search strategy ${strategyIndex + 1}/${searchStrategies.length}: ${searchQuery}`);

      try {
        if (searchBox) {
          await searchBox.click({ clickCount: 3 }); // Select all existing text
          await waitRandomTime(300, 500);
          await searchBox.type(searchQuery, { delay: 50 });
          await waitRandomTime(500, 800);
          await gmailPage.keyboard.press('Enter');
          await waitRandomTime(3000, 4000);
          
          // Check if we got results
          await waitRandomTime(1000, 1500);
          const hasResults = await gmailPage.evaluate(() => {
            const mainArea = document.querySelector('div[role="main"]');
            if (!mainArea) return false;
            const rows = mainArea.querySelectorAll('tr[role="row"], div[data-thread-perm-id], table tbody tr');
            return rows.length > 0;
          });

          if (hasResults) {
            logMessage(`Search successful with strategy ${strategyIndex + 1}`);
            searchSuccessful = true;
            break;
          } else {
            logMessage(`No results with strategy ${strategyIndex + 1}, trying next...`, 'WARNING');
          }
        }
      } catch (error: any) {
        logMessage(`Error with search strategy ${strategyIndex + 1}: ${error.message}`, 'WARNING');
        continue;
      }
    }

    if (!searchSuccessful) {
      logMessage('All search strategies failed, trying to proceed with available emails', 'WARNING');
    }

    // Wait for search results and find the most recent email from support
    await waitRandomTime(2000, 3000);

    // Try to find email elements - Gmail uses various selectors
    const emailSelectors = [
      'div[role="main"] tr[role="row"]',
      'div[role="main"] tbody tr',
      'div[data-thread-perm-id]',
      'table tbody tr'
    ];

    let emailElements: puppeteer.ElementHandle[] = [];
    let emailElement: puppeteer.ElementHandle | null = null;

    // Get all matching emails
    for (const selector of emailSelectors) {
      try {
        const elements = await gmailPage.$$(selector);
        if (elements.length > 0) {
          emailElements = elements;
          logMessage(`Found ${elements.length} email(s) using selector: ${selector}`);
          break;
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    if (emailElements.length === 0) {
      logMessage('No emails found with the specified subject from support', 'WARNING');
      return null;
    }

    // Find the email from "support" with subject "MFA code for ezCater" (most recent first)
    logMessage(`Checking ${emailElements.length} email(s) to find the one from support with MFA code...`);
    
    for (const element of emailElements) {
      try {
        // Get the email text to check for "support" and "MFA code for ezCater"
        const emailText = await gmailPage.evaluate(el => el.textContent || '', element);
        const emailLower = emailText.toLowerCase();
        
        // Check if email contains "support" and "mfa code for ezcater" and "verification code"
        const hasSupport = emailLower.includes('support');
        const hasMfaSubject = emailLower.includes('mfa code for ezcater');
        const hasVerificationCode = emailLower.includes('verification code');
        
        if (hasSupport && hasMfaSubject && hasVerificationCode) {
          emailElement = element;
          logMessage(`Found matching email from support: ${emailText.substring(0, 150)}...`);
          break;
        }
      } catch (error) {
        // Continue to next email
        continue;
      }
    }

    // If no exact match found, try to find one with "support" and "mfa code"
    if (!emailElement) {
      logMessage('Trying to find email with support and MFA code...');
      for (const element of emailElements) {
        try {
          const emailText = await gmailPage.evaluate(el => el.textContent || '', element);
          const emailLower = emailText.toLowerCase();
          
          if (emailLower.includes('support') && emailLower.includes('mfa code')) {
            emailElement = element;
            logMessage(`Found email from support with MFA code: ${emailText.substring(0, 150)}...`);
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    // If still no match, use the first (most recent) one from the search results
    if (!emailElement && emailElements.length > 0) {
      logMessage('Using most recent email from search results', 'WARNING');
      emailElement = emailElements[0];
    }

    if (!emailElement) {
      logMessage('No email found from support with MFA code', 'WARNING');
      return null;
    }

    // Click on the email to open it
    await emailElement.click();
    await waitRandomTime(2000, 3000);

    // Extract code from email body
    const codePattern = gmailConfig.codePattern || '\\b\\d{4,8}\\b';
    const regex = new RegExp(codePattern);

    // Try to get email content from various possible selectors
    const contentSelectors = [
      'div[dir="ltr"]',
      'div.message-body',
      'div.email-body',
      'div[role="main"] div[dir]',
      'div.a3s'
    ];

    let emailContent = '';

    for (const selector of contentSelectors) {
      try {
        const contentElement = await gmailPage.$(selector);
        if (contentElement) {
          emailContent = await gmailPage.evaluate(el => el.textContent || '', contentElement);
          if (emailContent) {
            logMessage(`Extracted email content using selector: ${selector}`);
            break;
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    // If no content found, try getting all text from the page
    if (!emailContent) {
      emailContent = await gmailPage.evaluate(() => document.body.innerText || '');
    }

    // First, try to extract code after "Your verification code is:"
    const verificationCodePattern = /Your verification code is:\s*(\d{4,8})/i;
    const verificationMatch = emailContent.match(verificationCodePattern);
    
    if (verificationMatch && verificationMatch[1]) {
      const code = verificationMatch[1];
      logMessage(`Verification code extracted from "Your verification code is:" text: ${code}`);
      return code;
    }

    // Fallback: Extract code using general regex pattern
    const match = emailContent.match(regex);
    if (match && match[0]) {
      const code = match[0];
      logMessage(`Verification code extracted using general pattern: ${code}`);
      return code;
    }

    logMessage('Could not extract verification code from email', 'WARNING');
    logMessage(`Email content preview: ${emailContent.substring(0, 200)}...`);
    return null;

  } catch (error: any) {
    logMessage(`Error retrieving verification code from Gmail: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Parse date from element text (e.g., "Tue, Jan. 27, Noon" -> Date object)
 */
function parseDateFromElement(dateText: string): Date | null {
  try {
    // Remove extra whitespace and normalize
    const normalized = dateText.trim();
    
    // Try to parse formats like "Tue, Jan. 27, Noon" or "Tue, Jan 27, Noon"
    const dateMatch = normalized.match(/(\w+),?\s+(\w+)\.?\s+(\d+),?\s+/i);
    if (dateMatch) {
      const monthName = dateMatch[2];
      const day = parseInt(dateMatch[3], 10);
      
      // Map month names to numbers
      const monthMap: { [key: string]: number } = {
        'jan': 0, 'january': 0,
        'feb': 1, 'february': 1,
        'mar': 2, 'march': 2,
        'apr': 3, 'april': 3,
        'may': 4,
        'jun': 5, 'june': 5,
        'jul': 6, 'july': 6,
        'aug': 7, 'august': 7,
        'sep': 8, 'september': 8,
        'oct': 9, 'october': 9,
        'nov': 10, 'november': 10,
        'dec': 11, 'december': 11
      };
      
      const monthLower = monthName.toLowerCase();
      const month = monthMap[monthLower];
      
      if (month !== undefined) {
        const currentYear = new Date().getFullYear();
        return new Date(currentYear, month, day);
      }
    }
    
    // Fallback: try to parse as standard date
    const parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Compare two dates (ignoring time, only comparing year, month, day)
 */
function datesMatch(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

/**
 * Read order codes from log file, filtering by date
 * File format: "2026-01-23T13:19:12.263Z | Order: #MP8-R78 | ..."
 */
function readOrderCodesFromFile(filePath: string, targetDate?: string): string[] {
  try {
    if (!fileExists(filePath)) {
      logMessage(`Order codes file not found: ${filePath}`, 'WARNING');
      return [];
    }

    const fileContent = readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');
    const orderCodes: string[] = [];
    const seenCodes = new Set<string>();

    // Parse target date if provided (format: YYYY-MM-DD)
    let targetDateObj: Date | null = null;
    if (targetDate && targetDate.trim() !== '') {
      const [year, month, day] = targetDate.split('-').map(Number);
      targetDateObj = new Date(year, month - 1, day);
      logMessage(`Filtering orders by date: ${targetDateObj.toLocaleDateString()}`);
    }

    // Extract order codes from each line
    // Pattern: "2026-01-23T13:19:12.263Z | Order: #XXXX-XXX | ..."
    const timestampPattern = /^(\d{4}-\d{2}-\d{2})T/; // Extract date from ISO timestamp
    const orderCodePattern = /Order:\s*#([A-Z0-9]+-[A-Z0-9]+)/gi;

    let linesProcessed = 0;
    let linesMatched = 0;

    for (const line of lines) {
      if (!line.trim()) continue; // Skip empty lines
      
      linesProcessed++;
      
      // Extract timestamp date
      const timestampMatch = line.match(timestampPattern);
      if (!timestampMatch) continue; // Skip lines without timestamp
      
      const lineDateStr = timestampMatch[1]; // YYYY-MM-DD
      const [lineYear, lineMonth, lineDay] = lineDateStr.split('-').map(Number);
      const lineDate = new Date(lineYear, lineMonth - 1, lineDay);
      
      // Filter by date if target date is provided
      if (targetDateObj) {
        if (!datesMatch(lineDate, targetDateObj)) {
          continue; // Skip this line if date doesn't match
        }
        linesMatched++;
      }
      
      // Extract order code from this line
      const matches = line.matchAll(orderCodePattern);
      for (const match of matches) {
        const code = match[1].trim().toUpperCase();
        if (code && !seenCodes.has(code)) {
          orderCodes.push(code);
          seenCodes.add(code);
        }
      }
    }

    logMessage(`Processed ${linesProcessed} lines from file: ${filePath}`);
    if (targetDateObj) {
      logMessage(`Matched ${linesMatched} lines for date ${targetDateObj.toLocaleDateString()}`);
    }
    logMessage(`Extracted ${orderCodes.length} unique order codes`);
    if (orderCodes.length > 0) {
      logMessage(`Order codes: ${orderCodes.slice(0, 10).join(', ')}${orderCodes.length > 10 ? '...' : ''}`);
    }

    return orderCodes;
  } catch (error: any) {
    logMessage(`Error reading order codes from file: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Find clicked_orders log file with date pattern
 * Supports both old format (clicked_orders.log) and new format (clicked_orders_YYYY-MM-DD.log)
 */
function findClickedOrdersFile(basePath: string, targetDate?: string): string | null {
  try {
    const dir = path.dirname(basePath);
    const baseName = path.basename(basePath);
    
    // If baseName is just "clicked_orders.log", try to find file with date pattern
    if (baseName === 'clicked_orders.log' || baseName.endsWith('clicked_orders.log')) {
      // If targetDate is provided, try that specific date first
      if (targetDate) {
        const datedFileName = `clicked_orders_${targetDate}.log`;
        const datedFilePath = path.join(dir, datedFileName);
        if (existsSync(datedFilePath)) {
          logMessage(`Found clicked_orders file with date: ${datedFilePath}`);
          return datedFilePath;
        }
      }
      
      // Try to find the most recent file with date pattern
      try {
        const files = readdirSync(dir);
        const clickedOrdersFiles = files.filter((file: string) => 
          file.startsWith('clicked_orders_') && 
          file.endsWith('.log') &&
          /clicked_orders_\d{4}-\d{2}-\d{2}\.log$/.test(file)
        );
        
        if (clickedOrdersFiles.length > 0) {
          // Sort by date (most recent first)
          clickedOrdersFiles.sort((a, b) => {
            const dateA = a.match(/clicked_orders_(\d{4}-\d{2}-\d{2})\.log$/)?.[1] || '';
            const dateB = b.match(/clicked_orders_(\d{4}-\d{2}-\d{2})\.log$/)?.[1] || '';
            return dateB.localeCompare(dateA); // Descending order (newest first)
          });
          
          // If targetDate is provided, try to find exact match first
          if (targetDate) {
            const exactMatch = clickedOrdersFiles.find((file: string) => 
              file === `clicked_orders_${targetDate}.log`
            );
            if (exactMatch) {
              const filePath = path.join(dir, exactMatch);
              logMessage(`Found clicked_orders file matching target date: ${filePath}`);
              return filePath;
            }
          }
          
          // Use the most recent file
          const mostRecentFile = clickedOrdersFiles[0];
          const filePath = path.join(dir, mostRecentFile);
          logMessage(`Found most recent clicked_orders file: ${filePath}`);
          return filePath;
        }
      } catch (dirError: any) {
        logMessage(`Error reading directory ${dir}: ${dirError.message}`, 'WARNING');
      }
      
      // Fallback: try the original path
      if (existsSync(basePath)) {
        logMessage(`Using original clicked_orders file: ${basePath}`);
        return basePath;
      }
    } else {
      // If it's already a specific file path, use it as-is
      if (existsSync(basePath)) {
        return basePath;
      }
    }
    
    return null;
  } catch (error: any) {
    logMessage(`Error finding clicked_orders file: ${error.message}`, 'WARNING');
    return null;
  }
}

/**
 * Get order codes from configuration (file or list)
 * @param config - Bot configuration
 * @param overrideDate - Optional date override (from CLI parameter --date). Takes precedence over config.task.filterDate
 */
export function getOrderCodesFromConfig(config: BotConfig, overrideDate?: string): string[] {
  const orderCodes: string[] = [];

  // First, try to read from file if configured
  if (config.task.orderCodesFile && config.task.orderCodesFile.trim() !== '') {
    const baseFilePath = path.isAbsolute(config.task.orderCodesFile)
      ? config.task.orderCodesFile
      : path.join(projectRoot, config.task.orderCodesFile);
    
    // Use overrideDate (from CLI) if provided, otherwise use filterDate from config, otherwise undefined
    const targetDate = overrideDate && overrideDate.trim() !== ''
      ? overrideDate
      : (config.task.filterDate && config.task.filterDate.trim() !== ''
          ? config.task.filterDate
          : undefined);
    
    // Find the actual file (supports both old and new format with date)
    // Priority: Use targetDate to find clicked_orders_YYYY-MM-DD.log
    const filePath = findClickedOrdersFile(baseFilePath, targetDate);
    
    if (filePath) {
      logMessage(`Using order codes file: ${filePath}`);
      const codesFromFile = readOrderCodesFromFile(filePath, targetDate);
      orderCodes.push(...codesFromFile);
    } else {
      logMessage(`Order codes file not found: ${baseFilePath}`, 'WARNING');
      if (targetDate) {
        logMessage(`Also tried: clicked_orders_${targetDate}.log in same directory`, 'WARNING');
      } else {
        logMessage(`Tried to find most recent clicked_orders_YYYY-MM-DD.log file in directory`, 'WARNING');
      }
    }
  }

  // Then, add codes from list if configured
  if (config.task.orderCodes && config.task.orderCodes.length > 0) {
    orderCodes.push(...config.task.orderCodes.map(code => code.trim().toUpperCase()));
  }

  // Remove duplicates
  const uniqueCodes = Array.from(new Set(orderCodes));
  
  if (uniqueCodes.length > 0) {
    logMessage(`Total unique order codes to process: ${uniqueCodes.length}`);
  }

  return uniqueCodes;
}

/**
 * Clean up browser tabs - close all tabs except the main one
 */
export async function cleanupBrowserTabs(browser: puppeteer.Browser, mainPage: puppeteer.Page): Promise<void> {
  try {
    logMessage('Cleaning up browser tabs...');
    const pages = await browser.pages();
    let closedCount = 0;
    
    for (const tab of pages) {
      // Keep the main page open
      if (tab !== mainPage) {
        try {
          // Check if tab is not already closed
          const url = tab.url();
          if (url && url !== 'about:blank') {
            logMessage(`Closing tab: ${url.substring(0, 50)}...`);
          }
          await tab.close();
          closedCount++;
        } catch (closeError: any) {
          // Tab might already be closed, ignore error
          logMessage(`Tab already closed or error closing: ${closeError.message}`, 'WARNING');
        }
      }
    }
    
    if (closedCount > 0) {
      logMessage(`Closed ${closedCount} tab(s), keeping main page open`);
    } else {
      logMessage('No additional tabs to close');
    }
    
    // Bring main page to front
    await mainPage.bringToFront();
    await waitRandomTime(500, 1000);
    
  } catch (error: any) {
    logMessage(`Error cleaning up tabs: ${error.message}`, 'WARNING');
  }
}

/**
 * Perform hard reload and clear cache
 */
async function hardReloadAndClearCache(page: puppeteer.Page): Promise<void> {
  try {
    logMessage('Performing hard reload and clearing cache...');
    
    // Get the CDP (Chrome DevTools Protocol) session
    const client = await page.target().createCDPSession();
    
    // Clear browser cache
    await client.send('Network.clearBrowserCache');
    logMessage('Browser cache cleared');
    
    // Clear browser cookies (optional, but helps ensure clean state)
    // await client.send('Network.clearBrowserCookies');
    
    // Perform hard reload using CDP Page.reload with ignoreCache flag
    // This is more reliable than keyboard shortcuts
    await client.send('Page.reload', { ignoreCache: true });
    logMessage('Hard reload command sent');
    
    // Wait for page to reload
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {
      // Navigation might complete before timeout
    });
    
    logMessage('Hard reload completed');
    
    // Additional wait to ensure page is fully loaded
    await waitRandomTime(1000, 2000);
    
  } catch (error: any) {
    logMessage(`Error during hard reload: ${error.message}`, 'WARNING');
    // Fallback: try regular reload
    try {
      await page.reload({ waitUntil: 'networkidle2' });
      logMessage('Fallback: Regular reload completed');
    } catch (reloadError) {
      logMessage(`Error during fallback reload: ${reloadError}`, 'WARNING');
    }
  }
}

/**
 * Perform logout by clicking on user menu and then sign out
 */
/**
 * Check if a page is still valid (not detached)
 */
function isPageValid(page: puppeteer.Page): boolean {
  try {
    // Try to access a property that will throw if page is detached
    const url = page.url();
    return true;
  } catch (e: any) {
    if (e.message && e.message.includes('detached')) {
      return false;
    }
    return true; // Other errors might be okay
  }
}

/**
 * Get a valid page reference, creating a new one if current is detached
 */
async function ensureValidPage(page: puppeteer.Page, browser: puppeteer.Browser, fallbackUrl: string): Promise<puppeteer.Page> {
  if (isPageValid(page)) {
    return page;
  }
  
  logMessage('Page was detached, creating new page...', 'WARNING');
  const newPage = await browser.newPage();
  await newPage.goto(fallbackUrl, { waitUntil: 'networkidle2' });
  return newPage;
}

export async function performLogout(page: puppeteer.Page, config: BotConfig, browser?: puppeteer.Browser): Promise<void> {
  try {
    logMessage('Performing logout...');
    
    // Ensure page is valid before proceeding
    if (browser && !isPageValid(page)) {
      logMessage('Page was detached, attempting to get valid page...', 'WARNING');
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          page = pages[0];
          await page.goto(config.task.url, { waitUntil: 'networkidle2' });
          await waitRandomTime(2000, 3000);
        } else {
          logMessage('No pages available, navigating directly to sign_in...', 'WARNING');
          await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
          return;
        }
      } catch (e: any) {
        logMessage(`Could not recover page: ${e.message}, navigating directly to sign_in...`, 'WARNING');
        try {
          await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
        } catch (navError) {
          // Ignore
        }
        return;
      }
    }
    
    // Wait a bit before attempting logout
    await waitRandomTime(1000, 2000);
    
    // Find the footer element first, then find the menu button inside it
    // Search in DOM (not just visible elements)
    logMessage('Searching for footer element with data-sidebar="footer"...');
    
    let footerElement: puppeteer.ElementHandle | null = null;
    let userMenuButton: puppeteer.ElementHandle | null = null;
    
    // First, try to find the footer element with error handling
    try {
      footerElement = await page.$('div[data-sidebar="footer"]');
    } catch (e: any) {
      if (e.message && e.message.includes('detached')) {
        logMessage('Page was detached while searching for footer, navigating to sign_in...', 'WARNING');
        try {
          await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
        } catch (navError) {
          // Ignore
        }
        return;
      }
      // Continue with other errors
    }
    
    if (!footerElement) {
      try {
        // Search in DOM using evaluate
        const footerExists = await page.evaluate(() => {
          return document.querySelector('div[data-sidebar="footer"]') !== null;
        });
        
        if (footerExists) {
          const allElements = await page.$$('div');
          for (const element of allElements) {
            try {
              const dataSidebar = await page.evaluate(el => el.getAttribute('data-sidebar'), element);
              if (dataSidebar === 'footer') {
                footerElement = element;
                logMessage('Found footer element in DOM by attribute search');
                break;
              }
            } catch (e: any) {
              if (e.message && e.message.includes('detached')) {
                logMessage('Element was detached during search, skipping...', 'WARNING');
                break;
              }
              // Continue with other errors
            }
          }
        }
      } catch (e: any) {
        if (e.message && e.message.includes('detached')) {
          logMessage('Page was detached during footer search, navigating to sign_in...', 'WARNING');
          try {
            await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
          } catch (navError) {
            // Ignore
          }
          return;
        }
        // Continue with other errors
      }
    }
    
    if (footerElement) {
      try {
        logMessage('Found footer element, searching for menu button inside...');
        // Look for menu-button inside the footer
        userMenuButton = await footerElement.$('[data-sidebar="menu-button"]') ||
                         await footerElement.$('div[data-sidebar="menu-button"]') ||
                         await footerElement.$('button[data-sidebar="menu-button"]');
        
        if (!userMenuButton) {
          // Search all children of footer
          const footerChildren = await footerElement.$$('div, button');
          for (const child of footerChildren) {
            try {
              const dataSidebar = await page.evaluate(el => el.getAttribute('data-sidebar'), child);
              if (dataSidebar === 'menu-button') {
                userMenuButton = child;
                logMessage('Found menu button inside footer');
                break;
              }
            } catch (e: any) {
              if (e.message && e.message.includes('detached')) {
                logMessage('Element was detached during menu button search, skipping...', 'WARNING');
                break;
              }
              // Continue with other errors
            }
          }
        }
      } catch (e: any) {
        if (e.message && e.message.includes('detached')) {
          logMessage('Footer element was detached, trying direct search...', 'WARNING');
          footerElement = null; // Reset to try direct search
        }
        // Continue with other errors
      }
    }
    
    // Fallback: if footer not found, try direct search for menu-button
    if (!userMenuButton) {
      logMessage('Footer not found, searching for menu button directly...', 'WARNING');
      // First, check if element exists in DOM using evaluate (finds hidden elements)
      const menuButtonExists = await page.evaluate(() => {
        return document.querySelector('div[data-sidebar="menu-button"]') !== null ||
               document.querySelector('button[data-sidebar="menu-button"]') !== null ||
               document.querySelector('[data-sidebar="menu-button"]') !== null;
      });
      
      if (menuButtonExists) {
        // Element exists in DOM, try to get it
        userMenuButton = await page.$('div[data-sidebar="menu-button"]') || 
                         await page.$('button[data-sidebar="menu-button"]') ||
                         await page.$('[data-sidebar="menu-button"]');
      }
      
      if (!userMenuButton) {
        logMessage('User menu button not found with standard selectors, searching in DOM by attribute...', 'WARNING');
        // Search in DOM using evaluate to find by attribute (finds hidden elements)
        const elementFound = await page.evaluate(() => {
          const allElements = document.querySelectorAll('div, button');
          for (const el of allElements) {
            if (el.getAttribute('data-sidebar') === 'menu-button') {
              return true;
            }
          }
          return false;
        });
        
        if (elementFound) {
          // Try to get all elements and find the one with the attribute
          const allElements = await page.$$('div, button');
          for (const element of allElements) {
            const dataSidebar = await page.evaluate(el => el.getAttribute('data-sidebar'), element);
            if (dataSidebar === 'menu-button') {
              userMenuButton = element as puppeteer.ElementHandle;
              logMessage('Found user menu button in DOM by attribute search');
              break;
            }
          }
        }
      }
    }
    
    if (!userMenuButton) {
      logMessage('Could not find user menu button for logout', 'WARNING');
      return;
    }
    
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
    
    // Wait for the dropdown menu to appear - try multiple times clicking footer/menu until sign out appears
    logMessage('Waiting for dropdown menu to appear...');
    await waitRandomTime(1500, 2000);
    
    // Try to wait for menu to be visible/opened - wait for sign out link to appear
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
    
    // Additional wait to ensure menu is fully rendered
    await waitRandomTime(500, 1000);
    
    // Find the "Sign out" link by href containing "/sessions/"
    // Search in DOM (not just visible elements)
    logMessage('Searching for sign out link in DOM...');
    
    let signOutLink: puppeteer.ElementHandle | null = null;
    
    // Strategy 1: Try direct selector for href containing "/sessions/"
    try {
      signOutLink = await page.$('a[href*="/sessions/"]');
      if (signOutLink) {
        logMessage('Found sign out link by href selector');
      }
    } catch (e) {
      // Continue to next strategy
    }
    
    // Strategy 2: Search in DOM using evaluate to find by href (finds hidden elements)
    if (!signOutLink) {
      const signOutInfo = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a');
        for (const link of allLinks) {
          const href = link.getAttribute('href') || '';
          if (href.includes('/sessions/')) {
            return { found: true, href };
          }
        }
        return { found: false, href: '' };
      });
      
      if (signOutInfo.found) {
        logMessage(`Found sign out link in DOM by href: ${signOutInfo.href}`);
        signOutLink = await page.$('a[href*="/sessions/"]');
      }
    }
    
    // Strategy 3: Search by text content "Sign out" or "logout" in DOM
    if (!signOutLink) {
      logMessage('Sign out link not found by href, searching in DOM by text content...', 'WARNING');
      const linkInfo = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a');
        for (const link of allLinks) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          if (text.toLowerCase().includes('sign out') || 
              text.toLowerCase().includes('logout') ||
              text.toLowerCase() === 'sign out') {
            return { found: true, text, href };
          }
        }
        return { found: false, text: '', href: '' };
      });
      
      if (linkInfo.found) {
        logMessage(`Found sign out link in DOM by text: "${linkInfo.text}"`);
        // Try to get the link by iterating through all links
        const allLinks = await page.$$('a');
        for (const link of allLinks) {
          const text = await page.evaluate(el => el.textContent?.trim() || '', link);
          const href = await page.evaluate(el => el.getAttribute('href') || '', link);
          if (text.toLowerCase().includes('sign out') || 
              text.toLowerCase().includes('logout') ||
              text.toLowerCase() === 'sign out') {
            logMessage(`Found sign out link in DOM by text/href: "${text}" / "${href}"`);
            signOutLink = link;
            break;
          }
        }
      }
    }
    
    // Strategy 4: Search in menu items or dropdown items
    if (!signOutLink) {
      logMessage('Trying to find sign out link in menu items...', 'WARNING');
      const menuItems = await page.$$('[role="menuitem"], [role="menu"] a, .menu a, [class*="menu"] a');
      for (const item of menuItems) {
        const text = await page.evaluate(el => el.textContent?.trim() || '', item);
        const href = await page.evaluate(el => el.getAttribute('href') || '', item);
        if (text.toLowerCase().includes('sign out') || 
            text.toLowerCase().includes('logout') ||
            href.includes('/sessions/')) {
          logMessage(`Found sign out link in menu item: "${text}" / "${href}"`);
          signOutLink = item;
          break;
        }
      }
    }
    
    if (!signOutLink) {
      logMessage('Could not find sign out link after multiple attempts', 'WARNING');
      logMessage('Attempting to navigate directly to sign_in page...', 'WARNING');
      // Try to navigate directly to sign_in page as fallback
      try {
        await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
        logMessage('Navigated directly to sign_in page');
        return;
      } catch (navError: any) {
        logMessage(`Could not navigate to sign_in page: ${navError.message}`, 'WARNING');
        return;
      }
    }
    
    logMessage('Found sign out link, clicking...');
    // Scroll into view if needed
    await page.evaluate((el) => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, signOutLink);
    await waitRandomTime(300, 500);
    await signOutLink.click();
    
    // Wait for logout to complete and navigation
    await waitRandomTime(2000, 3000);
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {
        // Navigation might complete before timeout
      });
    } catch (navError) {
      // Navigation timeout is okay
    }
    
    logMessage('Logout completed');
    
    // Navigate back to the original task URL to prepare for next account login (without clearing cache)
    // Ensure page is valid before navigating (handle detached frames)
    logMessage('Navigating back to task URL for next account...');
    try {
      if (!isPageValid(page) && browser) {
        logMessage('Page was detached after logout, getting valid page...', 'WARNING');
        const pages = await browser.pages();
        if (pages.length > 0) {
          page = pages[0];
          logMessage('Using existing page from browser');
        } else {
          page = await browser.newPage();
          logMessage('Created new page');
        }
      }
      await page.goto(config.task.url, { waitUntil: 'networkidle2' });
      await waitRandomTime(2000, 3000);
    } catch (navError: any) {
      logMessage(`Error navigating to task URL: ${navError.message}`, 'WARNING');
      // Try to get a valid page and navigate
      if (browser) {
        try {
          const pages = await browser.pages();
          if (pages.length > 0) {
            await pages[0].goto(config.task.url, { waitUntil: 'networkidle2' });
          } else {
            const newPage = await browser.newPage();
            await newPage.goto(config.task.url, { waitUntil: 'networkidle2' });
          }
        } catch (finalError) {
          logMessage(`Could not recover navigation: ${finalError}`, 'WARNING');
        }
      }
    }
    
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    logMessage(`Error during logout: ${errorMsg}`, 'WARNING');
    
    // If page is detached, try to navigate directly to sign_in
    if (errorMsg.includes('detached')) {
      logMessage('Page was detached, attempting direct navigation to sign_in...', 'WARNING');
      try {
        if (browser) {
          const pages = await browser.pages();
          if (pages.length > 0) {
            const validPage = pages[0];
            await validPage.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
            logMessage('Navigated to sign_in page using valid page reference');
            return;
          }
        }
        // Fallback: try with original page
        await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
      } catch (navError: any) {
        logMessage(`Could not navigate to sign_in: ${navError.message}`, 'WARNING');
        // If navigation fails, try to navigate to task URL
        try {
          if (browser) {
            const pages = await browser.pages();
            if (pages.length > 0) {
              await pages[0].goto(config.task.url, { waitUntil: 'networkidle2' });
            }
          }
        } catch (finalError) {
          // Ignore final errors
        }
      }
      return;
    }
    
    // For other errors, try to navigate back anyway
    try {
      if (browser && !isPageValid(page)) {
        const pages = await browser.pages();
        if (pages.length > 0) {
          await pages[0].goto(config.task.url, { waitUntil: 'networkidle2' });
        }
      } else {
        await page.goto(config.task.url, { waitUntil: 'networkidle2' });
      }
    } catch (navError) {
      // Ignore navigation errors
    }
  }
}

/**
 * Click on the "Completed" menu button to navigate back to the list
 */
export async function clickCompletedButton(page: puppeteer.Page): Promise<boolean> {
  try {
    logMessage('Looking for "Completed" menu button to return to list...');
    await waitRandomTime(500, 1000);
    
    // Try multiple selectors to find the "Completed" link
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
          // Find the one that contains "Completed" text
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
    
    // Alternative: Search by text content
    if (!completedLink) {
      logMessage('Trying to find "Completed" link by text content...');
      const allLinks = await page.$$('a[data-sidebar="menu-sub-button"], a[href*="completed"]');
      
      for (const link of allLinks) {
        try {
          const text = await page.evaluate(el => el.textContent?.trim() || '', link);
          const href = await page.evaluate(el => el.getAttribute('href') || '', link);
          
          if ((text.toLowerCase().includes('completed') || href.includes('/completed')) && 
              text.toLowerCase() === 'completed') {
            completedLink = link;
            logMessage(`Found "Completed" link by text: "${text}"`);
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }
    
    if (completedLink) {
      // Scroll into view if needed
      await page.evaluate((el) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, completedLink);
      await waitRandomTime(300, 500);
      
      // Click on the "Completed" link
      await completedLink.click();
      logMessage('Clicked on "Completed" menu button');
      await waitRandomTime(2000, 3000);
      
      // Wait for navigation
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {
          // Navigation might complete before timeout
        });
      } catch (navError) {
        // Navigation timeout is okay
      }
      
      logMessage('Navigation to "Completed" section completed');
      return true;
    } else {
      logMessage('Warning: "Completed" menu button not found', 'WARNING');
      return false;
    }
  } catch (error: any) {
    logMessage(`Error clicking "Completed" button: ${error.message}`, 'WARNING');
    return false;
  }
}

/**
 * Check for "Delivery Issue" text on the current page and extract issue details
 * Returns object with hasIssue flag and issueText (if found)
 */
export async function checkForDeliveryIssue(page: puppeteer.Page, orderCode: string): Promise<{ hasIssue: boolean; issueText?: string }> {
  try {
    logMessage(`Checking for "Delivery Issue" on order page: ${orderCode}`);
    
    // Wait for page content to load
    await waitRandomTime(1000, 2000);
    
    // First, try to find the specific Delivery Issue element
    // Structure: <section> -> <section class="c-lclPzm c-dpsiik"> -> <div class="c-dhzjXW"> -> 
    //            <div class="c-icyInw c-icyInw-dCkkOO-layout-stack"> -> <span>Delivery Issue</span>
    let issueText: string | undefined = undefined;
    
    try {
      // Look for issue containers by their CSS classes, not by text content
      let issueElement: puppeteer.ElementHandle | null = null;
      let hasIssuesSection = false;
      
      // Strategy 0: Find the main issues section by header structure (by container class)
      // <header class="c-eAHfU"><div class="c-cmpvrW"><div class="c-dhzjXW">...
      const issuesHeader = await page.evaluateHandle(() => {
        // Search for header with class c-eAHfU that contains h3
        const headers = document.querySelectorAll('header.c-eAHfU, header[class*="c-eAHfU"]');
        for (const header of headers) {
          const h3 = header.querySelector('h3');
          if (h3) {
            // Find the parent section that contains this header
            let parent = header.parentElement;
            while (parent) {
              if (parent.tagName === 'SECTION' || parent.tagName === 'section') {
                return parent as HTMLElement;
              }
              parent = parent.parentElement;
            }
            return header.parentElement as HTMLElement || header as HTMLElement;
          }
        }
        return null;
      });
      
      if (issuesHeader && (await page.evaluate(el => el !== null, issuesHeader))) {
        hasIssuesSection = true;
        logMessage('Found issues section header - issues section exists');
        
        // Search for ALL issue sections by their container classes (NOT by text)
        // <section class="c-lclPzm c-dpsiik"> contains each issue
        const allIssuesInSection = await page.evaluateHandle((sectionEl) => {
          // Find all sections with class c-lclPzm (each represents an issue)
          const issueSections = sectionEl.querySelectorAll('section.c-lclPzm, section[class*="c-lclPzm"]');
          
          if (issueSections.length > 0) {
            // Return the parent container that holds all issues
            return sectionEl as HTMLElement;
          }
          
          return null;
        }, issuesHeader);
        
        if (allIssuesInSection && (await page.evaluate(el => el !== null, allIssuesInSection))) {
          // Verify that the section contains the word "issue" or "issues" to avoid false positives
          const sectionText = await page.evaluate(el => el.textContent?.toLowerCase() || '', allIssuesInSection);
          if (sectionText.includes('issue') || sectionText.includes('issues')) {
            issueElement = allIssuesInSection as puppeteer.ElementHandle;
            const issueCount = await page.evaluate((el) => el.querySelectorAll('section.c-lclPzm, section[class*="c-lclPzm"]').length, issuesHeader);
            logMessage(`Found ${issueCount} issue section(s) by container class (verified with "issue/issues" text)`);
          } else {
            logMessage('Found section with issue structure but no "issue/issues" text - skipping (false positive)', 'WARNING');
          }
        }
      }
      
      // Strategy 1: Look for issue sections by container class c-lclPzm c-dpsiik (NOT by text)
      // <section class="c-lclPzm c-dpsiik"> - this is the issue container
      if (!issueElement) {
        const issueSections = await page.$$('section.c-lclPzm, section[class*="c-lclPzm"]');
        
        if (issueSections.length > 0) {
          // Check if they have the issue structure (div.c-dhzjXW > div.c-icyInw-dCkkOO-layout-stack)
          const validSections: puppeteer.ElementHandle[] = [];
          
          for (const section of issueSections) {
            const hasIssueStructure = await page.evaluate((el) => {
              // Check for the structure: section > div.c-dhzjXW > div.c-icyInw-dCkkOO-layout-stack
              const dhzjXW = el.querySelector('div.c-dhzjXW, div[class*="c-dhzjXW"]');
              if (dhzjXW) {
                const stackDiv = dhzjXW.querySelector('div.c-icyInw-dCkkOO-layout-stack, div[class*="c-icyInw"][class*="layout-stack"]');
                return !!stackDiv;
              }
              return false;
            }, section);
            
            // Also verify that it contains the word "issue" or "issues" to avoid false positives
            if (hasIssueStructure) {
              const sectionText = await page.evaluate(el => el.textContent?.toLowerCase() || '', section);
              if (sectionText.includes('issue') || sectionText.includes('issues')) {
                validSections.push(section);
              } else {
                logMessage('Found section with issue structure but no "issue/issues" text - skipping (false positive)', 'WARNING');
              }
            }
          }
          
          if (validSections.length > 0) {
            // If multiple issues, we need to get the parent container
            if (validSections.length > 1) {
              // Find the common parent section
              const parentSection = await page.evaluateHandle(() => {
                const sections = document.querySelectorAll('section');
                for (const section of sections) {
                  const issueSections = section.querySelectorAll('section.c-lclPzm, section[class*="c-lclPzm"]');
                  if (issueSections.length > 0) {
                    return section as HTMLElement;
                  }
                }
                return null;
              });
              
              if (parentSection && (await page.evaluate(el => el !== null, parentSection))) {
                issueElement = parentSection as puppeteer.ElementHandle;
                logMessage(`Found ${validSections.length} issue section(s) by container class c-lclPzm`);
              } else {
                issueElement = validSections[0];
                logMessage(`Found ${validSections.length} issue section(s), using first one`);
              }
            } else {
              issueElement = validSections[0];
              logMessage('Found issue section by container class c-lclPzm');
            }
          }
        }
      }
      
      // Strategy 2: Look for div with class c-icyInw-dCkkOO-layout-stack (issue content container) (by container class)
      // This is inside: <div class="c-dhzjXW"><div class="c-icyInw c-icyInw-dCkkOO-layout-stack">
      if (!issueElement) {
        const stackDivs = await page.$$('div.c-icyInw-dCkkOO-layout-stack, div[class*="c-icyInw"][class*="layout-stack"]');
        
        for (const div of stackDivs) {
          // Check if it has the issue structure (contains span with strong class and ul) - by structure, not text
          const hasIssueStructure = await page.evaluate((el) => {
            const strongSpan = el.querySelector('span[class*="c-AsWAM"], span[class*="strong"]');
            const list = el.querySelector('ul');
            return !!(strongSpan && list);
          }, div);
          
          if (hasIssueStructure) {
            // Verify that it contains the word "issue" or "issues" to avoid false positives
            const divText = await page.evaluate(el => el.textContent?.toLowerCase() || '', div);
            if (divText.includes('issue') || divText.includes('issues')) {
              // Find the parent section.c-lclPzm if it exists (by container class)
              const parentSection = await page.evaluateHandle((divEl) => {
                let parent = divEl.parentElement;
                while (parent) {
                  if (parent.tagName === 'SECTION' || parent.tagName === 'section') {
                    const classAttr = parent.getAttribute('class') || '';
                    if (classAttr.includes('c-lclPzm')) {
                      return parent as HTMLElement;
                    }
                  }
                  parent = parent.parentElement;
                }
                return null;
              }, div);
              
              if (parentSection && (await page.evaluate(el => el !== null, parentSection))) {
                issueElement = parentSection as puppeteer.ElementHandle;
                logMessage('Found issue section by locating c-icyInw-dCkkOO-layout-stack and finding parent section (by container class)');
              } else {
                issueElement = div;
                logMessage('Found issue container by class c-icyInw-dCkkOO-layout-stack');
              }
              break;
            } else {
              logMessage('Found div with issue structure but no "issue/issues" text - skipping (false positive)', 'WARNING');
            }
          }
        }
      }
      
      // Strategy 3: Look for div with class c-dhzjXW that contains issue structure (by container class)
      // <div class="c-dhzjXW"><div class="c-icyInw c-icyInw-dCkkOO-layout-stack">
      if (!issueElement) {
        const dhzjXWDivs = await page.$$('div.c-dhzjXW, div[class*="c-dhzjXW"]');
        
        for (const div of dhzjXWDivs) {
          // Check if it contains the issue structure (by structure, not text)
          const hasIssueStructure = await page.evaluate((el) => {
            const stackDiv = el.querySelector('div.c-icyInw-dCkkOO-layout-stack, div[class*="c-icyInw"][class*="layout-stack"]');
            if (stackDiv) {
              const strongSpan = stackDiv.querySelector('span[class*="c-AsWAM"], span[class*="strong"]');
              const list = stackDiv.querySelector('ul');
              return !!(strongSpan && list);
            }
            return false;
          }, div);
          
          if (hasIssueStructure) {
            // Verify that it contains the word "issue" or "issues" to avoid false positives
            const divText = await page.evaluate(el => el.textContent?.toLowerCase() || '', div);
            if (divText.includes('issue') || divText.includes('issues')) {
              // Find the parent section.c-lclPzm if it exists (by container class)
              const parentSection = await page.evaluateHandle((divEl) => {
                let parent = divEl.parentElement;
                while (parent) {
                  if (parent.tagName === 'SECTION' || parent.tagName === 'section') {
                    const classAttr = parent.getAttribute('class') || '';
                    if (classAttr.includes('c-lclPzm')) {
                      return parent as HTMLElement;
                    }
                  }
                  parent = parent.parentElement;
                }
                return null;
              }, div);
              
              if (parentSection && (await page.evaluate(el => el !== null, parentSection))) {
                issueElement = parentSection as puppeteer.ElementHandle;
                logMessage('Found issue section by locating c-dhzjXW and finding parent section (by container class)');
              } else {
                issueElement = div;
                logMessage('Found issue container by class c-dhzjXW');
              }
              break;
            } else {
              logMessage('Found div with issue structure but no "issue/issues" text - skipping (false positive)', 'WARNING');
            }
          }
        }
      }
      
      // Strategy 4: Look for div with class c-jgJhHL c-PJLV c-PJLV-igwGVI-layout-vertical containing issue dispute structure
      // Structure: <div class="c-jgJhHL c-PJLV c-PJLV-igwGVI-layout-vertical">
      //            <section class="c-lclPzm c-dpsiik"> with "Issue dispute is pending" or similar
      if (!issueElement) {
        const disputeContainers = await page.$$('div.c-jgJhHL, div[class*="c-jgJhHL"]');
        
        for (const container of disputeContainers) {
          // Check if it contains the dispute issue structure
          const hasDisputeStructure = await page.evaluate((el) => {
            // Look for section with class c-lclPzm c-dpsiik inside
            const section = el.querySelector('section.c-lclPzm, section[class*="c-lclPzm"]');
            if (section) {
              // Check if it contains h3 with "Issue dispute" or similar text
              const h3 = section.querySelector('h3');
              if (h3) {
                const h3Text = (h3.textContent || '').toLowerCase();
                if (h3Text.includes('issue') || h3Text.includes('dispute')) {
                  return true;
                }
              }
              // Also check if section contains "Issues:" text
              const sectionText = (section.textContent || '').toLowerCase();
              if (sectionText.includes('issues:') || sectionText.includes('issue dispute')) {
                return true;
              }
            }
            return false;
          }, container);
          
          if (hasDisputeStructure) {
            // Verify that it contains issue-related content
            const containerText = await page.evaluate(el => el.textContent?.toLowerCase() || '', container);
            if (containerText.includes('issue') || containerText.includes('dispute') || containerText.includes('issues')) {
              // Use the entire container to capture all text content (including h3, description, email, and issues list)
              issueElement = container;
              logMessage('Found issue dispute container by class c-jgJhHL - will capture all text content');
              break;
            }
          }
        }
      }
      
      if (issueElement) {
        // Extract text content from ALL issues, excluding buttons
        issueText = await page.evaluate((el) => {
          // Check if this is the parent section containing multiple issue sections
          const issueSections = el.querySelectorAll('section.c-lclPzm, section[class*="c-lclPzm"]');
          
          if (issueSections.length > 0) {
            // Extract text from all issue sections
            const allIssueTexts: string[] = [];
            
            issueSections.forEach((issueSection) => {
              const clone = issueSection.cloneNode(true) as HTMLElement;
              
              // Remove all buttons from the clone
              const buttons = clone.querySelectorAll('button');
              buttons.forEach(btn => btn.remove());
              
              // Get text content without buttons
              const text = clone.textContent || clone.innerText || '';
              if (text.trim()) {
                allIssueTexts.push(text.trim());
              }
            });
            
            return allIssueTexts.join('\n\n');
          } else {
            // Single issue element - extract text excluding buttons
            const clone = el.cloneNode(true) as HTMLElement;
            
            // Remove all buttons from the clone
            const buttons = clone.querySelectorAll('button');
            buttons.forEach(btn => btn.remove());
            
            // Get text content without buttons
            return (clone.textContent || clone.innerText || '').trim();
          }
        }, issueElement);
        
        if (issueText && issueText.trim().length > 0) {
          // Check if it contains any issue-related content
          const hasIssueContent = issueText.toLowerCase().includes('delivery issue') ||
                                 issueText.toLowerCase().includes('missing food') ||
                                 issueText.toLowerCase().includes('issue') ||
                                 issueText.toLowerCase().includes('dispute') ||
                                 issueText.toLowerCase().includes('reported');
          
          if (hasIssueContent) {
            logMessage(`Issue(s) found on order page: ${orderCode}`, 'WARNING');
            logMessage(`Issue details: ${issueText.substring(0, 300)}${issueText.length > 300 ? '...' : ''}`);
          } else {
            logMessage(`Found element but text does not appear to be an issue: ${issueText?.substring(0, 100)}`, 'WARNING');
            issueText = undefined;
          }
        } else {
          logMessage('Found issue element but could not extract text', 'WARNING');
          issueText = undefined;
        }
      } else {
        if (hasIssuesSection) {
          logMessage('Found "Issues related to this order" header but could not locate specific issue elements', 'WARNING');
          // Even if we can't find the specific element, if the header exists, there might be issues
          // We'll rely on the fallback text search
        } else {
          logMessage('Could not find any issue elements using any strategy');
        }
      }
    } catch (elementError: any) {
      logMessage(`Error finding Delivery Issue element: ${elementError.message}`, 'WARNING');
    }
    
    // Fallback: Check page text content if element not found
    if (!issueText) {
      const pageText = await page.evaluate(() => {
        return document.body.innerText || document.body.textContent || '';
      });
      
      // Check for any type of issue
      const hasAnyIssue = pageText.toLowerCase().includes('delivery issue') ||
                         pageText.toLowerCase().includes('missing food') ||
                         pageText.toLowerCase().includes('issue dispute') ||
                         (pageText.toLowerCase().includes('issues related to this order') && 
                          (pageText.toLowerCase().includes('reported') ||
                           pageText.toLowerCase().includes('missing') ||
                           pageText.toLowerCase().includes('late')));
      
      if (hasAnyIssue) {
        logMessage(`Issue(s) found in page text (element not found): ${orderCode}`, 'WARNING');
        // Try to extract issue text from page
        issueText = await page.evaluate(() => {
          // Look for text containing "Issues related to this order" and extract content after it
          const allText = document.body.innerText || '';
          const issuesIndex = allText.toLowerCase().indexOf('issues related to this order');
          if (issuesIndex !== -1) {
            // Extract a reasonable amount of text after "Issues related to this order"
            const extracted = allText.substring(issuesIndex, issuesIndex + 800);
            return extracted.trim();
          }
          // Look for "Issue dispute is pending" or similar
          const disputeIndex = allText.toLowerCase().indexOf('issue dispute');
          if (disputeIndex !== -1) {
            // Extract more text for dispute structure which can be longer
            const extracted = allText.substring(disputeIndex, disputeIndex + 1000);
            return extracted.trim();
          }
          // Fallback: look for "Delivery Issue" or "Missing Food"
          const deliveryIndex = allText.toLowerCase().indexOf('delivery issue');
          if (deliveryIndex !== -1) {
            return allText.substring(deliveryIndex, deliveryIndex + 500).trim();
          }
          const missingIndex = allText.toLowerCase().indexOf('missing food');
          if (missingIndex !== -1) {
            return allText.substring(missingIndex, missingIndex + 500).trim();
          }
          return '';
        });
      } else {
        logMessage(`No issues found on order page: ${orderCode}`);
      }
    }
    
    // Check if any issue was found (Delivery Issue, Missing Food, Dispute, or any other issue)
    const hasIssue = !!issueText && (
      issueText.toLowerCase().includes('delivery issue') ||
      issueText.toLowerCase().includes('missing food') ||
      issueText.toLowerCase().includes('issue dispute') ||
      issueText.toLowerCase().includes('dispute is pending') ||
      issueText.toLowerCase().includes('issues related to this order') ||
      (issueText.toLowerCase().includes('reported') && issueText.toLowerCase().includes('order'))
    );
    
    return {
      hasIssue,
      issueText: hasIssue ? issueText : undefined
    };
  } catch (error: any) {
    logMessage(`Error checking for Delivery Issue: ${error.message}`, 'WARNING');
    return { hasIssue: false }; // Default to success if we can't check
  }
}

/**
 * Calculate and display statistics by account
 */
export function calculateAccountStats(results: OrderResult[]): AccountStats[] {
  const accountMap = new Map<string, { codes: string[], success: number, failure: number }>();
  
  // Group results by account
  for (const result of results) {
    if (!accountMap.has(result.account)) {
      accountMap.set(result.account, { codes: [], success: 0, failure: 0 });
    }
    
    const stats = accountMap.get(result.account)!;
    stats.codes.push(result.orderCode);
    
    if (result.status === 'success') {
      stats.success++;
    } else {
      stats.failure++;
    }
  }
  
  // Convert to AccountStats array
  const accountStats: AccountStats[] = [];
  
  for (const [account, stats] of accountMap.entries()) {
    const total = stats.success + stats.failure;
    const successRate = total > 0 ? (stats.success / total) * 100 : 0;
    
    accountStats.push({
      account,
      orderCodes: stats.codes,
      successCount: stats.success,
      failureCount: stats.failure,
      totalCount: total,
      successRate: Math.round(successRate * 100) / 100 // Round to 2 decimals
    });
  }
  
  return accountStats;
}

/**
 * Display statistics summary
 */
export function displayStatistics(results: OrderResult[]): void {
  logMessage('');
  logMessage('=== ORDER PROCESSING STATISTICS ===');
  logMessage('');
  
  const accountStats = calculateAccountStats(results);
  
  // Statistics by account
  for (const stats of accountStats) {
    logMessage(`Account: ${stats.account}`);
    
    // Get all results for this account
    const accountResults = results.filter(r => r.account === stats.account);
    
    // Separate success and failure orders
    const successOrders = accountResults.filter(r => r.status === 'success').map(r => r.orderCode);
    const failureOrders = accountResults.filter(r => r.status === 'failure');
    
    logMessage(`  Order Codes: ${stats.orderCodes.join(', ')}`);
    logMessage(`  Success: ${stats.successCount}`);
    if (successOrders.length > 0) {
      logMessage(`    ✓ Success Orders: ${successOrders.join(', ')}`);
    }
    logMessage(`  Failure: ${stats.failureCount}`);
    if (failureOrders.length > 0) {
      logMessage(`    ✗ Failure Orders:`);
      for (const failure of failureOrders) {
        logMessage(`      - ${failure.orderCode}`);
        if (failure.issueDetails) {
          // Clean up issue text (remove extra whitespace, limit length)
          const cleanIssue = failure.issueDetails
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 300);
          logMessage(`        Issue: ${cleanIssue}${failure.issueDetails.length > 300 ? '...' : ''}`);
        }
      }
    }
    logMessage(`  Total: ${stats.totalCount}`);
    logMessage(`  Success Rate: ${stats.successRate}%`);
    logMessage('');
  }
  
  // Total statistics
  const totalSuccess = results.filter(r => r.status === 'success').length;
  const totalFailure = results.filter(r => r.status === 'failure').length;
  const totalOrders = results.length;
  const totalSuccessRate = totalOrders > 0 ? Math.round((totalSuccess / totalOrders) * 100 * 100) / 100 : 0;
  
  logMessage('=== TOTAL STATISTICS ===');
  logMessage(`Total Orders Processed: ${totalOrders}`);
  logMessage(`Total Success: ${totalSuccess}`);
  logMessage(`Total Failure: ${totalFailure}`);
  logMessage(`Overall Success Rate: ${totalSuccessRate}%`);
  logMessage('');
  
  // Detailed list of all orders with status
  logMessage('=== DETAILED ORDER LIST ===');
  const successList = results.filter(r => r.status === 'success').map(r => r.orderCode);
  const failureList = results.filter(r => r.status === 'failure');
  
  if (successList.length > 0) {
    logMessage(`Success Orders (${successList.length}): ${successList.join(', ')}`);
  }
  
  if (failureList.length > 0) {
    logMessage(`Failure Orders (${failureList.length}):`);
    for (const failure of failureList) {
      logMessage(`  ✗ ${failure.orderCode} (Account: ${failure.account})`);
      if (failure.issueDetails) {
        const cleanIssue = failure.issueDetails
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 300);
        logMessage(`    Issue: ${cleanIssue}${failure.issueDetails.length > 300 ? '...' : ''}`);
      }
    }
  }
  logMessage('');
}

/**
 * Generate unified report in markdown format
 */
export function generateUnifiedReport(
  results: OrderResult[],
  filterDate: string | undefined,
  accountsWithNoOrders: string[],
  accountsWithLoginIssues: string[],
  orderCodeTracking?: { valid: string[]; processed: string[]; notFound: string[] }
): string {
  // Get date for report (use filterDate or current date)
  const reportDate = filterDate || new Date().toISOString().split('T')[0];
  const [year, month, day] = reportDate.split('-').map(Number);
  const dayNumber = day;
  
  // Calculate account statistics
  const accountStats = calculateAccountStats(results);
  
  // Build report content
  let report = `# Reporte Unificado de Procesamiento de Órdenes\n`;
  report += `## Fecha de las Órdenes: ${reportDate} (Día ${dayNumber})\n\n`;
  report += `---\n\n`;
  
  // === ESTADÍSTICAS DE PROCESAMIENTO DE ÓRDENES ===
  report += `## === ESTADÍSTICAS DE PROCESAMIENTO DE ÓRDENES ===\n\n`;
  
  for (const stats of accountStats) {
    const accountResults = results.filter(r => r.account === stats.account);
    const successOrders = accountResults.filter(r => r.status === 'success').map(r => r.orderCode);
    const failureOrders = accountResults.filter(r => r.status === 'failure');
    
    report += `### Account: ${stats.account}\n`;
    report += `- Order Codes: ${stats.orderCodes.join(', ')}\n`;
    report += `- Success: ${stats.successCount}\n`;
    
    if (successOrders.length > 0) {
      report += `  - ✓ Success Orders: ${successOrders.join(', ')}\n`;
    }
    
    report += `- Failure: ${stats.failureCount}\n`;
    
    if (failureOrders.length > 0) {
      report += `  - ✗ Failure Orders:\n`;
      for (const failure of failureOrders) {
        report += `    - ${failure.orderCode}\n`;
        if (failure.issueDetails) {
          const cleanIssue = failure.issueDetails
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
          report += `      - Issue: ${cleanIssue}${failure.issueDetails.length > 200 ? '...' : ''}\n`;
        }
      }
    }
    
    report += `- Total: ${stats.totalCount}\n`;
    report += `- Success Rate: ${stats.successRate}%\n\n`;
    report += `---\n\n`;
  }
  
  // === ESTADÍSTICAS TOTALES ===
  const totalSuccess = results.filter(r => r.status === 'success').length;
  const totalFailure = results.filter(r => r.status === 'failure').length;
  const totalOrders = results.length;
  const totalSuccessRate = totalOrders > 0 ? Math.round((totalSuccess / totalOrders) * 100 * 100) / 100 : 0;
  
  report += `## === ESTADÍSTICAS TOTALES ===\n\n`;
  report += `Todas las órdenes procesadas corresponden al día ${dayNumber} de ${getMonthName(month)} de ${year} (${reportDate})\n\n`;
  report += `- Total Orders Processed: ${totalOrders}\n`;
  report += `- Total Success: ${totalSuccess}\n`;
  report += `- Total Failure: ${totalFailure}\n`;
  report += `- Overall Success Rate: ${totalSuccessRate}%\n`;
  report += `- Fecha de las órdenes: ${reportDate} (Día ${dayNumber})\n\n`;
  report += `---\n\n`;
  
  // === LISTA DETALLADA DE ÓRDENES ===
  report += `## === LISTA DETALLADA DE ÓRDENES ===\n\n`;
  
  const successList = results.filter(r => r.status === 'success').map(r => r.orderCode);
  const failureList = results.filter(r => r.status === 'failure');
  
  report += `### Success Orders (${successList.length} totales)\n\n`;
  if (successList.length > 0) {
    report += `${successList.join(', ')}\n\n`;
  } else {
    report += `No hay órdenes exitosas.\n\n`;
  }
  
  report += `---\n\n`;
  
  report += `### Failure Orders (${failureList.length} totales)\n\n`;
  if (failureList.length > 0) {
    for (const failure of failureList) {
      report += `- ${failure.orderCode}\n`;
      if (failure.issueDetails) {
        const cleanIssue = failure.issueDetails
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 200);
        report += `  - Issue: ${cleanIssue}${failure.issueDetails.length > 200 ? '...' : ''}\n`;
      }
    }
    report += `\n`;
  } else {
    report += `No hay órdenes fallidas.\n\n`;
  }
  
  report += `---\n\n`;
  
  // === RESUMEN DE PROCESAMIENTO DE CUENTAS ===
  report += `## === RESUMEN DE PROCESAMIENTO DE CUENTAS ===\n\n`;
  
  const successfulAccounts = accountStats.filter(s => s.totalCount > 0);
  report += `### Cuentas Procesadas Exitosamente (${successfulAccounts.length} cuentas)\n\n`;
  
  if (successfulAccounts.length > 0) {
    let accountNumber = 1;
    for (const stats of successfulAccounts) {
      const successRate = stats.totalCount > 0 ? Math.round((stats.successCount / stats.totalCount) * 100) : 0;
      report += `${accountNumber}. ✓ ${stats.account} - ${stats.totalCount} orden${stats.totalCount !== 1 ? 'es' : ''} (${successRate}% éxito)\n`;
      accountNumber++;
    }
    report += `\n`;
  } else {
    report += `No hay cuentas con órdenes procesadas.\n\n`;
  }
  
  report += `### Cuentas Sin Órdenes Encontradas\n\n`;
  if (accountsWithNoOrders.length > 0) {
    for (const account of accountsWithNoOrders) {
      report += `- ⚠ ${account}\n`;
    }
    report += `\n`;
  } else {
    report += `Todas las cuentas tienen órdenes procesadas.\n\n`;
  }
  
  if (accountsWithLoginIssues.length > 0) {
    report += `### Cuentas Con Problemas de Login\n\n`;
    for (const account of accountsWithLoginIssues) {
      report += `- ✗ ${account}\n`;
    }
    report += `\n`;
  }
  
  report += `---\n\n`;
  
  // === RESUMEN DE SEGUIMIENTO DE CÓDIGOS DE ÓRDEN ===
  if (orderCodeTracking) {
    report += `## === RESUMEN DE SEGUIMIENTO DE CÓDIGOS DE ÓRDEN ===\n\n`;
    report += `Todas las órdenes corresponden al día ${dayNumber} de ${getMonthName(month)} de ${year} (${reportDate})\n\n`;
    
    report += `### Códigos Totales\n\n`;
    report += `- Total valid codes (día ${dayNumber}): ${orderCodeTracking.valid.length}\n`;
    report += `- Codes processed (día ${dayNumber}): ${orderCodeTracking.processed.length}\n`;
    report += `- Codes not found (día ${dayNumber}): ${orderCodeTracking.notFound.length}\n\n`;
    
    report += `### Códigos No Encontrados (${orderCodeTracking.notFound.length})\n\n`;
    if (orderCodeTracking.notFound.length > 0) {
      report += `${orderCodeTracking.notFound.join(', ')}\n\n`;
    } else {
      report += `Todos los códigos fueron encontrados y procesados exitosamente.\n\n`;
    }
    
    report += `---\n\n`;
  }
  
  // === ANÁLISIS DE RESULTADOS ===
  report += `## === ANÁLISIS DE RESULTADOS ===\n\n`;
  
  report += `### Distribución de Éxito por Cuenta\n\n`;
  report += `| Cuenta | Órdenes | Éxito | Fracaso | Tasa de Éxito |\n`;
  report += `|--------|---------|-------|---------|---------------|\n`;
  
  for (const stats of accountStats) {
    const successRate = stats.totalCount > 0 ? Math.round((stats.successCount / stats.totalCount) * 100) : 0;
    report += `| ${stats.account} | ${stats.totalCount} | ${stats.successCount} | ${stats.failureCount} | ${successRate}% |\n`;
  }
  
  report += `| TOTAL | ${totalOrders} | ${totalSuccess} | ${totalFailure} | ${totalSuccessRate}% |\n\n`;
  
  report += `### Análisis de Problemas\n\n`;
  if (totalFailure === 0 && accountsWithLoginIssues.length === 0) {
    report += `No se encontraron problemas en el procesamiento. Todas las órdenes fueron procesadas exitosamente.\n\n`;
  } else {
    if (totalFailure > 0) {
      report += `Se encontraron ${totalFailure} orden${totalFailure !== 1 ? 'es' : ''} con problemas de entrega.\n\n`;
    }
    if (accountsWithLoginIssues.length > 0) {
      report += `Se encontraron ${accountsWithLoginIssues.length} cuenta${accountsWithLoginIssues.length !== 1 ? 's' : ''} con problemas de login.\n\n`;
    }
  }
  
  report += `---\n\n`;
  
  return report;
}

/**
 * Helper function to get month name in Spanish
 */
function getMonthName(month: number): string {
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  return months[month - 1] || '';
}

/**
 * Save unified report to file as an additional independent file
 * Each execution creates a new file with timestamp to avoid overwriting
 * Reports are saved in a separate 'reports' folder
 */
export function saveUnifiedReport(
  reportContent: string,
  filterDate: string | undefined,
  config: BotConfig
): string {
  const reportDate = filterDate || new Date().toISOString().split('T')[0];
  // Use dedicated reports folder (separate from logs)
  const reportsDir = 'reports';
  
  // Generate report filename with date only (format: reporte_unificado_YYYY-MM-DD.md)
  const reportFileName = `reporte_unificado_${reportDate}.md`;
  const reportPath = `${reportsDir}/${reportFileName}`;
  
  // Ensure reports directory exists
  try {
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
      logMessage(`Created reports directory: ${reportsDir}`);
    }
  } catch (error: any) {
    logMessage(`Warning: Could not create reports directory: ${error.message}`, 'WARNING');
  }
  
  // Write report file (as an additional independent file)
  try {
    writeFileSync(reportPath, reportContent, 'utf8');
    logMessage(`✓ Unified report saved: ${reportPath}`);
    logMessage(`  → Report file will be overwritten if run multiple times on the same date`);
    logMessage(`  → Reports are saved in the 'reports' folder (ignored by git)`);
    return reportPath;
  } catch (error: any) {
    logMessage(`Error saving unified report: ${error.message}`, 'ERROR');
    return '';
  }
}

// ============================================================================
// Google Drive API Integration
// ============================================================================

// Cache for Google Drive client
let driveClient: any = null;
let lastDriveClientInit: number = 0;
const DRIVE_CLIENT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

// Cache for Gmail client
let gmailClient: any = null;
let lastGmailClientInit: number = 0;
const GMAIL_CLIENT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Initialize Google Drive client using Service Account credentials
 */
async function initGoogleDriveClient(credentialsPath: string): Promise<any> {
  try {
    // Use cached client if available and not expired
    const now = Date.now();
    if (driveClient && (now - lastDriveClientInit) < DRIVE_CLIENT_CACHE_MS) {
      return driveClient;
    }

    logMessage('Initializing Google Drive client...');
    
    // Read credentials file
    const credentialsContent = readFileSync(credentialsPath, 'utf8');
    const credentials = JSON.parse(credentialsContent);
    
    // Create auth client using JWT
    // Note: Using drive scope (not drive.file) to support Shared Drives
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    
    await auth.authorize();
    
    // Create Drive client
    driveClient = google.drive({
      version: 'v3',
      auth: auth
    });
    
    lastDriveClientInit = now;
    logMessage('✓ Google Drive client initialized');
    
    return driveClient;
  } catch (error: any) {
    logMessage(`Error initializing Google Drive client: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Find or create a folder in Google Drive
 */
async function findOrCreateFolder(drive: any, parentFolderId: string, folderName: string): Promise<string> {
  try {
    // Search for existing folder (support Shared Drives)
    const response = await drive.files.list({
      q: `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives'
    });
    
    if (response.data.files && response.data.files.length > 0) {
      logMessage(`✓ Found existing folder: ${folderName}`);
      return response.data.files[0].id;
    }
    
    // Create folder if it doesn't exist (support Shared Drives)
    logMessage(`Creating folder: ${folderName}...`);
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      },
      fields: 'id',
      supportsAllDrives: true
    });
    
    logMessage(`✓ Created folder: ${folderName}`);
    return createResponse.data.id!;
  } catch (error: any) {
    logMessage(`Error finding/creating folder ${folderName}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Find a file by name in a folder
 */
async function findFileByName(drive: any, parentFolderId: string, fileName: string): Promise<string | null> {
  try {
    const response = await drive.files.list({
      q: `'${parentFolderId}' in parents and name='${fileName}' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives'
    });
    
    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }
    
    return null;
  } catch (error: any) {
    logMessage(`Error finding file ${fileName}: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Upload or update a file in Google Drive
 * If file exists, updates it; otherwise creates new one
 */
async function uploadOrUpdateFile(drive: any, parentFolderId: string, localFilePath: string, driveFileName: string, mimeType: string = 'text/plain'): Promise<boolean> {
  try {
    if (!existsSync(localFilePath)) {
      logMessage(`File does not exist locally: ${localFilePath}`, 'WARNING');
      return false;
    }
    
    // Read file content
    const fileContent = readFileSync(localFilePath, 'utf8');
    
    // Check if file exists in Drive
    const existingFileId = await findFileByName(drive, parentFolderId, driveFileName);
    
    if (existingFileId) {
      // Update existing file (support Shared Drives)
      logMessage(`Updating existing file in Drive: ${driveFileName}...`);
      await drive.files.update({
        fileId: existingFileId,
        requestBody: {
          name: driveFileName
        },
        media: {
          mimeType: mimeType,
          body: fileContent
        },
        supportsAllDrives: true
      });
      logMessage(`✓ Updated file in Drive: ${driveFileName}`);
    } else {
      // Create new file (support Shared Drives)
      logMessage(`Uploading new file to Drive: ${driveFileName}...`);
      await drive.files.create({
        requestBody: {
          name: driveFileName,
          parents: [parentFolderId]
        },
        media: {
          mimeType: mimeType,
          body: fileContent
        },
        fields: 'id',
        supportsAllDrives: true
      });
      logMessage(`✓ Uploaded file to Drive: ${driveFileName}`);
    }
    
    return true;
  } catch (error: any) {
    logMessage(`Error uploading/updating file ${driveFileName}: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Upload logs and reports to Google Drive
 * Uploads: bot logs and unified reports
 */
export async function uploadLogsAndReportsToGoogleDrive(config: BotConfig): Promise<void> {
  try {
    // Check if Google Drive is enabled
    if (!config.googleDrive || !config.googleDrive.enabled) {
      return; // Silently skip if not enabled
    }
    
    // Validate configuration
    if (!config.googleDrive.credentialsPath || !config.googleDrive.folderId) {
      logMessage('Google Drive credentials or folder ID not configured', 'WARNING');
      return;
    }
    
    // Check if credentials file exists
    const credentialsPath = path.resolve(projectRoot, config.googleDrive.credentialsPath);
    if (!existsSync(credentialsPath)) {
      logMessage(`Google Drive credentials file not found: ${credentialsPath}`, 'WARNING');
      return;
    }
    
    logMessage('Starting Google Drive upload...');
    
    // Initialize Drive client
    const drive = await initGoogleDriveClient(credentialsPath);
    const rootFolderId = config.googleDrive.folderId;
    
    const folderStructure = config.googleDrive.folderStructure || {
      logs: 'logs',
      reports: 'reports'
    };
    
    const organizeReportsByDate = config.googleDrive.organizeReportsByDate !== false;
    
    // Get current date for file matching
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // 1. Upload bot logs
    try {
      const logsPath = config.paths.logsPath || path.join(projectRoot, 'logs');
      const logFileName = `bot_${dateStr}.log`;
      const logFilePath = path.join(logsPath, logFileName);
      
      if (existsSync(logFilePath)) {
        const logsFolderId = await findOrCreateFolder(drive, rootFolderId, folderStructure.logs);
        await uploadOrUpdateFile(drive, logsFolderId, logFilePath, logFileName);
      }
    } catch (error: any) {
      logMessage(`Error uploading bot logs: ${error.message}`, 'ERROR');
    }
    
    // 2. Upload unified reports
    try {
      const reportsDir = path.join(projectRoot, 'reports');
      if (existsSync(reportsDir)) {
        const reportsFolderId = await findOrCreateFolder(drive, rootFolderId, folderStructure.reports);
        
        // Find all report files
        const files = readdirSync(reportsDir);
        const reportFiles = files.filter((file: string) => 
          file.startsWith('reporte_unificado_') && file.endsWith('.md')
        );
        
        for (const fileName of reportFiles) {
          try {
            const localFilePath = path.join(reportsDir, fileName);
            
            // Extract date from filename: reporte_unificado_YYYY-MM-DD.md
            const dateMatch = fileName.match(/reporte_unificado_(\d{4}-\d{2}-\d{2})\.md/);
            const fileDate = dateMatch ? dateMatch[1] : dateStr;
            
            let targetFolderId = reportsFolderId;
            
            // If organize by date is enabled, create/use date subfolder
            if (organizeReportsByDate) {
              targetFolderId = await findOrCreateFolder(drive, reportsFolderId, fileDate);
            }
            
            // Always update reports (they may change)
            await uploadOrUpdateFile(drive, targetFolderId, localFilePath, fileName, 'text/markdown');
          } catch (error: any) {
            logMessage(`Error uploading report file ${fileName}: ${error.message}`, 'ERROR');
          }
        }
      }
    } catch (error: any) {
      logMessage(`Error uploading reports: ${error.message}`, 'ERROR');
    }
    
    logMessage('✓ Google Drive upload completed');
  } catch (error: any) {
    logMessage(`Error in Google Drive upload process: ${error.message}`, 'ERROR');
  }
}

// ============================================================================
// Gmail API Integration (Alternative to Puppeteer)
// ============================================================================

/**
 * Initialize Gmail client using Service Account with Domain-Wide Delegation
 */
async function initGmailClient(credentialsPath: string, gmailUserEmail: string): Promise<any> {
  try {
    // Use cached client if available and not expired
    const now = Date.now();
    if (gmailClient && (now - lastGmailClientInit) < GMAIL_CLIENT_CACHE_MS) {
      return gmailClient;
    }

    logMessage('Initializing Gmail client...');
    
    // Read credentials file
    const credentialsContent = readFileSync(credentialsPath, 'utf8');
    const credentials = JSON.parse(credentialsContent);
    
    // Create auth client using JWT with Domain-Wide Delegation
    // Note: Service Accounts need Domain-Wide Delegation configured in Google Workspace Admin Console
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      subject: gmailUserEmail // Impersonate this user (required for Domain-Wide Delegation)
    });
    
    await auth.authorize();
    
    // Create Gmail client
    gmailClient = google.gmail({
      version: 'v1',
      auth: auth
    });
    
    lastGmailClientInit = now;
    logMessage(`✓ Gmail client initialized for user: ${gmailUserEmail}`);
    
    return gmailClient;
  } catch (error: any) {
    logMessage(`Error initializing Gmail client: ${error.message}`, 'ERROR');
    if (error.message.includes('Precondition check failed') || error.message.includes('403') || error.message.includes('401')) {
      logMessage('Service Account cannot access Gmail. This requires Domain-Wide Delegation setup.', 'WARNING');
      logMessage('Configure Domain-Wide Delegation in Google Workspace Admin Console.', 'WARNING');
    }
    throw error;
  }
}

/**
 * Get Gmail label ID by name
 */
async function getGmailLabelId(gmail: any, userId: string, labelName: string): Promise<string | null> {
  try {
    const response = await gmail.users.labels.list({
      userId: userId
    });
    
    if (!response.data.labels) {
      return null;
    }
    
    // Search for label by name (case-insensitive)
    const label = response.data.labels.find((l: any) => 
      l.name.toLowerCase() === labelName.toLowerCase()
    );
    
    if (label) {
      logMessage(`Found Gmail label "${labelName}" with ID: ${label.id}`);
      return label.id;
    }
    
    logMessage(`Gmail label "${labelName}" not found`, 'WARNING');
    return null;
  } catch (error: any) {
    logMessage(`Error getting Gmail label ID: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Decode email body from base64url format
 */
function decodeEmailBody(body: any): string {
  if (!body || !body.data) {
    return '';
  }
  
  // Gmail uses base64url encoding (not standard base64)
  // Replace - with + and _ with /
  const base64 = body.data.replace(/-/g, '+').replace(/_/g, '/');
  
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch (error) {
    logMessage('Error decoding email body', 'WARNING');
    return '';
  }
}

/**
 * Extract verification code from email body
 */
function extractVerificationCode(emailBody: string, codePattern?: string): string | null {
  // First, try to extract code after "Your verification code is:"
  const verificationCodePattern = /Your verification code is:\s*(\d{4,8})/i;
  const verificationMatch = emailBody.match(verificationCodePattern);
  
  if (verificationMatch && verificationMatch[1]) {
    return verificationMatch[1];
  }
  
  // Fallback: Extract code using general regex pattern
  const pattern = codePattern || '\\b\\d{4,8}\\b';
  const regex = new RegExp(pattern);
  const match = emailBody.match(regex);
  
  if (match && match[0]) {
    return match[0];
  }
  
  return null;
}

/**
 * Get verification code from Gmail using API (alternative to Puppeteer)
 * This function uses Gmail API to search for emails by label and subject
 */
export async function getVerificationCodeFromGmailAPI(
  config: BotConfig,
  account?: Account
): Promise<string | null> {
  try {
    if (!config.gmail) {
      logMessage('Gmail configuration not found', 'ERROR');
      return null;
    }

    // Check if Google Drive config exists (we reuse the same credentials)
    const credentialsPath = config.googleDrive?.credentialsPath;
    const gmailUserEmail = config.googleDrive?.gmailUserEmail;
    
    if (!credentialsPath || !gmailUserEmail) {
      logMessage('Gmail API credentials not configured. Need credentialsPath and gmailUserEmail in googleDrive config.', 'WARNING');
      return null;
    }

    const resolvedCredentialsPath = path.resolve(projectRoot, credentialsPath);
    if (!existsSync(resolvedCredentialsPath)) {
      logMessage(`Gmail credentials file not found: ${resolvedCredentialsPath}`, 'WARNING');
      return null;
    }

    logMessage('Using Gmail API to retrieve verification code...');

    // Initialize Gmail client
    const gmail = await initGmailClient(resolvedCredentialsPath, gmailUserEmail);
    const gmailConfig = config.gmail;

    // Get label ID if configured
    let labelId: string | null = null;
    if (account?.gmailLabel) {
      logMessage(`Searching for emails with label: "${account.gmailLabel}"`);
      labelId = await getGmailLabelId(gmail, gmailUserEmail, account.gmailLabel);
      if (labelId) {
        logMessage(`Found label ID: ${labelId}`);
      } else {
        logMessage(`Warning: Could not find label "${account.gmailLabel}", will search without label filter`, 'WARNING');
      }
    }

    // Build multiple search strategies (from most specific to least specific)
    const searchStrategies: string[] = [];
    
    // Strategy 1: Full query with label and from:support
    if (labelId) {
      searchStrategies.push(`subject:"${gmailConfig.subject}" label:${labelId} from:support`);
    }
    
    // Strategy 2: With label, without from:support
    if (labelId) {
      searchStrategies.push(`subject:"${gmailConfig.subject}" label:${labelId}`);
    }
    
    // Strategy 3: Without label, with from:support
    searchStrategies.push(`subject:"${gmailConfig.subject}" from:support`);
    
    // Strategy 4: Just subject
    searchStrategies.push(`subject:"${gmailConfig.subject}"`);
    
    // Strategy 5: Subject without quotes
    searchStrategies.push(`subject:${gmailConfig.subject}`);
    
    // Strategy 6: Keywords from subject
    const subjectKeywords = gmailConfig.subject.toLowerCase().split(' ');
    if (subjectKeywords.length > 0) {
      searchStrategies.push(`${subjectKeywords[0]} ${subjectKeywords[1] || ''} verification code`.trim());
    }

    logMessage(`Trying ${searchStrategies.length} search strategies...`);

    // Try each search strategy
    let response: any = null;
    let successfulQuery = '';
    
    for (const searchQuery of searchStrategies) {
      logMessage(`Trying search query: ${searchQuery}`);
      
      try {
        const testResponse = await gmail.users.messages.list({
          userId: gmailUserEmail,
          q: searchQuery,
          maxResults: 10
        });
        
        if (testResponse.data.messages && testResponse.data.messages.length > 0) {
          response = testResponse;
          successfulQuery = searchQuery;
          logMessage(`✓ Found ${testResponse.data.messages.length} email(s) with query: ${searchQuery}`);
          break;
        } else {
          logMessage(`  No results with this query`);
        }
      } catch (listError: any) {
        logMessage(`  Error with this query: ${listError.message}`, 'WARNING');
        // Continue to next strategy
      }
    }

    // If still no results, try to list recent emails for debugging
    if (!response || !response.data.messages || response.data.messages.length === 0) {
      logMessage(`No emails found with any search strategy`, 'WARNING');
      logMessage('Attempting to list recent emails for debugging...', 'WARNING');
      
      try {
        // List recent emails (last 20) to help diagnose
        const recentResponse = await gmail.users.messages.list({
          userId: gmailUserEmail,
          maxResults: 20
        });
        
        if (recentResponse.data.messages && recentResponse.data.messages.length > 0) {
          logMessage(`Found ${recentResponse.data.messages.length} recent email(s). Checking subjects...`, 'WARNING');
          
          // Get subjects of recent emails
          const subjects: string[] = [];
          for (let i = 0; i < Math.min(5, recentResponse.data.messages.length); i++) {
            try {
              const msg = await gmail.users.messages.get({
                userId: gmailUserEmail,
                id: recentResponse.data.messages[i].id!,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From']
              });
              
              const headers = msg.data.payload?.headers || [];
              const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No subject';
              const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
              subjects.push(`  - Subject: "${subject}" | From: ${from}`);
            } catch (e) {
              // Skip if can't get email
            }
          }
          
          if (subjects.length > 0) {
            logMessage('Recent email subjects:', 'WARNING');
            subjects.forEach(s => logMessage(s, 'WARNING'));
          }
        }
      } catch (debugError: any) {
        logMessage(`Could not list recent emails: ${debugError.message}`, 'WARNING');
      }
      
      logMessage('This could mean:', 'WARNING');
      logMessage('  - No emails with the specified subject have been received yet', 'WARNING');
      logMessage('  - The label filter is too restrictive', 'WARNING');
      logMessage('  - The email is in a different label or folder', 'WARNING');
      logMessage('  - The subject format has changed', 'WARNING');
      logMessage(`  - Expected subject: "${gmailConfig.subject}"`, 'WARNING');
      return null;
    }

    logMessage(`Found ${response.data.messages.length} email(s) with query: ${successfulQuery}`);
    logMessage('Checking emails for verification code...');

    // Check emails from most recent to oldest
    for (const message of response.data.messages) {
      try {
        // Get full message
        const messageResponse = await gmail.users.messages.get({
          userId: gmailUserEmail,
          id: message.id!,
          format: 'full'
        });

        const messageData = messageResponse.data;
        
        // Extract email body
        let emailBody = '';
        
        if (messageData.payload) {
          // Check if message has parts (multipart)
          if (messageData.payload.parts) {
            // Find text/plain or text/html part
            for (const part of messageData.payload.parts) {
              if (part.mimeType === 'text/plain' && part.body?.data) {
                emailBody = decodeEmailBody(part.body);
                logMessage(`Extracted email body from text/plain part (email ${message.id})`);
                break;
              } else if (part.mimeType === 'text/html' && part.body?.data && !emailBody) {
                // Use HTML as fallback
                emailBody = decodeEmailBody(part.body);
                logMessage(`Extracted email body from text/html part (email ${message.id})`);
              }
            }
          } else if (messageData.payload.body?.data) {
            // Single part message
            emailBody = decodeEmailBody(messageData.payload.body);
            logMessage(`Extracted email body from single part message (email ${message.id})`);
          }
        }

        if (!emailBody) {
          logMessage(`Could not extract body from email ${message.id}`, 'WARNING');
          continue;
        }

        // Log a preview of the email body for debugging
        const emailPreview = emailBody.substring(0, 200).replace(/\n/g, ' ');
        logMessage(`Email body preview: ${emailPreview}...`);

        // Extract verification code
        const code = extractVerificationCode(emailBody, gmailConfig.codePattern);
        
        if (code) {
          logMessage(`✓ Verification code extracted from email ${message.id}: ${code}`);
          return code;
        } else {
          logMessage(`No verification code found in email ${message.id}`, 'WARNING');
          logMessage(`  Email body length: ${emailBody.length} characters`);
          logMessage(`  Pattern used: ${gmailConfig.codePattern || '\\b\\d{4,8}\\b'}`);
        }
      } catch (error: any) {
        logMessage(`Error processing email ${message.id}: ${error.message}`, 'WARNING');
        continue;
      }
    }

    logMessage('Could not extract verification code from any email', 'WARNING');
    return null;
  } catch (error: any) {
    logMessage(`Error getting verification code from Gmail API: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Click on order links that match the provided codes
 */
/**
 * Search and click order codes using the search input field
 * This function searches for each code individually using the search input
 */
export async function searchAndClickOrderCodes(
  page: puppeteer.Page, 
  orderCodes: string[], 
  config: BotConfig, 
  accountUsername?: string
): Promise<{ clicked: number; notFound: string[]; processed: string[] }> {
  const clicked: string[] = [];
  const notFound: string[] = [];
  const processed: string[] = [];
  
  try {
    logMessage(`Starting search-based order processing for ${orderCodes.length} codes`);
    
    // Normalize order codes (uppercase, trimmed)
    const normalizedCodes = orderCodes.map(code => code.trim().toUpperCase());
    
    logMessage('Starting individual code searches...');
    
    // Get already processed codes from tracking
    const tracking = (global as any).orderCodeTracking;
    const alreadyProcessed = tracking ? new Set(tracking.processed || []) : new Set<string>();
    
    // Process each order code (skip already processed ones)
    for (const targetCode of normalizedCodes) {
      // Skip if already processed
      if (alreadyProcessed.has(targetCode)) {
        logMessage(`Skipping code ${targetCode} - already processed`);
        continue;
      }
      
      try {
        // Re-find the search input on each iteration (in case page changed)
        // <input placeholder="#2SC-A6B" class="c-cbYRkH c-iOQlBr..." type="search">
        const searchInput = await page.$('input[type="search"][placeholder*="#"], input[type="search"].c-cbYRkH, input[type="search"]');
        
        if (!searchInput) {
          logMessage(`ERROR: Search input not found for code: ${targetCode}`, 'ERROR');
          notFound.push(targetCode);
          continue;
        }
        
        // Clear the search input
        await searchInput.click({ clickCount: 3 }); // Triple click to select all
        await waitRandomTime(200, 500);
        await page.keyboard.press('Delete');
        await waitRandomTime(200, 500);
        
        // Type the order code (with # prefix if needed)
        const searchText = targetCode.startsWith('#') ? targetCode : `#${targetCode}`;
        await searchInput.type(searchText, { delay: 100 });
        await waitRandomTime(500, 1000);
        
        // Press Enter to search
        logMessage(`Searching for order code: ${targetCode}...`);
        await page.keyboard.press('Enter');
        
        // Wait for search results to load
        await waitRandomTime(2000, 3000);
        try {
          await page.waitForSelector('tbody tr[data-test="orderRow"]', { timeout: 5000 });
        } catch (waitError) {
          logMessage(`No results found for code: ${targetCode}`, 'WARNING');
          notFound.push(targetCode);
          continue;
        }
        
        // Extract order data from rows using page.evaluate to avoid detached element errors
        const orderData = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('tbody tr[data-test="orderRow"]'));
          const results: Array<{ code: string; href: string; dateText: string }> = [];
          
          for (const row of rows) {
            const link = row.querySelector('td a[href^="/orders/"], td a[href*="/orders/"]') as HTMLAnchorElement;
            if (!link) continue;
            
            const code = link.textContent?.trim() || '';
            const href = link.getAttribute('href') || '';
            
            // Get date text
            const dateDiv = row.querySelector('td div.ez-l8l8b8.ecbuoh21, td div[class*="ez-l8l8b8"]') as HTMLElement;
            const dateText = dateDiv?.textContent?.trim() || '';
            
            results.push({ code, href, dateText });
          }
          
          return results;
        });
        
        if (orderData.length === 0) {
          logMessage(`No order rows found for code: ${targetCode}`, 'WARNING');
          notFound.push(targetCode);
          continue;
        }
        
        // Find the matching order in the results
        let foundMatch = false;
        for (const orderInfo of orderData) {
          try {
            const normalizedOrderCode = orderInfo.code.toUpperCase().replace('#', '');
            
            // Check if code matches
            if (normalizedOrderCode === targetCode || normalizedOrderCode.includes(targetCode)) {
              // Verify date if filterDate is configured
              if (config.task.filterDate && config.task.filterDate.trim() !== '') {
                const parsedDate = parseDateFromElement(orderInfo.dateText);
                if (parsedDate) {
                  const [year, month, day] = config.task.filterDate.split('-').map(Number);
                  const targetDate = new Date(year, month - 1, day);
                  if (!datesMatch(parsedDate, targetDate)) {
                    logMessage(`Order ${orderInfo.code} found but date does not match filter, skipping`, 'WARNING');
                    continue;
                  }
                }
              }
              
              // Found matching order, click it using the href
              logMessage(`Found matching order: "${orderInfo.code}", clicking...`);
              
              // Navigate directly to the order page using the href
              await page.goto(new URL(orderInfo.href, page.url()).href, { waitUntil: 'networkidle2' });
              
              clicked.push(targetCode);
              processed.push(targetCode);
              foundMatch = true;
              
              // Mark as processed in global tracking
              if (typeof (global as any).orderCodeTracking !== 'undefined') {
                const globalTracking = (global as any).orderCodeTracking;
                if (!globalTracking.processed.includes(targetCode)) {
                  globalTracking.processed.push(targetCode);
                }
              }
              
              logMessage(`Navigated to order: "${orderInfo.code}"`);
              
              // Wait for order page to load
              await waitRandomTime(2000, 3000);
              
              // Check for issues
              const issueCheck = await checkForDeliveryIssue(page, orderInfo.code);
              
              // Store result
              const result: OrderResult = {
                orderCode: orderInfo.code,
                account: accountUsername || 'unknown',
                status: issueCheck.hasIssue ? 'failure' : 'success',
                timestamp: new Date(),
                issueDetails: issueCheck.issueText
              };
              
              if (typeof (global as any).orderResults === 'undefined') {
                (global as any).orderResults = [];
              }
              (global as any).orderResults.push(result);
              
              if (issueCheck.hasIssue) {
                logMessage(`Order "${orderInfo.code}": FAILURE (Issue found)`);
                if (issueCheck.issueText) {
                  logMessage(`  Issue details: ${issueCheck.issueText.substring(0, 200)}${issueCheck.issueText.length > 200 ? '...' : ''}`);
                }
              } else {
                logMessage(`Order "${orderInfo.code}": SUCCESS (No Issue)`);
              }
              
              // Go back to the list
              await waitRandomTime(1000, 2000);
              const currentUrl = page.url();
              if (!currentUrl.includes('/completed')) {
                logMessage('Navigating back to "Completed" list...');
                await page.goto(config.task.url + '/completed', { waitUntil: 'networkidle2' });
                await waitRandomTime(2000, 3000);
                // Wait for list to load
                await page.waitForSelector('tbody tr[data-test="orderRow"]', { timeout: 10000 }).catch(() => {});
              }
              
              break; // Found and processed, move to next code
            }
          } catch (error: any) {
            logMessage(`Error processing order data: ${error.message}`, 'WARNING');
            continue;
          }
        }
        
        if (!foundMatch) {
          logMessage(`Order code "${targetCode}" not found in search results`, 'WARNING');
          notFound.push(targetCode);
        }
        
      } catch (error: any) {
        logMessage(`Error processing order code "${targetCode}": ${error.message}`, 'WARNING');
        notFound.push(targetCode);
        continue;
      }
    }
    
    logMessage(`Search-based processing complete: ${clicked.length} clicked, ${notFound.length} not found`);
    return { clicked: clicked.length, notFound, processed };
    
  } catch (error: any) {
    logMessage(`Error in search-based order processing: ${error.message}`, 'WARNING');
    return { clicked: clicked.length, notFound: normalizedCodes.filter(c => !processed.includes(c)), processed };
  }
}

/**
 * Verify if an order row matches the target date
 */
async function verifyOrderDate(row: puppeteer.ElementHandle, targetDateStr: string, page: puppeteer.Page): Promise<boolean> {
  try {
    // Parse target date (format: YYYY-MM-DD)
    const [year, month, day] = targetDateStr.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    
    // Find date element in the row
    // <td class="ez-1avyp1d erotkni0"><div title="" class="ez-l8l8b8 ecbuoh21">Thu, Jan. 29, 12:30 PM</div>
    const dateDiv = await row.$('td div.ez-l8l8b8.ecbuoh21, td div[class*="ez-l8l8b8"][class*="ecbuoh21"], td div.ez-l8l8b8');
    if (!dateDiv) return false;
    
    const dateText = await page.evaluate(el => el.textContent?.trim() || '', dateDiv);
    if (!dateText) return false;
    
    // Use existing parseDateFromElement function
    const rowDate = parseDateFromElement(dateText);
    if (!rowDate) return false;
    
    // Use existing datesMatch function
    return datesMatch(rowDate, targetDate);
  } catch (error) {
    return false;
  }
}

export async function clickMatchingOrderLinks(page: puppeteer.Page, orderCodes: string[], config: BotConfig, accountUsername?: string): Promise<void> {
  try {
    logMessage(`Clicking on order links matching codes: ${orderCodes.slice(0, 10).join(', ')}${orderCodes.length > 10 ? '...' : ''}`);
    
    // Wait for table to load
    await waitRandomTime(1000, 2000);
    
    // Normalize order codes (uppercase, trimmed)
    const normalizedCodes = orderCodes.map(code => code.trim().toUpperCase());
    
    let clickedCount = 0;
    let notFoundCount = 0;
    
    // Process each order code
    for (const targetCode of normalizedCodes) {
      try {
        // Find all order code links in visible rows
        const orderLinks = await page.$$('td a[href^="/orders/"], td a[href*="/orders/"]');
        
        let found = false;
        
        for (const link of orderLinks) {
          try {
            // Check if this link is visible (not hidden by filter)
            const isVisible = await page.evaluate((el) => {
              const row = el.closest('tr');
              if (!row) return false;
              const style = window.getComputedStyle(row);
              return style.display !== 'none' && style.visibility !== 'hidden';
            }, link);
            
            if (!isVisible) continue;
            
            const orderCodeText = await page.evaluate(el => el.textContent?.trim() || '', link);
            const normalizedOrderCode = orderCodeText.toUpperCase();
            
            // Check if this order code matches
            if (normalizedOrderCode === targetCode || normalizedOrderCode.includes(targetCode)) {
              logMessage(`Found matching order: "${orderCodeText}", clicking...`);
              
              // Scroll into view
              await page.evaluate((el) => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, link);
              await waitRandomTime(300, 500);
              
              // Click on the order link
              await link.click();
              clickedCount++;
              found = true;
              
              logMessage(`Clicked on order: "${orderCodeText}"`);
              
              // Wait for order page to load
              await waitRandomTime(2000, 3000);
              try {
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {
                  // Navigation might complete before timeout
                });
              } catch (navError) {
                // Continue anyway
              }
              
              // Check for "Delivery Issue" text on the page
              const issueCheck = await checkForDeliveryIssue(page, orderCodeText);
              
              // Store result
              const result: OrderResult = {
                orderCode: orderCodeText,
                account: accountUsername || 'unknown',
                status: issueCheck.hasIssue ? 'failure' : 'success',
                timestamp: new Date(),
                issueDetails: issueCheck.issueText
              };
              
              // Store result in global results array
              if (typeof (global as any).orderResults === 'undefined') {
                (global as any).orderResults = [];
              }
              (global as any).orderResults.push(result);
              
              if (issueCheck.hasIssue) {
                logMessage(`Order "${orderCodeText}": FAILURE (Delivery Issue found)`);
                if (issueCheck.issueText) {
                  logMessage(`  Issue details: ${issueCheck.issueText.substring(0, 200)}${issueCheck.issueText.length > 200 ? '...' : ''}`);
                }
              } else {
                logMessage(`Order "${orderCodeText}": SUCCESS (No Delivery Issue)`);
              }
              
              // Go back to the list by clicking the "Completed" button
              await waitRandomTime(1000, 2000);
              const currentUrl = page.url();
              if (!currentUrl.includes('/completed')) {
                logMessage('Clicking "Completed" button to return to list...');
                const clickedCompleted = await clickCompletedButton(page);
                
                if (clickedCompleted) {
                  // Wait for list to load
                  await waitRandomTime(2000, 3000);
                  
                  // Re-apply filters if needed
                  if (config.task.filterDate && config.task.filterDate.trim() !== '') {
                    await filterOrdersByDate(page, config.task.filterDate);
                  }
                  
                  // Re-apply order code filter
                  await filterOrdersByCodes(page, normalizedCodes);
                } else {
                  // Fallback: navigate directly if button click failed
                  logMessage('Falling back to direct navigation...', 'WARNING');
                  await page.goto(config.task.url + '/completed', { waitUntil: 'networkidle2' });
                  await waitRandomTime(2000, 3000);
                  
                  // Re-apply filters if needed
                  if (config.task.filterDate && config.task.filterDate.trim() !== '') {
                    await filterOrdersByDate(page, config.task.filterDate);
                  }
                  
                  // Re-apply order code filter
                  await filterOrdersByCodes(page, normalizedCodes);
                }
              } else {
                logMessage('Already on completed page, no need to navigate');
              }
              
              break; // Found and clicked, move to next code
            }
          } catch (error: any) {
            logMessage(`Error checking link: ${error.message}`, 'WARNING');
            continue;
          }
        }
        
        if (!found) {
          notFoundCount++;
          logMessage(`Order code "${targetCode}" not found in visible rows`, 'WARNING');
        }
      } catch (error: any) {
        logMessage(`Error processing order code "${targetCode}": ${error.message}`, 'WARNING');
        continue;
      }
    }
    
    logMessage(`Order clicking complete: ${clickedCount} clicked, ${notFoundCount} not found`);
    
    if (clickedCount === 0 && notFoundCount > 0) {
      logMessage(`⚠ No orders were clicked for account. All ${notFoundCount} order code(s) were not found in the visible list.`, 'WARNING');
    } else if (clickedCount === 0 && notFoundCount === 0) {
      logMessage(`⚠ No orders were processed. No matching order codes found in the list.`, 'WARNING');
    }
  } catch (error: any) {
    logMessage(`Error clicking order links: ${error.message}`, 'WARNING');
  }
}

/**
 * Filter orders by order codes - hide rows that don't match the provided codes
 */
export async function filterOrdersByCodes(page: puppeteer.Page, orderCodes: string[]): Promise<void> {
  try {
    logMessage(`Filtering orders by codes: ${orderCodes.slice(0, 10).join(', ')}${orderCodes.length > 10 ? '...' : ''} (${orderCodes.length} total)`);
    
    // Wait for table to load - specifically wait for order rows
    logMessage('Waiting for order list to load before filtering...');
    try {
      await page.waitForSelector('tbody tr[data-test="orderRow"]', { timeout: 10000 });
      await waitRandomTime(1000, 2000);
    } catch (waitError) {
      logMessage('Warning: Could not verify order rows are loaded, proceeding anyway', 'WARNING');
      await waitRandomTime(1000, 2000);
    }
    
    // Normalize order codes (uppercase, trimmed)
    const normalizedCodes = orderCodes.map(code => code.trim().toUpperCase());
    
    let matchedCount = 0;
    let hiddenCount = 0;
    
    // Process each row in the table - prioritize orderRow selector
    const tableRows = await page.$$('tbody tr[data-test="orderRow"], tbody tr, table tr[role="row"], tr');
    
    logMessage(`Found ${tableRows.length} rows to check`);
    
    for (const row of tableRows) {
      try {
        // Find order code link in this row
        // <td class="e1kvfkjr1 ez-1s8spa1 erotkni0"><a href="/orders/287480495">1JV-32A</a></td>
        const orderCodeLink = await row.$('td a[href^="/orders/"], td a[href*="/orders/"]');
        
        if (orderCodeLink) {
          const orderCodeText = await page.evaluate(el => el.textContent?.trim() || '', orderCodeLink);
          const normalizedOrderCode = orderCodeText.toUpperCase();
          
          if (normalizedOrderCode) {
            // Check if this order code is in the list
            const isMatch = normalizedCodes.some(code => normalizedOrderCode === code || normalizedOrderCode.includes(code));
            
            if (isMatch) {
              matchedCount++;
              logMessage(`✓ Matched order code: "${orderCodeText}"`);
            } else {
              // Hide this row
              await page.evaluate((el) => {
                (el as HTMLElement).style.display = 'none';
              }, row);
              hiddenCount++;
              logMessage(`✗ Hidden row with order code: "${orderCodeText}"`);
            }
          }
        }
      } catch (error: any) {
        // Continue with next row
        logMessage(`Error processing row: ${error.message}`, 'WARNING');
        continue;
      }
    }
    
    logMessage(`Order code filtering complete: ${matchedCount} matched, ${hiddenCount} hidden`);
  } catch (error: any) {
    logMessage(`Error filtering by order codes: ${error.message}`, 'WARNING');
  }
}

/**
 * Filter orders by date - hide rows that don't match the target date
 */
export async function filterOrdersByDate(page: puppeteer.Page, targetDateStr: string): Promise<void> {
  try {
    // Parse target date (format: YYYY-MM-DD)
    const [year, month, day] = targetDateStr.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day); // month is 0-indexed
    
    logMessage(`Filtering orders by date: ${targetDate.toLocaleDateString()} (${targetDateStr})`);
    
    // Wait for table to load - specifically wait for order rows
    logMessage('Waiting for order list to load before filtering...');
    try {
      await page.waitForSelector('tbody tr[data-test="orderRow"]', { timeout: 10000 });
      await waitRandomTime(1000, 2000);
    } catch (waitError) {
      logMessage('Warning: Could not verify order rows are loaded, proceeding anyway', 'WARNING');
      await waitRandomTime(1000, 2000);
    }
    
    let matchedCount = 0;
    let hiddenCount = 0;
    
    // Process each row in the table - prioritize orderRow selector
    const tableRows = await page.$$('tbody tr[data-test="orderRow"], tbody tr, table tr[role="row"], tr');
    
    logMessage(`Found ${tableRows.length} rows to check`);
    
    for (const row of tableRows) {
      try {
        // Find date cell in this row - look for the specific structure
        // <td class="ez-1avyp1d erotkni0"><div class="ez-l8l8b8 ecbuoh21">Tue, Jan. 27, Noon</div>
        const dateCell = await row.$('td .ez-l8l8b8.ecbuoh21, td div.ez-l8l8b8.ecbuoh21, td[class*="ez-"] div[class*="ez-l8l8b8"]');
        
        if (dateCell) {
          const dateText = await page.evaluate(el => el.textContent?.trim() || '', dateCell);
          
          if (dateText) {
            const parsedDate = parseDateFromElement(dateText);
            
            if (parsedDate) {
              if (datesMatch(parsedDate, targetDate)) {
                matchedCount++;
                logMessage(`✓ Matched date: "${dateText}" -> ${parsedDate.toLocaleDateString()}`);
              } else {
                // Hide this row
                await page.evaluate((el) => {
                  (el as HTMLElement).style.display = 'none';
                }, row);
                hiddenCount++;
                logMessage(`✗ Hidden row with date: "${dateText}" (${parsedDate.toLocaleDateString()})`);
              }
            } else {
              logMessage(`Could not parse date from: "${dateText}"`, 'WARNING');
            }
          }
        }
      } catch (error: any) {
        // Continue with next row
        logMessage(`Error processing row: ${error.message}`, 'WARNING');
        continue;
      }
    }
    
    logMessage(`Date filtering complete: ${matchedCount} matched, ${hiddenCount} hidden`);
  } catch (error: any) {
    logMessage(`Error filtering by date: ${error.message}`, 'WARNING');
  }
}

/**
 * Perform login with username and password, handling verification code if needed
 */
export async function performLogin(
  page: puppeteer.Page,
  browser: puppeteer.Browser,
  account: Account,
  config: BotConfig
): Promise<{ success: boolean; error?: string }> {
  if (!config.gmail) {
    return { success: false, error: 'Gmail configuration not found' };
  }

  const gmailConfig = config.gmail;

  try {
    logMessage(`Attempting login for user: ${account.username}`);

    // Wait for login form to be available
    const loginSelector = gmailConfig.loginSelector || 'input[type="email"], input[name="username"], input[name="email"], #username, #email';
    const passwordSelector = gmailConfig.passwordSelector || 'input[type="password"], input[name="password"], #password';
    const loginButtonSelector = gmailConfig.loginButtonSelector || 'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Login")';

    // Find and fill username
    try {
      await page.waitForSelector(loginSelector, { timeout: 10000 });
      const usernameInput = await page.$(loginSelector);
      if (usernameInput) {
        await usernameInput.click({ clickCount: 3 }); // Select all existing text
        await waitRandomTime(200, 500);
        await usernameInput.type(account.username, { delay: 50 });
        logMessage('Username entered');
        await waitRandomTime(500, 1000);
      } else {
        return { success: false, error: 'Username input not found' };
      }
    } catch (error: any) {
      return { success: false, error: `Error finding username input: ${error.message}` };
    }

    // Click login button or press Enter to proceed to password
    try {
      const loginButton = await page.$(loginButtonSelector);
      if (loginButton) {
        await loginButton.click();
        logMessage('Clicked login button to proceed to password field');
      } else {
        await page.keyboard.press('Enter');
        logMessage('Pressed Enter to proceed to password field');
      }
      
      // Wait for page to load after username submission
      logMessage('Waiting for page to load password field...');
      await waitRandomTime(2000, 3000);
      
      // Wait for navigation or page load
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {
          // Navigation might not happen, just wait for password field
        });
      } catch (navError) {
        // Navigation timeout is okay, we'll wait for the password field directly
      }
      
      // Additional wait to ensure password field is loaded
      await waitRandomTime(1000, 2000);
    } catch (error) {
      logMessage(`Warning during navigation to password field: ${error}`, 'WARNING');
      // Continue anyway and try to find password field
    }

    // Find and fill password
    try {
      await page.waitForSelector(passwordSelector, { timeout: 10000 });
      const passwordInput = await page.$(passwordSelector);
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await waitRandomTime(200, 500);
        await passwordInput.type(account.password, { delay: 50 });
        logMessage('Password entered');
        await waitRandomTime(500, 1000);
      } else {
        return { success: false, error: 'Password input not found' };
      }
    } catch (error: any) {
      return { success: false, error: `Error finding password input: ${error.message}` };
    }

    // Submit login form
    try {
      const submitButton = await page.$(loginButtonSelector);
      if (submitButton) {
        await submitButton.click();
        logMessage('Login form submitted');
      } else {
        await page.keyboard.press('Enter');
        logMessage('Login form submitted (Enter key)');
      }
      await waitRandomTime(3000, 4000);
    } catch (error) {
      // Continue anyway
    }

    // Optional step: Check for verification method selection screen
    // This appears before the code input in some cases
    try {
      logMessage('Checking for verification method selection screen...');
      const verificationMethodHeaderSelector = 'span.ulp-header-integrated-no-back-title';
      
      // Wait a bit for page to load after login submission
      await waitRandomTime(2000, 3000);
      
      const verificationMethodElement = await page.$(verificationMethodHeaderSelector);
      
      if (verificationMethodElement) {
        const methodText = await page.evaluate(el => el.textContent?.trim() || '', verificationMethodElement);
        
        if (methodText && methodText.toLowerCase().includes('select a method to verify')) {
          logMessage(`Found verification method selection screen: "${methodText}"`);
          
          // Look for the "Email" method button and click it
          // <button type="submit" name="action" aria-label="Email" value="email::0" ...>
          try {
            logMessage('Searching for "Email" verification method button...');
            
            // Primary selector by attributes
            const emailButtonSelector = 'button[type="submit"][name="action"][value^="email"]';
            let emailButton = await page.$(emailButtonSelector);
            
            // Fallback: search by text content "Email"
            if (!emailButton) {
              logMessage('Email button not found by attributes, searching by text...', 'WARNING');
              const buttons = await page.$$('button[type="submit"], button');
              for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent?.trim() || '', btn);
                const ariaLabel = await page.evaluate(el => el.getAttribute('aria-label') || '', btn);
                if (
                  text.toLowerCase().includes('email') ||
                  ariaLabel.toLowerCase().includes('email')
                ) {
                  emailButton = btn;
                  break;
                }
              }
            }
            
            if (emailButton) {
              // Scroll into view and click
              await page.evaluate(el => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, emailButton);
              await waitRandomTime(500, 1000);
              
              logMessage('Clicking "Email" verification method button...');
              await emailButton.click();
              await waitRandomTime(2000, 3000);
              logMessage('"Email" verification method selected');
            } else {
              logMessage('Could not find "Email" verification method button, continuing without selection', 'WARNING');
            }
          } catch (methodError: any) {
            logMessage(`Error while selecting \"Email\" verification method: ${methodError.message}`, 'WARNING');
          }
        }
      } else {
        logMessage('No verification method selection screen found, continuing with normal flow');
      }
    } catch (error: any) {
      logMessage(`Error checking for verification method screen: ${error.message}`, 'WARNING');
      // Continue with normal flow even if this check fails
    }

    // Check if verification code is required
    const codeInputSelector = gmailConfig.codeInputSelector || 'input[type="text"][name*="code"], input[type="text"][name*="verification"], input[type="text"][id*="code"], input[type="text"][id*="verification"], #verification-code, #code';
    
    try {
      await page.waitForSelector(codeInputSelector, { timeout: 5000 });
      logMessage('Verification code input detected - waiting 30 seconds for email to arrive...');

      // Wait 30 seconds after requesting the code before checking Gmail
      // This gives time for the email to be sent and delivered
      await waitRandomTime(30000, 30000); // Fixed 30 seconds wait
      logMessage('30 seconds elapsed - now checking Gmail for verification code...');

      // Now open Gmail and search for the verification code
      const codeWaitTimeout = gmailConfig.codeWaitTimeout || 30000;
      const maxRetries = gmailConfig.maxCodeRetries || 3;
      let code: string | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        logMessage(`Attempting to get verification code from Gmail (attempt ${attempt}/${maxRetries})...`);
        
        // Primary method: Try Gmail API first (if configured)
        // Fallback: Use Puppeteer if API is not available or fails
        // Gmail API can be used independently of Google Drive uploads
        // Only needs: credentialsPath and gmailUserEmail
        const credentialsPath = config.googleDrive?.credentialsPath;
        const gmailUserEmail = config.googleDrive?.gmailUserEmail;
        const canUseGmailAPI = credentialsPath && 
                               gmailUserEmail &&
                               credentialsPath.trim() !== '' &&
                               gmailUserEmail.trim() !== '';
        
        if (canUseGmailAPI) {
          logMessage('Using Gmail API (primary method) to retrieve verification code...');
          code = await getVerificationCodeFromGmailAPI(config, account);
          
          // If API succeeded, use the code
          if (code) {
            logMessage(`Verification code retrieved successfully via Gmail API: ${code}`);
            break;
          }
          
          // If API failed but we have more attempts, try Puppeteer as fallback
          if (attempt < maxRetries) {
            logMessage('Gmail API did not find code, trying Puppeteer as fallback...', 'WARNING');
            code = await getVerificationCodeFromGmail(browser, config, account);
            if (code) {
              logMessage(`Verification code retrieved successfully via Puppeteer (fallback): ${code}`);
              break;
            }
          }
        } else {
          // Gmail API not available, use Puppeteer
          logMessage('Gmail API not configured, using Puppeteer to retrieve verification code...');
          code = await getVerificationCodeFromGmail(browser, config, account);
          if (code) {
            logMessage(`Verification code retrieved successfully via Puppeteer: ${code}`);
            break;
          }
        }

        if (attempt < maxRetries) {
          logMessage(`Code not found yet. Waiting ${codeWaitTimeout / 1000}s before retry...`);
          await waitRandomTime(codeWaitTimeout, codeWaitTimeout);
        }
      }

      if (!code) {
        logMessage('Could not retrieve verification code from Gmail after all attempts', 'ERROR');
        logMessage('This could mean:', 'ERROR');
        logMessage('  - No verification email was received yet', 'ERROR');
        logMessage('  - The email is in a different label or folder', 'ERROR');
        logMessage('  - The email subject or format has changed', 'ERROR');
        logMessage('  - Domain-Wide Delegation is not properly configured', 'ERROR');
        return { success: false, error: 'Could not retrieve verification code from Gmail' };
      }

      // Return to the original page (login page) to enter the code
      logMessage('Returning to login page to enter verification code...');
      await page.bringToFront();
      await waitRandomTime(1000, 1500);
      
      // Ensure we're still on the code input page, if not, wait for it
      try {
        await page.waitForSelector(codeInputSelector, { timeout: 5000 });
        logMessage('Code input page is ready');
      } catch (error) {
        logMessage('Code input not immediately visible, waiting...', 'WARNING');
        await waitRandomTime(1000, 2000);
      }

      // Enter verification code
      logMessage(`Entering verification code: ${code}`);
      const codeInput = await page.$(codeInputSelector);
      if (codeInput) {
        // Focus on the code input field
        await codeInput.click({ clickCount: 3 }); // Select all existing text
        await waitRandomTime(200, 500);
        await codeInput.type(code, { delay: 100 });
        logMessage('Verification code entered successfully');
        await waitRandomTime(1000, 2000);

        // Submit verification code using continue button
        logMessage('Submitting verification code...');
        const continueButtonSelector = gmailConfig.continueButtonSelector || gmailConfig.loginButtonSelector || 'button[type="submit"][data-action-button-primary="true"], button[type="submit"]';
        const continueButton = await page.$(continueButtonSelector);
        if (continueButton) {
          await continueButton.click();
          logMessage('Clicked continue button after entering verification code');
        } else {
          await page.keyboard.press('Enter');
          logMessage('Pressed Enter after entering verification code');
        }
        await waitRandomTime(3000, 4000);
        logMessage('Waiting for login to complete after code submission...');
      } else {
        return { success: false, error: 'Verification code input not found after returning from Gmail' };
      }
    } catch (error: any) {
      // This catch block handles cases where the code input selector is not found
      // This could mean: login succeeded without code, or page structure changed
      logMessage(`Code input selector not found: ${error.message}`, 'WARNING');
      logMessage('This could mean:', 'WARNING');
      logMessage('  - Login succeeded without verification code', 'WARNING');
      logMessage('  - Page structure changed and selector needs update', 'WARNING');
      logMessage('  - Already logged in from previous session', 'WARNING');
      // Continue to check login status below
    }

    // Verify login was successful
    await waitRandomTime(2000, 3000);
    const loggedIn = await isLoggedIn(page, config);
    
    if (loggedIn) {
      logMessage('Login successful');
      
      return { success: true };
    } else {
      // If no logged in indicator is configured, assume success if we got past verification
      if (!gmailConfig.loggedInIndicator) {
        logMessage('Login completed (no indicator configured to verify)');
        
        // Still try to navigate to "Completed" even if we can't verify login
        try {
          logMessage('Attempting to navigate to "Completed" section...');
          await waitRandomTime(1000, 2000);
          const completedLink = await page.$('a[href="/completed"]');
          if (completedLink) {
            await completedLink.click();
            logMessage('Clicked on "Completed" menu item');
            await waitRandomTime(2000, 3000);
          }
        } catch (error) {
          // Ignore errors
        }
        
        return { success: true };
      }
      return { success: false, error: 'Login verification failed' };
    }

  } catch (error: any) {
    logMessage(`Error during login: ${error.message}`, 'ERROR');
    return { success: false, error: error.message };
  }
}

/**
 * Check list and click elements - Base implementation for establishment bot
 */
export async function checkListAndClick(config: BotConfig): Promise<{ processed: number, clicked: number, error?: string }> {
  const result = { processed: 0, clicked: 0, error: undefined as string | undefined };

  // Initialize global results array
  (global as any).orderResults = [];

  let browserResult: InitBrowserResult | null = null;

  try {
    logMessage('Starting establishment automation task...');

    // Process each account separately
    if (config.accounts && config.accounts.length > 0 && config.gmail) {
      // At the start of the process, check URL after loading and perform logout if needed
      const signInUrl = 'https://www.ezcater.com/caterer_portal/sign_in';
      let initialBrowserResult: InitBrowserResult | null = null;
      
      try {
        logMessage('Initializing browser to check initial URL...');
        initialBrowserResult = await initBrowser(config.task.url, 'default');
        
        if (initialBrowserResult.page && initialBrowserResult.browser) {
          const initialPage = initialBrowserResult.page;
          const initialBrowser = initialBrowserResult.browser;
          
          logMessage('Waiting for initial page to load...');
          await waitRandomTime(2000, 3000);
          
          // Check URL after page has loaded
          // Wait a bit more to ensure URL is stable
          await waitRandomTime(1000, 1500);
          const initialUrl = initialPage.url();
          logMessage(`Initial URL after page load: ${initialUrl}`);
          logMessage(`Expected sign_in URL: ${signInUrl}`);
          
          // Normalize URLs for comparison (remove trailing slashes, convert to lowercase)
          const normalizedInitialUrl = initialUrl.toLowerCase().replace(/\/$/, '');
          const normalizedSignInUrl = signInUrl.toLowerCase().replace(/\/$/, '');
          
          // Check if URL contains sign_in path or matches sign_in URL exactly
          const isSignInUrl = normalizedInitialUrl.includes('/sign_in') || 
                             normalizedInitialUrl === normalizedSignInUrl ||
                             normalizedInitialUrl.includes('caterer_portal/sign_in');
          
          logMessage(`URL comparison: isSignInUrl = ${isSignInUrl}`);
          
          // If URL is different from sign_in, perform logout
          // If URL is sign_in, continue with normal process (no logout needed)
          if (!isSignInUrl) {
            logMessage(`URL is different from sign_in (${initialUrl}), performing logout before continuing...`);
            
            // Perform logout
            await performLogout(initialPage, config, initialBrowser);
            logMessage('Logout completed, ready to continue with normal process');
          } else {
            logMessage(`URL is sign_in (${initialUrl}), continuing with normal process (no logout needed)`);
          }
          
          // Close the initial browser session
          await initialBrowser.close();
        } else {
          logMessage('Could not initialize browser for initial check, continuing anyway...', 'WARNING');
        }
      } catch (logoutError: any) {
        logMessage(`Error during initial URL check/logout: ${logoutError.message}, continuing anyway...`, 'WARNING');
      }
      
      logMessage('');
      logMessage('Starting to process accounts...');
      logMessage('');
      
      // Before starting the process, check if user is logged in using indicators and perform logout if needed
      let preProcessBrowserResult: InitBrowserResult | null = null;
      try {
        logMessage('Checking login status using indicators before starting process...');
        preProcessBrowserResult = await initBrowser(config.task.url, 'default');
        
        if (preProcessBrowserResult.page && preProcessBrowserResult.browser) {
          const preProcessPage = preProcessBrowserResult.page;
          const preProcessBrowser = preProcessBrowserResult.browser;
          
          logMessage('Waiting for page to load...');
          await waitRandomTime(2000, 3000);
          
          // Check if user is logged in using login indicators
          const isLoggedInBeforeProcess = await isLoggedIn(preProcessPage, config);
          
          if (isLoggedInBeforeProcess) {
            logMessage('User is logged in (detected by login indicators), performing logout before starting process...');
            await performLogout(preProcessPage, config, preProcessBrowser);
            logMessage('Logout completed before starting process');
          } else {
            logMessage('User is not logged in (no indicators found), no logout needed before starting process');
          }
          
          // Close the pre-process browser session
          await preProcessBrowser.close();
        } else {
          logMessage('Could not initialize browser for pre-process logout check, continuing anyway...', 'WARNING');
        }
      } catch (preProcessError: any) {
        logMessage(`Error during pre-process logout check: ${preProcessError.message}, continuing anyway...`, 'WARNING');
      }
      
      // Initialize a single browser for all accounts in this run
      browserResult = await initBrowser(config.task.url, 'default');

      if (!browserResult.page || !browserResult.browser) {
        result.error = browserResult.error || 'Failed to initialize browser for accounts processing';
        logMessage(result.error, 'ERROR');
        return result;
      }

      const page = browserResult.page;
      const browser = browserResult.browser;
      const profile = browserResult.profile;
      
      // Mark browser as protected to prevent age check timer from closing it during process
      if (profile) {
        profile.protected = true;
        logMessage('Browser marked as protected (will not be closed by age check timer during process)');
      }
      
      for (const account of config.accounts) {
        logMessage('');
        logMessage(`=== Processing account: ${account.username} ===`);
        logMessage('');
        
        try {
          logMessage('Waiting for page to load...');
          await waitRandomTime(2000, 3000);

          // Check if we need to navigate to sign_in page (only if URL is different)
          const currentUrl = page.url();
          const signInUrl = 'https://www.ezcater.com/caterer_portal/sign_in';
          
          if (!currentUrl.includes('/sign_in')) {
            logMessage(`Current page is not sign_in page (${currentUrl}), navigating to sign_in...`);
            await page.goto(signInUrl, { waitUntil: 'networkidle2' });
            await waitRandomTime(2000, 3000);
            logMessage('Navigated to sign_in page');
          } else {
            logMessage('Already on sign_in page, no navigation needed');
          }

          // Proceed with login (logout was already done before starting process if needed)
          logMessage(`Attempting login with account: ${account.username}...`);
          const loginResult = await performLogin(page, browser, account, config);
          
          if (!loginResult.success) {
            logMessage(`Login failed with account ${account.username}: ${loginResult.error}`, 'WARNING');
            // Keep browser open and try next account
            await waitRandomTime(2000, 3000);
            continue; // Try next account
          }
          
          logMessage(`Login successful with account: ${account.username}`);
          
          // Wait a bit after login before proceeding
          await waitRandomTime(2000, 3000);
          
          // Navigate back to the task URL if needed
          try {
            const currentUrl = page.url();
            const taskUrlObj = new URL(config.task.url);
            if (!currentUrl.includes(taskUrlObj.hostname)) {
              logMessage('Navigating back to task URL after login...');
              await page.goto(config.task.url, { waitUntil: 'networkidle2' });
              await waitRandomTime(2000, 3000);
            }
          } catch (urlError) {
            // If URL parsing fails, just try to navigate anyway
            logMessage('Navigating to task URL after login...');
            await page.goto(config.task.url, { waitUntil: 'networkidle2' });
            await waitRandomTime(2000, 3000);
          }

          // Clean up browser tabs before processing orders
          logMessage('Cleaning up browser tabs before processing orders...');
          await cleanupBrowserTabs(browser, page);

          // Process orders for this account
          // Navigate to "Completed" section after login
          try {
            logMessage('Looking for "Completed" menu item...');
            await waitRandomTime(1000, 2000);
            
            // Try multiple selectors to find the "Completed" link
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
                  // Find the one that contains "Completed" text
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
              // Scroll into view if needed
              await page.evaluate((el) => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, completedLink);
              await waitRandomTime(500, 1000);
              
              // Click on the "Completed" link
              await completedLink.click();
              logMessage('Clicked on "Completed" menu item');
              await waitRandomTime(2000, 3000);
              
              // Wait for navigation
              try {
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {
                  // Navigation might complete before timeout
                });
              } catch (navError) {
                // Navigation timeout is okay
              }
              
              logMessage('Navigation to "Completed" section completed');
              
              // Wait for the list to load, then set rows per page to 100
              await waitRandomTime(2000, 3000);
              logMessage('Looking for "Rows per page" dropdown...');
              
              try {
                // Find the dropdown by ID
                const rowsPerPageDropdown = await page.$('#rowsPerPage');
                
                if (rowsPerPageDropdown) {
                  logMessage('Found "Rows per page" dropdown, opening it...');
                  
                  // Click to open the dropdown
                  await rowsPerPageDropdown.click();
                  await waitRandomTime(500, 1000);
                  
                  // Wait for the dropdown menu to appear
                  await page.waitForSelector('#rowsPerPage .menu', { timeout: 5000 });
                  logMessage('Dropdown menu opened');
                  
                  // Find and click the option "100"
                  const option100 = await page.$('#rowsPerPage .menu .item:has-text("100"), #rowsPerPage .menu .item span:has-text("100")');
                  
                  if (!option100) {
                    // Alternative: search by text content
                    const menuItems = await page.$$('#rowsPerPage .menu .item');
                    for (const item of menuItems) {
                      const text = await page.evaluate(el => el.textContent?.trim() || '', item);
                      if (text === '100') {
                        await item.click();
                        logMessage('Selected "100" rows per page');
                        await waitRandomTime(1000, 2000);
                        break;
                      }
                    }
                  } else {
                    await option100.click();
                    logMessage('Selected "100" rows per page');
                    await waitRandomTime(1000, 2000);
                  }
                  
                  // Wait for the list to load completely after pagination change
                  logMessage('Waiting for order list to load after pagination change...');
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
                } else {
                  logMessage('Warning: "Rows per page" dropdown not found', 'WARNING');
                }
              } catch (error: any) {
                logMessage(`Error setting rows per page: ${error.message}`, 'WARNING');
                // Continue anyway
              }
              
                // Wait for list to be ready before filtering
                logMessage('Waiting for order list to be ready before filtering...');
                try {
                  await page.waitForSelector('tbody tr[data-test="orderRow"]', { timeout: 5000 });
                  await waitRandomTime(1000, 2000);
                } catch (waitError) {
                  logMessage('Warning: Could not verify list is ready, proceeding anyway', 'WARNING');
                }
                
                // Filter by date if configured
                if (config.task.filterDate && config.task.filterDate.trim() !== '') {
                  logMessage(`Filtering orders by date: ${config.task.filterDate}`);
                  await filterOrdersByDate(page, config.task.filterDate);
                }
                
                // Get order codes from config (file or list)
                const orderCodesToFilter = getOrderCodesFromConfig(config);
                if (orderCodesToFilter.length > 0) {
                  logMessage(`Filtering orders by codes from file/list: ${orderCodesToFilter.length} codes`);
                  await filterOrdersByCodes(page, orderCodesToFilter);
                
                // Click on matching order links
                logMessage('Clicking on matching order links...');
                await clickMatchingOrderLinks(page, orderCodesToFilter, config, account.username);
              } else {
                logMessage('No order codes to process for this account');
              }
            } else {
              logMessage('Warning: "Completed" menu item not found, continuing anyway', 'WARNING');
            }
          } catch (error: any) {
            logMessage(`Error navigating to "Completed" section: ${error.message}`, 'WARNING');
            // Don't fail the login if this step fails
          }
          
          // Perform logout after processing each account (but keep browser open)
          logMessage(`All orders processed for account: ${account.username}, performing logout...`);
          try {
            await performLogout(page, config, browser);
          } catch (logoutError: any) {
            logMessage(`Error during logout for account ${account.username}: ${logoutError.message}`, 'WARNING');
            // Try to navigate to sign_in page directly
            try {
              if (isPageValid(page)) {
                await page.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
              } else {
                const pages = await browser.pages();
                if (pages.length > 0) {
                  await pages[0].goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
                }
              }
            } catch (navError) {
              // Ignore navigation errors
            }
          }
          
        } catch (accountError: any) {
          const errorMsg = accountError.message || String(accountError);
          logMessage(`Error processing account ${account.username}: ${errorMsg}`, 'WARNING');
          
          // If page is detached, try to recover
          if (errorMsg.includes('detached')) {
            logMessage('Page was detached, attempting to recover...', 'WARNING');
            try {
              const pages = await browser.pages();
              if (pages.length > 0) {
                // Use the first available page
                const validPage = pages[0];
                await validPage.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
                logMessage('Recovered page and navigated to sign_in');
              } else {
                // Create a new page if none exist
                const newPage = await browser.newPage();
                await newPage.goto('https://www.ezcater.com/caterer_portal/sign_in', { waitUntil: 'networkidle2' });
                logMessage('Created new page and navigated to sign_in');
              }
            } catch (recoveryError: any) {
              logMessage(`Could not recover page: ${recoveryError.message}`, 'WARNING');
            }
          }
          
          // Try to perform logout even after error
          try {
            if (isPageValid(page)) {
              await performLogout(page, config, browser);
            } else {
              const pages = await browser.pages();
              if (pages.length > 0) {
                await performLogout(pages[0], config, browser);
              }
            }
          } catch (logoutError) {
            // Ignore logout errors if we already had an error
          }
          
          // Keep browser open and try next account
          await waitRandomTime(1000, 2000);
          continue; // Try next account
        }
      }
      
      // Display statistics after processing all accounts
      const allResults = (global as any).orderResults || [];
      if (allResults.length > 0) {
        displayStatistics(allResults);
      } else {
        logMessage('No orders were processed');
      }
      
      // Unmark browser as protected now that process is complete
      if (profile) {
        profile.protected = false;
        logMessage('Browser protection removed (age check timer can now close it if needed)');
      }
      
    } else {
      // Original logic for non-account-based processing
      browserResult = await initBrowser(config.task.url, 'default');

      if (!browserResult.page || !browserResult.browser) {
        result.error = browserResult.error || 'Failed to initialize browser';
        logMessage(result.error, 'ERROR');
        return result;
      }

      const page = browserResult.page;
      const browser = browserResult.browser;

      logMessage('Waiting for page to load...');
      await waitRandomTime(2000, 3000);

      // Wait for list items if listSelector is configured
      if (config.task.listSelector) {
        try {
          await page.waitForSelector(config.task.listSelector, { timeout: 10000 });
          logMessage(`Found list items using selector: ${config.task.listSelector}`);

          const items = await page.$$(config.task.listSelector);
          const maxItems = config.task.maxItemsPerCycle || 10;
          const itemsToProcess = items.slice(0, maxItems);

          result.processed = items.length;
          logMessage(`Found ${items.length} items, processing ${itemsToProcess.length}`);

          // Process items and click on configured selectors
          if (config.task.clickSelectors && config.task.clickSelectors.length > 0) {
            for (let i = 0; i < itemsToProcess.length; i++) {
              const item = itemsToProcess[i];
              
              for (const selector of config.task.clickSelectors) {
                try {
                  const clickableElement = await item.$(selector);
                  if (clickableElement) {
                    await clickableElement.click();
                    logMessage(`Clicked element with selector: ${selector} in item ${i + 1}`);
                    result.clicked++;
                    await waitRandomTime(1000, 2000);
                  }
                } catch (clickError) {
                  logMessage(`Error clicking element with selector ${selector} in item ${i + 1}: ${clickError}`, 'WARNING');
                }
              }
            }
          }
        } catch (error: any) {
          logMessage(`Error processing list: ${error.message}`, 'WARNING');
        }
      } else {
        logMessage('No listSelector configured, page loaded successfully');
        result.processed = 1;
      }
    }

  } catch (error: any) {
    result.error = (error as Error).message;
    logMessage('Error during establishment automation: ' + error, 'ERROR');
  } finally {
    if (browserResult?.browser) {
      try {
        // Close browser at the very end of the process
        logMessage('Closing browser at the end of the process');
        const profile = browserPool.findProfileByBrowser(browserResult.browser);
        await browserResult.browser.close();
        if (profile) {
          browserPool.returnBrowserProfile(profile, true);
          logMessage('Browser profile returned to pool and browser closed');
        }
      } catch (error: any) {
        logMessage('Error managing browser: ' + error, 'ERROR');
      }
    }
  }

  return result;
}

/**
 * Start periodic task
 */
function startPeriodicTask(config: BotConfig): void {
  if (taskInterval) {
    logMessage('Task interval already running', 'WARNING');
    return;
  }

  const intervalMs = config.task.checkInterval * 1000;
  logMessage(`Starting periodic task. Interval: ${config.task.checkInterval} seconds`);

  // Run immediately on start
  checkListAndClick(config).then(async result => {
    if (result.error) {
      logMessage(`Task error: ${result.error}`, 'ERROR');
      await sendMessageToTelegram(`Task error: ${result.error}`);
    } else {
      logMessage(`Task completed: Processed ${result.processed} items, Clicked ${result.clicked} elements`);
    }
  });

  // Then run periodically
  taskInterval = setInterval(async () => {
    logMessage('Running periodic task...');
    const result = await checkListAndClick(config);

    if (result.error) {
      logMessage(`Task error: ${result.error}`, 'ERROR');
      await sendMessageToTelegram(`Task error: ${result.error}`);
    } else {
      logMessage(`Task completed: Processed ${result.processed} items, Clicked ${result.clicked} elements`);
    }
  }, intervalMs);
}

/**
 * Stop periodic task
 */
function stopPeriodicTask(): void {
  if (taskInterval) {
    clearInterval(taskInterval);
    taskInterval = null;
    logMessage('Periodic task stopped');
  }
}

/**
 * Start a timer to periodically check for browsers that have been used too long
 */
function startBrowserAgeCheckTimer(config: BotConfig): void {
  const interval = config.browser.checkBrowserInterval || 10;
  const maxAge = config.browser.browserAge || 15;

  logMessage(`Starting browser age check timer: interval=${interval}s, maxAge=${maxAge}s`);

  setInterval(async () => {
    if (browserPool) {
      logMessage("Running scheduled browser age check...");
      const result = await browserPool.forceCloseBrowsersOlderThan(maxAge);
      logMessage(`Age check completed. Processed: ${result.processed}, Closed: ${result.closed}`);
    }
  }, interval * 1000);
}

/**
 * Main function - Entry point for the application
 */
async function main(): Promise<void> {
  try {
    logMessage("Starting EZCater Web Establishment Bot...");

    const config = loadConfig();
    
    // Initialize log file system
    initializeLogFile(config);
    
    logMessage("Configuration loaded successfully");

    browserPool = new BrowserPool(config);
    logMessage(`Browser pool initialized with size: ${config.browser.poolSize || 3}`);

    startBrowserAgeCheckTimer(config);

    mkdirSync(config.paths.dataPath, { recursive: true });

    telegramBot = initTelegramBot();

    if (telegramBot) {
      logMessage("Telegram bot initialized successfully");
      await sendMessageToTelegram("EZCater Web Establishment Bot initiated");
    } else {
      logMessage("Telegram bot not initialized, continuing without notifications");
    }

    await loadTokens();

    const app = express();
    const PORT = config.server.port;

    app.use(bodyParser.json());

    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json(
          createApiResponse(
            false,
            'Request format error',
            'Invalid JSON'
          )
        );
      }
      next(err);
    });

    const apiRouter = express.Router();
    app.use(config.server.basePath, apiRouter);

    // Route to start periodic task
    apiRouter.post('/task/start', authenticateToken, async (req: Request, res: Response) => {
      try {
        if (taskInterval) {
          return res.status(400).json(
            createApiResponse(
              false,
              'Task already running',
              'Periodic task is already active'
            )
          );
        }

        startPeriodicTask(config);

        return res.status(200).json(
          createApiResponse(
            true,
            'Periodic task started successfully',
            null,
            { interval: config.task.checkInterval }
          )
        );
      } catch (error: any) {
        logMessage('Error in /task/start endpoint: ' + error, 'ERROR');
        return res.status(500).json(
          createApiResponse(
            false,
            'Failed to start task',
            (error as Error).message
          )
        );
      }
    });

    // Route to stop periodic task
    apiRouter.post('/task/stop', authenticateToken, async (req: Request, res: Response) => {
      try {
        stopPeriodicTask();

        return res.status(200).json(
          createApiResponse(
            true,
            'Periodic task stopped successfully'
          )
        );
      } catch (error: any) {
        logMessage('Error in /task/stop endpoint: ' + error, 'ERROR');
        return res.status(500).json(
          createApiResponse(
            false,
            'Failed to stop task',
            (error as Error).message
          )
        );
      }
    });

    // Route to run task once manually
    apiRouter.post('/task/run', authenticateToken, async (req: Request, res: Response) => {
      try {
        logMessage('Manual task execution requested');
        const result = await checkListAndClick(config);

        if (result.error) {
          return res.status(500).json(
            createApiResponse(
              false,
              'Task execution failed',
              result.error,
              { processed: result.processed, clicked: result.clicked }
            )
          );
        }

        return res.status(200).json(
          createApiResponse(
            true,
            'Task executed successfully',
            null,
            { processed: result.processed, clicked: result.clicked }
          )
        );
      } catch (error: any) {
        logMessage('Error in /task/run endpoint: ' + error, 'ERROR');
        return res.status(500).json(
          createApiResponse(
            false,
            'Failed to execute task',
            (error as Error).message
          )
        );
      }
    });

    // Global error handler
    apiRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      logMessage('Unhandled error: ' + err, 'ERROR');
      res.status(500).json(createApiResponse(
        false,
        'Internal server error',
        err.message
      ));
    });

    // Start server
    const server = app.listen(PORT, () => {
      logMessage(`Server running on port ${PORT}`);
      logMessage(`API base path: ${config.server.basePath}`);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logMessage(`Port ${PORT} is already in use`, 'ERROR');
      } else {
        logMessage('Server error: ' + error, 'ERROR');
      }
    });

    // Handle process termination
    process.on('SIGINT', async () => {
      logMessage('Shutting down...');
      stopPeriodicTask();
      process.exit(0);
    });

  } catch (error: any) {
    logMessage("An error occurred: " + error, 'ERROR');
    process.exit(1);
  }
}

// Execute the main function
main().catch(error => {
  logMessage("Unhandled error in main: " + error, 'ERROR');
  process.exit(1);
});
