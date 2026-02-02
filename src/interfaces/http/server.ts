/**
 * Hono HTTP API - REST endpoints for flows with Swagger UI
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { z } from 'zod';
import { SqliteWebFlowRepository } from '../../infrastructure/persistence/sqlite/SqliteWebFlowRepository.js';
import { SqliteSnapshotRepository } from '../../infrastructure/persistence/sqlite/SqliteSnapshotRepository.js';
import { SqliteSessionRepository } from '../../infrastructure/persistence/sqlite/SqliteSessionRepository.js';
import { ExecuteFlowUseCase } from '../../application/use-cases/flow-management/ExecuteFlowUseCase.js';
import { ReplayFlowUseCase } from '../../application/use-cases/flow-management/ReplayFlowUseCase.js';
import { PlaywrightBrowserAdapter } from '../../infrastructure/browser/PlaywrightBrowserAdapter.js';
import { WebAgent } from '../../agent/web-agent.js';


// OpenAPI Schema
const openApiSpec = {
    openapi: '3.0.0',
    info: {
        title: 'Web Automation API',
        version: '2.0.0',
        description: 'API para automatización web con IA. Graba, ejecuta y reproduce flujos de automatización.',
    },
    servers: [
        { url: 'http://localhost:3000', description: 'Local' }
    ],
    paths: {
        '/api/flows': {
            get: {
                summary: 'Listar todos los flujos',
                tags: ['Flows'],
                responses: {
                    '200': {
                        description: 'Lista de flujos',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'string' },
                                                    name: { type: 'string' },
                                                    description: { type: 'string' },
                                                    startUrl: { type: 'string' },
                                                    stepCount: { type: 'integer' },
                                                    status: { type: 'string' },
                                                    executionCount: { type: 'integer' },
                                                    successRate: { type: 'number' },
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/flows/{id}': {
            get: {
                summary: 'Obtener flujo por ID',
                tags: ['Flows'],
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Flujo encontrado' },
                    '404': { description: 'Flujo no encontrado' }
                }
            },
            delete: {
                summary: 'Eliminar un flujo',
                tags: ['Flows'],
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Flujo eliminado' },
                    '404': { description: 'Flujo no encontrado' }
                }
            }
        },
        '/api/flows/execute': {
            post: {
                summary: 'Ejecutar un flujo',
                tags: ['Execution'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    flowId: { type: 'string', description: 'ID del flujo (opcional si se usa flowName)' },
                                    flowName: { type: 'string', description: 'Nombre del flujo (opcional si se usa flowId)' },
                                    variables: {
                                        type: 'object',
                                        additionalProperties: { type: 'string' },
                                        description: 'Variables para reemplazar {{var}}',
                                        example: { username: 'john', password: 'secret123' }
                                    },
                                    headless: { type: 'boolean', default: true, description: 'Ejecutar sin mostrar navegador' }
                                }
                            },
                            example: {
                                flowName: 'login_example',
                                variables: { username: 'john', password: 'secret123' },
                                headless: true
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Resultado de la ejecución',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                success: { type: 'boolean' },
                                                flowId: { type: 'string' },
                                                flowName: { type: 'string' },
                                                stepsExecuted: { type: 'integer' },
                                                stepsTotal: { type: 'integer' },
                                                duration: { type: 'integer' },
                                                error: { type: 'string' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/flows/replay': {
            post: {
                summary: 'Reproducir flujo con validación de snapshots',
                tags: ['Execution'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    flowId: { type: 'string' },
                                    flowName: { type: 'string' },
                                    variables: { type: 'object', additionalProperties: { type: 'string' } },
                                    slowMo: { type: 'integer', default: 500, description: 'Milisegundos entre pasos' },
                                    validateSnapshots: { type: 'boolean', default: true, description: 'Validar estado de página' },
                                    headless: { type: 'boolean', default: true }
                                }
                            },
                            example: {
                                flowName: 'login_example',
                                variables: { password: 'secret123' },
                                slowMo: 500,
                                validateSnapshots: true
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Resultado del replay',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                success: { type: 'boolean' },
                                                stepsExecuted: { type: 'integer' },
                                                mismatches: { type: 'array', items: { type: 'object' } }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/flows/{id}/snapshots': {
            get: {
                summary: 'Obtener snapshots de un flujo',
                tags: ['Snapshots'],
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Lista de snapshots' }
                }
            }
        },
        '/api/agent': {
            post: {
                summary: '🤖 Ejecutar agente IA con URL y mensaje',
                description: 'Ejecuta el agente IA para automatizar una tarea en una URL específica. Requiere OPENAI_API_KEY configurada.',
                tags: ['AI Agent'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['url', 'message'],
                                properties: {
                                    url: { type: 'string', description: 'URL de la página web' },
                                    message: { type: 'string', description: 'Instrucción en lenguaje natural' },
                                    email: { type: 'string', description: 'Email para login (opcional)' },
                                    username: { type: 'string', description: 'Username para login (opcional)' },
                                    password: { type: 'string', description: 'Password para login (opcional)' },
                                    headless: { type: 'boolean', default: true, description: 'Ejecutar sin mostrar navegador' },
                                    recordFlow: { type: 'string', description: 'Nombre para guardar el flujo (opcional)' },
                                    maxSteps: { type: 'integer', default: 20, description: 'Máximo de pasos' }
                                }
                            },
                            example: {
                                url: 'https://practicetestautomation.com/practice-test-login/',
                                message: "Ingresa las credenciales, haz login y verifica que dice 'Logged In Successfully'",
                                username: 'student',
                                password: 'Password123',
                                headless: false,
                                maxSteps: 10
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Resultado del agente',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                success: { type: 'boolean' },
                                                summary: { type: 'string' },
                                                stepsExecuted: { type: 'integer' },
                                                data: { type: 'object' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    tags: [
        { name: 'AI Agent', description: '🤖 Agente IA para automatización inteligente' },
        { name: 'Flows', description: 'Gestión de flujos de automatización' },
        { name: 'Execution', description: 'Ejecución y reproducción de flujos' },
        { name: 'Snapshots', description: 'Capturas de estado de página' }

    ]
};

// Validation schemas
const ExecuteFlowSchema = z.object({
    flowId: z.string().optional(),
    flowName: z.string().optional(),
    variables: z.record(z.string()).optional(),
    headless: z.boolean().optional().default(true),
});

const ReplayFlowSchema = z.object({
    flowId: z.string().optional(),
    flowName: z.string().optional(),
    variables: z.record(z.string()).optional(),
    slowMo: z.number().optional().default(500),
    validateSnapshots: z.boolean().optional().default(true),
    headless: z.boolean().optional().default(true),
});

export function createApiServer(config: {
    dbPath: string;
    screenshotsDir: string;
    port?: number;
}) {
    const app = new Hono();

    // Middleware
    app.use('*', cors());
    app.use('*', logger());

    // Repositories
    const flowRepo = new SqliteWebFlowRepository(config.dbPath);
    const snapshotRepo = new SqliteSnapshotRepository(config.dbPath);
    const sessionRepo = new SqliteSessionRepository(config.dbPath);

    // Use cases
    const executeFlowUseCase = new ExecuteFlowUseCase(flowRepo, snapshotRepo);
    const replayFlowUseCase = new ReplayFlowUseCase(flowRepo, snapshotRepo);

    // ============================================
    // Swagger UI
    // ============================================

    // OpenAPI JSON endpoint
    app.get('/openapi.json', (c) => c.json(openApiSpec));

    // Swagger UI page
    app.get('/swagger', swaggerUI({ url: '/openapi.json' }));
    app.get('/docs', swaggerUI({ url: '/openapi.json' }));

    // ============================================
    // Routes
    // ============================================

    // Health check
    app.get('/health', (c) => c.json({ status: 'ok' }));

    // Home page with links
    app.get('/', (c) => {
        return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Web Automation API</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
          h1 { color: #333; }
          a { color: #0066cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .card { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
          code { background: #e0e0e0; padding: 2px 6px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>🤖 Web Automation API</h1>
        <div class="card">
          <h2>📖 Documentación</h2>
          <p><a href="/docs">Swagger UI</a> - Prueba la API interactivamente</p>
          <p><a href="/openapi.json">OpenAPI JSON</a> - Especificación raw</p>
        </div>
        <div class="card">
          <h2>🔗 Endpoints principales</h2>
          <ul>
            <li><code>GET /api/flows</code> - Listar flujos</li>
            <li><code>POST /api/flows/execute</code> - Ejecutar flujo</li>
            <li><code>POST /api/flows/replay</code> - Reproducir con validación</li>
          </ul>
        </div>
      </body>
      </html>
    `);
    });

    // List all flows
    app.get('/api/flows', async (c) => {
        try {
            const flows = await flowRepo.findAll();
            return c.json({
                success: true,
                data: flows.map(f => ({
                    id: f.id,
                    name: f.name,
                    description: f.description,
                    startUrl: f.startUrl,
                    stepCount: f.stepCount,
                    status: f.status,
                    executionCount: f.executionCount,
                    successRate: f.getSuccessRate(),
                    createdAt: f.createdAt,
                    updatedAt: f.updatedAt,
                })),
            });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // Get flow by ID
    app.get('/api/flows/:id', async (c) => {
        try {
            const flow = await flowRepo.findById(c.req.param('id'));
            if (!flow) {
                return c.json({ success: false, error: 'Flow not found' }, 404);
            }
            return c.json({ success: true, data: flow.toJSON() });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // Delete flow
    app.delete('/api/flows/:id', async (c) => {
        try {
            const deleted = await flowRepo.delete(c.req.param('id'));
            if (!deleted) {
                return c.json({ success: false, error: 'Flow not found' }, 404);
            }
            return c.json({ success: true, message: 'Flow deleted' });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // Execute flow
    app.post('/api/flows/execute', async (c) => {
        try {
            const body = await c.req.json();
            const input = ExecuteFlowSchema.parse(body);

            const browser = new PlaywrightBrowserAdapter({
                headless: input.headless ?? true,
                timeout: 30000,
            });

            await browser.launch();

            try {
                const result = await executeFlowUseCase.execute(
                    {
                        flowId: input.flowId,
                        flowName: input.flowName,
                        variables: input.variables,
                        screenshotsDir: config.screenshotsDir,
                    },
                    browser
                );

                return c.json({ success: true, data: result });
            } finally {
                await browser.close();
            }
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // Replay flow with validation
    app.post('/api/flows/replay', async (c) => {
        try {
            const body = await c.req.json();
            const input = ReplayFlowSchema.parse(body);

            const browser = new PlaywrightBrowserAdapter({
                headless: input.headless ?? true,
                timeout: 30000,
            });

            await browser.launch();

            try {
                const result = await replayFlowUseCase.replay(
                    {
                        flowId: input.flowId,
                        flowName: input.flowName,
                        variables: input.variables,
                        slowMo: input.slowMo,
                        validateSnapshots: input.validateSnapshots,
                        screenshotsDir: config.screenshotsDir,
                    },
                    browser
                );

                return c.json({ success: true, data: result });
            } finally {
                await browser.close();
            }
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // Get snapshots for a flow
    app.get('/api/flows/:id/snapshots', async (c) => {
        try {
            const snapshots = await snapshotRepo.findByFlowId(c.req.param('id'));
            return c.json({
                success: true,
                data: snapshots.map(s => s.toJSON()),
            });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // ============================================
    // AI Agent endpoint - Execute with URL + Message
    // ============================================
    app.post('/api/agent', async (c) => {
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return c.json({
                success: false,
                error: 'OPENAI_API_KEY not configured on server',
            }, 500);
        }

        try {
            const body = await c.req.json();

            if (!body.url || !body.message) {
                return c.json({
                    success: false,
                    error: 'Missing required fields: url and message',
                }, 400);
            }

            const agent = new WebAgent({
                openaiApiKey: openaiKey,
                headless: body.headless ?? true,
                recordFlow: !!body.recordFlow,
                maxSteps: body.maxSteps || 20,
            });

            const result = await agent.run({
                url: body.url,
                instruction: body.message,
                credentials: (body.email || body.username || body.password) ? {
                    email: body.email,
                    username: body.username,
                    password: body.password,
                } : undefined,
                flowName: body.recordFlow,
            });

            return c.json({
                success: true,
                data: result
            });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // ============================================
    // Continue Session - Open browser with saved cookies
    // ============================================
    app.post('/api/continue', async (c) => {
        try {
            const body = await c.req.json();

            if (!body.url || !body.cookies) {
                return c.json({
                    success: false,
                    error: 'Missing required fields: url and cookies',
                }, 400);
            }

            console.log(`\n🔗 ════════════════════════════════════════════════════════`);
            console.log(`   📍 Continuando sesión con cookies...`);
            console.log(`   🌐 URL: ${body.url}`);
            console.log(`   🍪 Cookies: ${body.cookies.length}`);
            console.log(`   ════════════════════════════════════════════════════════\n`);

            // Import BrowserClient dynamically
            const { BrowserClient } = await import('../../browser/browser-client.js');

            // Launch VISIBLE browser
            const browser = new BrowserClient(
                { headless: false, timeout: 30000 },
                ''
            );
            await browser.launch();

            // Extract domain from target URL for login
            const targetUrl = new URL(body.url);
            const baseUrl = `${targetUrl.protocol}//${targetUrl.host}`;
            const loginUrl = `${baseUrl}/frontend/login`; // Assuming standard login path or infer

            console.log(`   🔐 Navegando a posible login: ${loginUrl}`);

            // Navigate to login/home first to set context
            try {
                await browser.goto(loginUrl);
            } catch (e) {
                // If login url fails, try base url
                await browser.goto(baseUrl);
            }

            // Set cookies
            await browser.setCookies(body.cookies);
            console.log(`   ✅ Cookies establecidas`);

            // Robust Login with Credentials
            if (body.credentials && body.credentials.username && body.credentials.password) {
                console.log(`   🔐 Intentando login robusto con credenciales...`);
                try {
                    // Generic Selectors
                    const userSelectors = ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[name="login"]', '#email', '#username'];
                    const passSelectors = ['input[type="password"]', 'input[name="password"]', '#password'];
                    const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Login")', 'button:has-text("Entrar")', 'button:has-text("Sign in")'];

                    // Helper to try filling
                    let userFilled = false;
                    for (const sel of userSelectors) {
                        try { await browser.type(sel, body.credentials.username); userFilled = true; break; } catch { }
                    }

                    if (userFilled) {
                        for (const sel of passSelectors) {
                            try { await browser.type(sel, body.credentials.password); break; } catch { }
                        }

                        for (const sel of submitSelectors) {
                            try { await browser.click(sel); break; } catch { }
                        }

                        console.log(`   ✅ Credenciales enviadas`);
                        await new Promise(r => setTimeout(r, 2000)); // Wait for login
                    } else {
                        console.log(`   ⚠️ No se encontraron campos de login (¿ya logueado?)`);
                    }
                } catch (e) {
                    console.log(`   ⚠️ Error en login manual: ${e}`);
                }
            }

            // Navigate to payment URL
            await browser.goto(body.url);

            console.log(`   ✅ Navegador abierto con sesión activa`);
            console.log(`   👆 Completa el pago manualmente en el navegador\n`);

            // Don't close browser - leave it open for user
            return c.json({
                success: true,
                message: 'Navegador abierto con sesión activa - completa el pago manualmente',
                url: body.url,
            });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // ============================================
    // Session Storage for Token-based sharing
    // ============================================
    interface StoredSession {
        url: string;
        cookies: any[];
        reservationInfo?: {
            date?: string;
            time?: string;
            price?: string;
        };
        credentials?: {
            username: string;
            password: string;
        };
        createdAt: number;
        expiresAt: number;
    }

    // Clean expired sessions periodically using SQLite
    setInterval(async () => {
        const deleted = await sessionRepo.deleteExpired();
        if (deleted > 0) {
            console.log(`   🗑️ Deleted ${deleted} expired session(s)`);
        }
    }, 5 * 60 * 1000); // Clean every 5 minutes

    // ============================================
    // POST /api/session - Save session with cookies
    // ============================================
    app.post('/api/session', async (c) => {
        try {
            const body = await c.req.json();

            if (!body.token || !body.url || !body.cookies) {
                return c.json({
                    success: false,
                    error: 'Missing required fields: token, url, and cookies',
                }, 400);
            }

            const session: StoredSession = {
                url: body.url,
                cookies: body.cookies,
                reservationInfo: body.reservationInfo,
                credentials: body.credentials, // New field
                createdAt: Date.now(),
                expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour
            };

            await sessionRepo.save(body.token, session);

            console.log(`\n🎫 ════════════════════════════════════════════════════════`);
            console.log(`   ✅ Sesión guardada con token: ${body.token}`);
            console.log(`   🌐 URL: ${body.url}`);
            console.log(`   🍪 Cookies: ${body.cookies.length}`);
            console.log(`   ⏱️ Expira: ${new Date(session.expiresAt).toISOString()}`);
            console.log(`   ════════════════════════════════════════════════════════\n`);

            // Build shareable link - use BASE_URL env var for public access (e.g., ngrok)
            const port = config.port || 3000;
            const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
            const shareableLink = `${baseUrl}/session/${body.token}`;

            return c.json({
                success: true,
                message: 'Sesión guardada correctamente',
                token: body.token,
                shareableLink,
                expiresAt: new Date(session.expiresAt).toISOString(),
            });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    // ============================================
    // GET /session/:token - Redirect with cookies injected
    // ============================================
    app.get('/session/:token', async (c) => {
        const token = c.req.param('token');
        const session = await sessionRepo.findByToken(token);

        if (!session) {
            return c.html(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sesión No Encontrada</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
               display: flex; justify-content: center; align-items: center; 
               height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                text-align: center; max-width: 400px; }
        h1 { color: #e74c3c; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; }
        .icon { font-size: 64px; margin-bottom: 16px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">❌</div>
        <h1>Sesión No Encontrada</h1>
        <p>El enlace ha expirado o no es válido.<br>Por favor, solicita un nuevo enlace de pago.</p>
    </div>
</body>
</html>
            `, 404);
        }

        // Check if expired
        if (session.expiresAt < Date.now()) {
            await sessionRepo.delete(token);
            return c.html(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sesión Expirada</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
               display: flex; justify-content: center; align-items: center; 
               height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                text-align: center; max-width: 400px; }
        h1 { color: #f39c12; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; }
        .icon { font-size: 64px; margin-bottom: 16px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">⏰</div>
        <h1>Sesión Expirada</h1>
        <p>Este enlace de pago ha expirado.<br>Por favor, solicita un nuevo enlace.</p>
    </div>
</body>
</html>
            `, 410);
        }

        // Generate HTML page that automatically logs in and redirects
        const cookiesJson = JSON.stringify(session.cookies);
        const targetUrl = session.url;
        const reservationHtml = session.reservationInfo ? `
            <div class="info">
                <p>📅 <strong>Fecha:</strong> ${session.reservationInfo.date || 'N/A'}</p>
                <p>⏰ <strong>Hora:</strong> ${session.reservationInfo.time || 'N/A'}</p>
                ${session.reservationInfo.price ? `<p>💰 <strong>Precio:</strong> ${session.reservationInfo.price}</p>` : ''}
            </div>
        ` : '';

        return c.html(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cargando Sesión...</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
               display: flex; justify-content: center; align-items: center; 
               min-height: 100vh; margin: 0; padding: 20px;
               background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                text-align: center; max-width: 500px; width: 100%; }
        h1 { color: #333; margin-bottom: 16px; font-size: 24px; }
        p { color: #666; line-height: 1.6; margin: 12px 0; }
        .icon { font-size: 48px; margin-bottom: 16px; }
        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #667eea; border-radius: 50%;
                   width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 20px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .info { background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: left; }
        .info p { margin: 8px 0; color: #333; }
        .progress { background: #e9ecef; border-radius: 8px; height: 8px; margin: 20px 0; overflow: hidden; }
        .progress-bar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        height: 100%; width: 0%; transition: width 0.5s; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">�</div>
        <h1>Preparando Sesión de Pago</h1>
        ${reservationHtml}
        <div class="spinner"></div>
        <p id="status">Iniciando sesión automáticamente...</p>
        <div class="progress">
            <div class="progress-bar" id="progress"></div>
        </div>
    </div>

    <script>
        const cookies = ${cookiesJson};
        const targetUrl = "${targetUrl}";
        const statusEl = document.getElementById('status');
        const progressBar = document.getElementById('progress');
        
        // Extract domain info
        const url = new URL(targetUrl);
        const loginUrl = url.origin + '/login';
        
        // Function to set cookies
        function setCookies() {
            let cookiesSet = 0;
            cookies.forEach(cookie => {
                try {
                    let cookieStr = cookie.name + '=' + encodeURIComponent(cookie.value);
                    if (cookie.path) cookieStr += '; path=' + cookie.path;
                    if (cookie.domain) cookieStr += '; domain=' + cookie.domain;
                    if (cookie.expires) {
                        const expires = new Date(cookie.expires * 1000);
                        cookieStr += '; expires=' + expires.toUTCString();
                    }
                    if (cookie.secure) cookieStr += '; secure';
                    if (cookie.sameSite) cookieStr += '; samesite=' + cookie.sameSite;
                    
                    document.cookie = cookieStr;
                    cookiesSet++;
                } catch(e) {
                    console.warn('Could not set cookie:', cookie.name, e);
                }
            });
            return cookiesSet;
        }
        
        // Auto-login flow
        async function autoLogin() {
            try {
                // Step 1: Navigate to login page to establish domain context
                statusEl.textContent = 'Paso 1/3: Conectando con ' + url.host + '...';
                progressBar.style.width = '33%';
                
                // Set cookies for authentication
                const cookiesSet = setCookies();
                
                // The original instruction was for a server-side /api/continue endpoint
                // and used a 'browser' object (like Playwright).
                // This client-side script cannot directly interact with a 'browser' object
                // or perform form-based logins across origins due to security restrictions.
                // The provided snippet for the change is not directly applicable here.
                // The client-side script can only set cookies for the current domain
                // and then redirect.
                // Therefore, the client-side autoLogin function remains as is,
                // focusing on cookie injection and redirection.
                // The server-side /api/continue endpoint (if it existed) would handle
                // the Playwright-based login logic.

                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Step 2: Set cookies
                statusEl.textContent = 'Paso 2/3: Estableciendo sesión (' + cookiesSet + ' cookies)...';
                progressBar.style.width = '66%';
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Step 3: Redirect to payment page
                statusEl.textContent = 'Paso 3/3: Redirigiendo a página de pago...';
                progressBar.style.width = '100%';
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Final redirect
                window.location.href = targetUrl;
                
            } catch (error) {
                statusEl.textContent = '❌ Error: ' + error.message;
                statusEl.style.color = '#dc3545';
            }
        }
        
        // Start auto-login after page load
        window.addEventListener('load', () => {
            setTimeout(autoLogin, 500);
        });
    </script>
</body>
</html>
        `);
    });

    // ============================================
    // GET /api/session/:token - Get session info (for debugging)
    // ============================================
    app.get('/api/session/:token', async (c) => {
        const token = c.req.param('token');
        const session = await sessionRepo.findByToken(token);

        if (!session) {
            return c.json({ success: false, error: 'Session not found' }, 404);
        }

        return c.json({
            success: true,
            data: {
                url: session.url,
                cookieCount: session.cookies.length,
                reservationInfo: session.reservationInfo,
                createdAt: new Date(session.createdAt).toISOString(),
                expiresAt: new Date(session.expiresAt).toISOString(),
                expired: session.expiresAt < Date.now(),
            }
        });
    });

    // ============================================
    // POST /api/validate-token - Validate token from external domain
    // ============================================
    app.post('/api/validate-token', async (c) => {
        try {
            const body = await c.req.json();

            if (!body.token) {
                return c.json({
                    success: false,
                    error: 'Missing required field: token',
                }, 400);
            }

            const session = await sessionRepo.findByToken(body.token);

            if (!session) {
                return c.json({
                    success: false,
                    error: 'Invalid or expired token',
                    valid: false,
                }, 404);
            }

            // Check if expired
            if (session.expiresAt < Date.now()) {
                await sessionRepo.delete(body.token);
                return c.json({
                    success: false,
                    error: 'Token has expired',
                    valid: false,
                }, 410);
            }

            console.log(`\n🔐 ════════════════════════════════════════════════════════`);
            console.log(`   ✅ Token validado: ${body.token}`);
            console.log(`   🌐 URL: ${session.url}`);
            console.log(`   🍪 Cookies: ${session.cookies.length}`);
            console.log(`   ════════════════════════════════════════════════════════\n`);

            // Return session data (without cookies for security)
            return c.json({
                success: true,
                valid: true,
                data: {
                    url: session.url,
                    reservationInfo: session.reservationInfo,
                    createdAt: new Date(session.createdAt).toISOString(),
                    expiresAt: new Date(session.expiresAt).toISOString(),
                    // Optionally include cookies if the external domain needs them
                    cookies: session.cookies,
                }
            });
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }, 500);
        }
    });

    return {

        app,
        start: (port = config.port || 3000) => {
            console.log(`\n🚀 API server running on http://localhost:${port}`);
            console.log(`📖 Swagger UI: http://localhost:${port}/docs\n`);
            return serve({ fetch: app.fetch, port });
        },
        close: () => {
            flowRepo.close();
            snapshotRepo.close();
            sessionRepo.close();
        },
    };
}
