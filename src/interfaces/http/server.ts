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
        },
    };
}
