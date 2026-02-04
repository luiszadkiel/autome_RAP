#!/usr/bin/env node

/**
 * Web Automation System - Main Entry Point
 * 
 * Clean Architecture + DDD Implementation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config as dotenvConfig } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Load environment
dotenvConfig();

// Import modules
import { WebAgent } from './agent/web-agent.js';
import { FlowRecorder } from './recorder/flow-recorder.js';
import { FlowPlayer } from './recorder/flow-player.js';
import { SqliteWebFlowRepository } from './infrastructure/persistence/sqlite/SqliteWebFlowRepository.js';
import { SqliteSnapshotRepository } from './infrastructure/persistence/sqlite/SqliteSnapshotRepository.js';
import { PlaywrightBrowserAdapter } from './infrastructure/browser/PlaywrightBrowserAdapter.js';
import { ExecuteFlowUseCase } from './application/use-cases/flow-management/ExecuteFlowUseCase.js';
import { ReplayFlowUseCase } from './application/use-cases/flow-management/ReplayFlowUseCase.js';
import { createApiServer } from './interfaces/http/server.js';

// Configuration
const DATA_DIR = resolve(process.env.DATA_DIR || './data');
const DB_PATH = join(DATA_DIR, 'automation.db');
const SCREENSHOTS_DIR = join(DATA_DIR, 'screenshots');
const FLOWS_DIR = join(DATA_DIR, 'flows');

// Ensure directories exist
[DATA_DIR, SCREENSHOTS_DIR, FLOWS_DIR].forEach(dir => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

const program = new Command();

program
    .name('web-automation')
    .description('AI-powered web automation system with flow recording and replay')
    .version('2.0.0');

// ============================================
// Agent Command (AI-powered)
// ============================================

program
    .command('agent')
    .description('Run the AI agent to perform a task on a website')
    .requiredOption('-u, --url <url>', 'URL to navigate to')
    .requiredOption('-m, --message <message>', 'What you want the agent to do')
    .option('-e, --email <email>', 'Email for login')
    .option('--username <username>', 'Username for login')
    .option('-p, --password <password>', 'Password for login')
    .option('--no-headless', 'Show browser window')
    .option('--record <name>', 'Record the flow with this name')
    .option('--max-steps <number>', 'Maximum steps', '20')
    .action(async (options) => {
        console.log(chalk.blue.bold('\n🤖 Web Automation Agent\n'));

        if (!process.env.OPENAI_API_KEY) {
            console.error(chalk.red('❌ OPENAI_API_KEY not set!'));
            process.exit(1);
        }

        try {
            const agent = new WebAgent({
                openaiApiKey: process.env.OPENAI_API_KEY,
                headless: options.headless,
                recordFlow: !!options.record,
                maxSteps: parseInt(options.maxSteps),
            });

            const result = await agent.run({
                url: options.url,
                instruction: options.message,
                credentials: (options.email || options.username || options.password) ? {
                    email: options.email,
                    username: options.username,
                    password: options.password,
                } : undefined,
                flowName: options.record,
            });

            if (result.success) {
                console.log(chalk.green.bold('\n✅ Task Completed!\n'));
            } else {
                console.log(chalk.red.bold('\n❌ Task Failed\n'));
            }
            console.log(chalk.white('Summary:'), result.summary);
            process.exit(result.success ? 0 : 1);
        } catch (error) {
            console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// Execute Command (stored flows)
// ============================================

program
    .command('execute')
    .description('Execute a stored flow from the database')
    .option('--id <flowId>', 'Flow ID to execute')
    .option('--name <flowName>', 'Flow name to execute')
    .option('--var <key=value...>', 'Variables (e.g., --var username=john --var password=secret)')
    .option('--no-headless', 'Show browser window')
    .action(async (options) => {
        console.log(chalk.blue.bold('\n▶️ Executing Flow\n'));

        if (!options.id && !options.name) {
            console.error(chalk.red('❌ Provide --id or --name'));
            process.exit(1);
        }

        try {
            const flowRepo = new SqliteWebFlowRepository(DB_PATH);
            const snapshotRepo = new SqliteSnapshotRepository(DB_PATH);
            const executeUseCase = new ExecuteFlowUseCase(flowRepo, snapshotRepo);

            const browser = new PlaywrightBrowserAdapter({
                headless: options.headless,
                timeout: 30000,
            });

            await browser.launch();

            // Parse variables
            const variables: Record<string, string> = {};
            if (options.var) {
                for (const v of options.var) {
                    const [key, value] = v.split('=');
                    if (key && value) variables[key] = value;
                }
            }

            const result = await executeUseCase.execute({
                flowId: options.id,
                flowName: options.name,
                variables,
                screenshotsDir: SCREENSHOTS_DIR,
            }, browser);

            await browser.close();
            flowRepo.close();
            snapshotRepo.close();

            if (result.success) {
                console.log(chalk.green.bold('\n✅ Flow Executed Successfully!\n'));
            } else {
                console.log(chalk.red.bold('\n❌ Flow Failed\n'));
                console.log(chalk.red(`Error: ${result.error}`));
            }

            console.log(chalk.gray(`Steps: ${result.stepsExecuted}/${result.stepsTotal}`));
            console.log(chalk.gray(`Duration: ${Math.round(result.duration / 1000)}s`));
            process.exit(result.success ? 0 : 1);
        } catch (error) {
            console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// Replay Command (with snapshot validation)
// ============================================

program
    .command('replay')
    .description('Replay a flow with snapshot validation')
    .option('--id <flowId>', 'Flow ID to replay')
    .option('--name <flowName>', 'Flow name to replay')
    .option('--var <key=value...>', 'Variables')
    .option('--slow-mo <ms>', 'Delay between steps', '500')
    .option('--no-validate', 'Skip snapshot validation')
    .option('--no-headless', 'Show browser window')
    .action(async (options) => {
        console.log(chalk.blue.bold('\n🔄 Replaying Flow\n'));

        if (!options.id && !options.name) {
            console.error(chalk.red('❌ Provide --id or --name'));
            process.exit(1);
        }

        try {
            const flowRepo = new SqliteWebFlowRepository(DB_PATH);
            const snapshotRepo = new SqliteSnapshotRepository(DB_PATH);
            const replayUseCase = new ReplayFlowUseCase(flowRepo, snapshotRepo);

            const browser = new PlaywrightBrowserAdapter({
                headless: options.headless,
                timeout: 30000,
            });

            await browser.launch();

            const variables: Record<string, string> = {};
            if (options.var) {
                for (const v of options.var) {
                    const [key, value] = v.split('=');
                    if (key && value) variables[key] = value;
                }
            }

            const result = await replayUseCase.replay({
                flowId: options.id,
                flowName: options.name,
                variables,
                slowMo: parseInt(options.slowMo),
                validateSnapshots: options.validate,
                screenshotsDir: SCREENSHOTS_DIR,
            }, browser);

            await browser.close();
            flowRepo.close();
            snapshotRepo.close();

            if (result.success) {
                console.log(chalk.green.bold('\n✅ Replay Completed!\n'));
            } else {
                console.log(chalk.red.bold('\n❌ Replay Failed\n'));
            }

            if (result.mismatches.length > 0) {
                console.log(chalk.yellow(`\n⚠️ ${result.mismatches.length} snapshot mismatches detected`));
                for (const m of result.mismatches) {
                    console.log(chalk.gray(`  Step ${m.stepIndex}: ${m.suggestion}`));
                }
            }

            process.exit(result.success ? 0 : 1);
        } catch (error) {
            console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// List Command
// ============================================

program
    .command('list')
    .description('List all stored flows')
    .action(async () => {
        console.log(chalk.blue.bold('\n📋 Stored Flows\n'));

        try {
            const flowRepo = new SqliteWebFlowRepository(DB_PATH);
            const flows = await flowRepo.findAll();
            flowRepo.close();

            if (flows.length === 0) {
                console.log(chalk.gray('No flows stored yet.'));
                console.log(chalk.gray('Record one with: npx tsx src/main.ts agent --url <url> --message <msg> --record <name>'));
                return;
            }

            for (const flow of flows) {
                const rate = Math.round(flow.getSuccessRate() * 100);
                const statusColor = flow.status === 'ready' ? chalk.green : chalk.yellow;

                console.log(`${statusColor('●')} ${chalk.white.bold(flow.name)} ${chalk.gray(`(${flow.id})`)}`);
                console.log(`  ${chalk.gray('URL:')} ${flow.startUrl}`);
                console.log(`  ${chalk.gray('Steps:')} ${flow.stepCount}`);
                console.log(`  ${chalk.gray('Executions:')} ${flow.executionCount} (${rate}% success)`);
                console.log(`  ${chalk.gray('Variables:')} ${flow.variables.join(', ') || 'none'}`);
                console.log('');
            }
        } catch (error) {
            console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// Server Command (REST API)
// ============================================

program
    .command('server')
    .description('Start the REST API server')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .action(async (options) => {
        console.log(chalk.blue.bold('\n🚀 Starting API Server\n'));

        try {
            const server = createApiServer({
                dbPath: DB_PATH,
                screenshotsDir: SCREENSHOTS_DIR,
                port: parseInt(options.port),
            });

            server.start(parseInt(options.port));

            console.log(chalk.green(`\n✅ Server running on http://localhost:${options.port}`));
            console.log(chalk.gray('\nEndpoints:'));
            console.log(chalk.gray('  GET  /api/flows          - List all flows'));
            console.log(chalk.gray('  GET  /api/flows/:id      - Get flow by ID'));
            console.log(chalk.gray('  POST /api/flows/execute  - Execute a flow'));
            console.log(chalk.gray('  POST /api/flows/replay   - Replay with validation'));
            console.log(chalk.gray('  DELETE /api/flows/:id    - Delete a flow'));
            console.log(chalk.gray('  POST /api/agent          - Execute AI agent'));
            console.log(chalk.gray('  POST /api/agent/parallel - Execute on multiple sites (1-10)'));
            console.log(chalk.gray('\nPress Ctrl+C to stop'));
        } catch (error) {
            console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// Delete Command
// ============================================

program
    .command('delete <flowId>')
    .description('Delete a stored flow')
    .action(async (flowId) => {
        try {
            const flowRepo = new SqliteWebFlowRepository(DB_PATH);
            const snapshotRepo = new SqliteSnapshotRepository(DB_PATH);

            const deleted = await flowRepo.delete(flowId);
            if (deleted) {
                await snapshotRepo.deleteByFlowId(flowId);
                console.log(chalk.green(`✓ Deleted flow: ${flowId}`));
            } else {
                console.log(chalk.red(`✗ Flow not found: ${flowId}`));
            }

            flowRepo.close();
            snapshotRepo.close();
        } catch (error) {
            console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// Parse and run
program.parse();
