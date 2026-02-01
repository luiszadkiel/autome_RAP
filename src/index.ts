#!/usr/bin/env node

/**
 * Web Automation Agent - CLI
 * 
 * Usage:
 *   npx tsx src/index.ts agent --url <url> --message <message> [--email <email>] [--password <pass>]
 *   npx tsx src/index.ts replay <flowId>
 *   npx tsx src/index.ts list
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config as dotenvConfig } from 'dotenv';
import { WebAgent } from './agent/web-agent.js';
import { FlowPlayer } from './recorder/flow-player.js';
import { FlowRecorder } from './recorder/flow-recorder.js';
import { BrowserClient } from './browser/browser-client.js';
import { loadConfig } from './core/config.js';

// Load environment
dotenvConfig();

const program = new Command();

program
    .name('web-agent')
    .description('AI-powered web automation agent')
    .version('1.0.0');

// ============================================
// Agent Command
// ============================================

program
    .command('agent')
    .description('Run the AI agent to perform a task on a website')
    .requiredOption('-u, --url <url>', 'URL to navigate to')
    .requiredOption('-m, --message <message>', 'What you want the agent to do (natural language)')
    .option('-e, --email <email>', 'Email for login')
    .option('--username <username>', 'Username for login')
    .option('-p, --password <password>', 'Password for login')
    .option('--no-headless', 'Show browser window')
    .option('--record <name>', 'Record the flow with this name')
    .option('--max-steps <number>', 'Maximum steps (default: 20)', '20')
    .option('--screenshot', 'Take screenshot on each step')
    .action(async (options) => {
        console.log(chalk.blue.bold('\n🤖 Web Automation Agent\n'));
        console.log(chalk.gray(`URL: ${options.url}`));
        console.log(chalk.gray(`Task: ${options.message}\n`));

        // Check API key
        if (!process.env.OPENAI_API_KEY) {
            console.error(chalk.red('❌ OPENAI_API_KEY not set!'));
            console.error(chalk.yellow('Set it in .env file or environment:'));
            console.error(chalk.gray('  export OPENAI_API_KEY=sk-...'));
            process.exit(1);
        }

        try {
            const agent = new WebAgent({
                openaiApiKey: process.env.OPENAI_API_KEY,
                openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
                headless: options.headless,
                recordFlow: !!options.record,
                maxSteps: parseInt(options.maxSteps),
                screenshotOnEachStep: options.screenshot,
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

            console.log('\n' + chalk.gray('─'.repeat(50)));

            if (result.success) {
                console.log(chalk.green.bold('\n✅ Task Completed Successfully!\n'));
            } else {
                console.log(chalk.red.bold('\n❌ Task Failed\n'));
            }

            console.log(chalk.white('Summary:'), result.summary);
            console.log(chalk.gray(`Duration: ${Math.round((result.duration || 0) / 1000)}s`));
            console.log(chalk.gray(`Steps: ${result.steps.length}`));

            if (result.data) {
                console.log(chalk.white('\nExtracted Data:'));
                console.log(chalk.cyan(JSON.stringify(result.data, null, 2)));
            }

            if (result.downloadedFiles && result.downloadedFiles.length > 0) {
                console.log(chalk.white('\nDownloaded Files:'));
                for (const file of result.downloadedFiles) {
                    console.log(chalk.green(`  📁 ${file}`));
                }
            }

            if (result.flowId) {
                console.log(chalk.white('\nFlow Recorded:'));
                console.log(chalk.blue(`  📼 ${result.flowId}`));
                console.log(chalk.gray(`  Replay with: npx tsx src/index.ts replay ${result.flowId}`));
            }

            if (result.error) {
                console.log(chalk.red(`\nError: ${result.error}`));
            }

            console.log('');
            process.exit(result.success ? 0 : 1);

        } catch (error) {
            console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// Replay Command
// ============================================

program
    .command('replay <flowId>')
    .description('Replay a recorded flow')
    .option('--no-headless', 'Show browser window')
    .option('--slow-mo <ms>', 'Delay between steps in ms', '500')
    .option('--stop-on-error', 'Stop on first error', true)
    .action(async (flowId, options) => {
        console.log(chalk.blue.bold('\n▶️ Replaying Flow\n'));
        console.log(chalk.gray(`Flow ID: ${flowId}\n`));

        try {
            const config = loadConfig();
            const player = new FlowPlayer(config.paths.flowsDir);
            const flow = player.loadFlow(flowId);

            if (!flow) {
                console.error(chalk.red(`❌ Flow not found: ${flowId}`));
                console.error(chalk.gray('Use "npx tsx src/index.ts list" to see available flows'));
                process.exit(1);
            }

            console.log(chalk.gray(`Name: ${flow.name}`));
            console.log(chalk.gray(`URL: ${flow.startUrl}`));
            console.log(chalk.gray(`Steps: ${flow.steps.length}`));
            console.log(chalk.gray(`Instruction: ${flow.instruction}\n`));

            const browser = new BrowserClient(
                { ...config.browser, headless: options.headless },
                config.paths.downloadsDir
            );
            await browser.launch();

            const result = await player.playFlow(browser, flow, {
                headless: options.headless,
                slowMo: parseInt(options.slowMo),
                stopOnError: options.stopOnError,
            });

            await browser.close();

            console.log('\n' + chalk.gray('─'.repeat(50)));

            if (result.success) {
                console.log(chalk.green.bold('\n✅ Replay Completed Successfully!\n'));
            } else {
                console.log(chalk.red.bold('\n❌ Replay Failed\n'));
            }

            console.log(chalk.gray(`Steps executed: ${result.stepsExecuted}/${result.stepsTotal}`));

            if (result.error) {
                console.log(chalk.red(`Error: ${result.error}`));
            }

            console.log('');
            process.exit(result.success ? 0 : 1);

        } catch (error) {
            console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// List Command
// ============================================

program
    .command('list')
    .description('List all recorded flows')
    .action(async () => {
        console.log(chalk.blue.bold('\n📋 Recorded Flows\n'));

        try {
            const config = loadConfig();
            const recorder = new FlowRecorder(config.paths.flowsDir);
            const flows = recorder.listFlows();

            if (flows.length === 0) {
                console.log(chalk.gray('No flows recorded yet.'));
                console.log(chalk.gray('Record one with: npx tsx src/index.ts agent --url <url> --message <msg> --record <name>'));
            } else {
                for (const flow of flows) {
                    const status = flow.success ? chalk.green('✓') : chalk.red('✗');
                    console.log(`${status} ${chalk.white.bold(flow.name)} ${chalk.gray(`(${flow.id})`)}`);
                    console.log(`  ${chalk.gray('URL:')} ${flow.startUrl}`);
                    console.log(`  ${chalk.gray('Task:')} ${flow.instruction.slice(0, 60)}${flow.instruction.length > 60 ? '...' : ''}`);
                    console.log(`  ${chalk.gray('Steps:')} ${flow.stepCount}`);
                    console.log(`  ${chalk.gray('Date:')} ${new Date(flow.createdAt).toLocaleString()}`);
                    console.log('');
                }
            }

        } catch (error) {
            console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// ============================================
// Delete Command
// ============================================

program
    .command('delete <flowId>')
    .description('Delete a recorded flow')
    .action(async (flowId) => {
        try {
            const config = loadConfig();
            const recorder = new FlowRecorder(config.paths.flowsDir);
            const deleted = recorder.deleteFlow(flowId);

            if (deleted) {
                console.log(chalk.green(`✓ Deleted flow: ${flowId}`));
            } else {
                console.log(chalk.red(`✗ Flow not found: ${flowId}`));
            }

        } catch (error) {
            console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
    });

// Parse and run
program.parse();
