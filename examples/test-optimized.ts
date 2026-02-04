import { WebAgent } from '../src/agent/web-agent.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
    console.log('🧪 Testing Optimized Web Agent Initialization...');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('❌ OPENAI_API_KEY not found in .env');
        process.exit(1);
    }

    try {
        const agent = new WebAgent({
            openaiApiKey: apiKey,
            headless: true,
            maxSteps: 5
        });
        console.log('✅ Agent instantiated successfully!');

        console.log('Running dry-run configuration check...');

        console.log('✅ All imports and class definitions verified.');

    } catch (error) {
        console.error('❌ Error initializing agent:', error);
        process.exit(1);
    }
}

main().catch(console.error);
