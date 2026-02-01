/**
 * Configuration loader
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Config } from './types.js';

// Load .env file
dotenvConfig();

/**
 * Get environment variable with optional default
 */
function getEnv(key: string, defaultValue?: string): string {
    const value = process.env[key];
    if (value === undefined) {
        if (defaultValue === undefined) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
        return defaultValue;
    }
    return value;
}

/**
 * Get boolean environment variable
 */
function getEnvBool(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Get numeric environment variable
 */
function getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
}

/**
 * Ensure directory exists
 */
function ensureDir(dir: string): void {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

/**
 * Load configuration from environment
 */
export function loadConfig(): Config {
    const dataDir = getEnv('DATA_DIR', './data');

    const config: Config = {
        openai: {
            apiKey: getEnv('OPENAI_API_KEY', ''),
            model: getEnv('OPENAI_MODEL', 'gpt-4o'),
        },
        browser: {
            headless: getEnvBool('HEADLESS', true),
            timeout: getEnvNumber('BROWSER_TIMEOUT', 60000),
            viewport: {
                width: 1280,
                height: 720,
            },
        },
        paths: {
            dataDir: resolve(dataDir),
            downloadsDir: resolve(getEnv('DOWNLOADS_DIR', join(dataDir, 'downloads'))),
            screenshotsDir: resolve(getEnv('SCREENSHOTS_DIR', join(dataDir, 'screenshots'))),
            flowsDir: resolve(getEnv('FLOWS_DIR', join(dataDir, 'flows'))),
            snapshotsDir: resolve(join(dataDir, 'snapshots')),
        },
        agent: {
            maxSteps: getEnvNumber('MAX_AGENT_STEPS', 20),
            screenshotOnEachStep: getEnvBool('SCREENSHOT_ON_EACH_STEP', false),
            autoRecordFlows: getEnvBool('AUTO_RECORD_FLOWS', true),
        },
    };

    // Ensure directories exist
    ensureDir(config.paths.dataDir);
    ensureDir(config.paths.downloadsDir);
    ensureDir(config.paths.screenshotsDir);
    ensureDir(config.paths.flowsDir);
    ensureDir(config.paths.snapshotsDir);

    return config;
}

/**
 * Validate that required config is present
 */
export function validateConfig(config: Config): void {
    if (!config.openai.apiKey) {
        throw new Error(
            'OPENAI_API_KEY is required. Set it in your .env file or environment.\n' +
            'Get your API key from: https://platform.openai.com/api-keys'
        );
    }
}

/**
 * Get config with validation
 */
export function getConfig(): Config {
    const config = loadConfig();
    validateConfig(config);
    return config;
}
