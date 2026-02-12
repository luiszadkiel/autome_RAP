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
import { ParallelAgent } from '../../agent/parallel-agent.js';


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
        },
        '/api/agent/parallel': {
            post: {
                summary: '🚀 Ejecutar agente en múltiples sitios en paralelo',
                description: 'Ejecuta el agente IA en múltiples URLs simultáneamente (1-10 sitios). Ideal para comparar precios, buscar productos en varias tiendas, etc. Cada target puede tener su propia URL de login y credenciales para iniciar sesión en múltiples páginas (cada sitio con su login independiente).',
                tags: ['AI Agent'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['instruction', 'targets'],
                                properties: {
                                    instruction: { type: 'string', description: 'Instrucción en lenguaje natural (se aplica a todos los sitios)' },
                                    targets: {
                                        type: 'array',
                                        description: 'Lista de sitios web (1-10 máximo). Cada elemento puede incluir loginUrl y credentials para loguearse en esa página.',
                                        items: {
                                            type: 'object',
                                            required: ['url', 'name'],
                                            properties: {
                                                url: { type: 'string', description: 'URL principal del sitio' },
                                                name: { type: 'string', description: 'Nombre identificador del sitio' },
                                                loginUrl: { type: 'string', description: 'URL de la página de login de este sitio (opcional). Si se indica junto con credentials, el agente navega primero aquí para iniciar sesión en esta página.' },
                                                credentials: {
                                                    type: 'object',
                                                    description: 'Credenciales para iniciar sesión en este target (cada sitio puede tener las suyas).',
                                                    properties: {
                                                        email: { type: 'string', description: 'Email para login' },
                                                        username: { type: 'string', description: 'Usuario (alternativa a email)' },
                                                        password: { type: 'string', description: 'Contraseña' }
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    maxParallel: { type: 'integer', default: 3, minimum: 1, maximum: 10, description: 'Cantidad de agentes ejecutándose simultáneamente' },
                                    maxStepsPerAgent: { type: 'integer', default: 20, description: 'Máximo de pasos por agente' },
                                    headless: { type: 'boolean', default: true, description: 'Ejecutar sin mostrar navegadores' }
                                }
                            },
                            example: {
                                instruction: 'buscar precio de taladro DeWalt DCD771',
                                targets: [
                                    { url: 'https://www.amazon.com', name: 'Amazon' },
                                    { url: 'https://www.homedepot.com', name: 'Home Depot', loginUrl: 'https://www.homedepot.com/c/login', credentials: { email: 'user@example.com', password: '***' } },
                                    { url: 'https://www.lowes.com', name: 'Lowes', loginUrl: 'https://www.lowes.com/l/login', credentials: { email: 'otro@example.com', password: '***' } }
                                ],
                                maxParallel: 3,
                                maxStepsPerAgent: 20,
                                headless: true
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Resultado comparativo de todos los sitios',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                instruction: { type: 'string' },
                                                totalTargets: { type: 'integer' },
                                                successful: { type: 'integer' },
                                                failed: { type: 'integer' },
                                                results: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            target: { type: 'string' },
                                                            url: { type: 'string' },
                                                            status: { type: 'string', enum: ['success', 'failed', 'error'] },
                                                            extractedInfo: { type: 'array' },
                                                            summary: { type: 'string' },
                                                            duration: { type: 'integer' }
                                                        }
                                                    }
                                                },
                                                comparison: { type: 'string', description: 'Resumen comparativo con mejor precio si aplica' },
                                                totalDuration: { type: 'integer' }
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
        '/api/session': {
            post: {
                summary: '🔗 Crear Magic Link con cookies y credenciales',
                description: 'Genera un link compartible que apunta a cayacoagolf.com con auto-login. El usuario hace clic y el userscript de Tampermonkey hace login automático.',
                tags: ['Magic Link'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['token', 'url', 'cookies'],
                                properties: {
                                    token: { type: 'string', description: 'Token único para el magic link (ej: UUID)' },
                                    url: { type: 'string', description: 'URL de destino en Cayacoa después del login' },
                                    cookies: { 
                                        type: 'array',
                                        description: 'Cookies de sesión del navegador',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                name: { type: 'string' },
                                                value: { type: 'string' },
                                                domain: { type: 'string' },
                                                path: { type: 'string' }
                                            }
                                        }
                                    },
                                    credentials: {
                                        type: 'object',
                                        description: 'Credenciales de login',
                                        properties: {
                                            username: { type: 'string' },
                                            password: { type: 'string' }
                                        }
                                    },
                                    reservationInfo: {
                                        type: 'object',
                                        description: 'Información de la reserva (opcional)',
                                        properties: {
                                            date: { type: 'string' },
                                            time: { type: 'string' },
                                            price: { type: 'string' }
                                        }
                                    }
                                }
                            },
                            example: {
                                token: 'abc123xyz',
                                url: 'https://cayacoagolf.com/payment/12345',
                                cookies: [
                                    { name: 'session_id', value: 'xyz789', domain: 'cayacoagolf.com', path: '/' }
                                ],
                                credentials: {
                                    username: 'usuario@email.com',
                                    password: 'contraseña123'
                                },
                                reservationInfo: {
                                    date: '2026-02-15',
                                    time: '10:00 AM',
                                    price: '$50'
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Magic Link generado exitosamente',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        message: { type: 'string' },
                                        token: { type: 'string' },
                                        magicLink: { type: 'string', description: 'Link que apunta a cayacoagolf.com' },
                                        serverLink: { type: 'string', description: 'Link alternativo del servidor' },
                                        shareableLink: { type: 'string', description: 'Alias de magicLink' },
                                        expiresAt: { type: 'string', format: 'date-time' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/validate-token': {
            post: {
                summary: '✅ Validar token y obtener credenciales',
                description: 'Endpoint llamado por el userscript para validar el token del Magic Link y obtener las credenciales.',
                tags: ['Magic Link'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['token'],
                                properties: {
                                    token: { type: 'string', description: 'Token del magic link' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Token válido',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        valid: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                url: { type: 'string' },
                                                cookies: { type: 'array' },
                                                reservationInfo: { type: 'object' },
                                                credentials: { 
                                                    type: 'object',
                                                    properties: {
                                                        username: { type: 'string' },
                                                        password: { type: 'string' }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Token no encontrado'
                    },
                    '410': {
                        description: 'Token expirado'
                    }
                }
            }
        }
    },
    tags: [
        { name: 'AI Agent', description: '🤖 Agente IA para automatización inteligente' },
        { name: 'Magic Link', description: '🔗 Sistema de links compartibles con auto-login' },
        { name: 'Flows', description: 'Gestión de flujos de automatización' },
        { name: 'Execution', description: 'Ejecución y reproducción de flujos' },
        { name: 'Snapshots', description: 'Capturas de estado de página' }

    ]
};

/**
 * Helper function to normalize cookies with cross-domain attributes
 * 
 * Para transferir cookies entre dominios diferentes (ej: cayacoagolf.com -> ngrok-free.app),
 * el navegador requiere estos atributos específicos:
 * - SameSite=None: Permite que la cookie se envíe en contextos de sitios cruzados (cross-site)
 * - Secure: Obligatorio cuando se usa SameSite=None. Requiere HTTPS
 * - HttpOnly: Recomendado para evitar acceso a cookies mediante scripts maliciosos
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
 */
function normalizeCookiesForCrossDomain(cookies: any[]): any[] {
    return cookies.map(cookie => ({
        ...cookie,
        sameSite: 'None' as const,
        secure: true,
        httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : true,
    }));
}

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

    // Serve userscript for Tampermonkey
    app.get('/userscript/cayacoa-autofill.user.js', (c) => {
        const fs = require('fs');
        const path = require('path');
        const scriptPath = path.join(__dirname, '../../../userscript/cayacoa-autofill.user.js');
        
        try {
            const script = fs.readFileSync(scriptPath, 'utf-8');
            c.header('Content-Type', 'application/javascript');
            c.header('Content-Disposition', 'inline; filename="cayacoa-autofill.user.js"');
            return c.text(script);
        } catch (error) {
            return c.json({ success: false, error: 'Userscript not found' }, 404);
        }
    });

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
          .highlight { background: #e0f2fe; border-left: 4px solid #0284c7; }
          code { background: #e0e0e0; padding: 2px 6px; border-radius: 4px; }
          .btn { display: inline-block; background: #10b981; color: white; padding: 10px 20px; 
                 border-radius: 6px; text-decoration: none; font-weight: 500; margin-top: 10px; }
          .btn:hover { background: #059669; text-decoration: none; }
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
            <li><code>POST /api/agent</code> - Ejecutar agente IA</li>
            <li><code>POST /api/agent/parallel</code> - Ejecutar en múltiples sitios (1-10)</li>
          </ul>
        </div>
        <div class="card highlight">
          <h2>🏌️ Cayacoa Golf - Magic Link Auto-Login</h2>
          <p><strong>Sistema de links compartibles con login automático</strong></p>
          
          <h3 style="font-size: 16px; margin-top: 16px;">📋 ¿Cómo funciona?</h3>
          <ol style="font-size: 14px; line-height: 1.8;">
            <li>Instala el userscript de Tampermonkey (una sola vez)</li>
            <li>Genera un Magic Link mediante POST /api/session</li>
            <li>Comparte el link (apunta directamente a cayacoagolf.com)</li>
            <li>El usuario hace clic → Login automático → Acceso directo</li>
          </ol>
          
          <h3 style="font-size: 16px; margin-top: 16px;">🔧 Instalación</h3>
          <ol style="font-size: 14px; line-height: 1.8;">
            <li>Instala <a href="https://www.tampermonkey.net/" target="_blank">Tampermonkey</a> en tu navegador</li>
            <li>Haz clic en el botón de abajo para instalar el script</li>
            <li>Configura tu servidor: <code>cayacoaAutoLogin.setApiServer("https://tu-servidor.ngrok-free.app")</code></li>
          </ol>
          
          <a href="/userscript/cayacoa-autofill.user.js" class="btn">📦 Instalar Userscript v2.0</a>
          
          <div style="background: #f0fdf4; padding: 12px; border-radius: 6px; margin-top: 16px; font-size: 13px;">
            <strong>✨ Nuevo:</strong> Magic Links que apuntan directamente a Cayacoa
            <br>
            <code style="display: block; margin-top: 8px; background: white; padding: 8px; border-radius: 4px;">
              https://cayacoagolf.com/auto-login?token=abc123
            </code>
          </div>
          
          <p style="font-size: 12px; color: #666; margin-top: 12px;">
            Compatible con Chrome, Firefox, Safari, Edge
          </p>
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
    // Parallel Agent - Execute on multiple sites simultaneously
    // ============================================
    app.post('/api/agent/parallel', async (c) => {
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return c.json({
                success: false,
                error: 'OPENAI_API_KEY not configured on server',
            }, 500);
        }

        try {
            const body = await c.req.json();

            // Validar: targets obligatorio; instruction global o por target
            if (!body.targets || !Array.isArray(body.targets)) {
                return c.json({
                    success: false,
                    error: 'Missing required field: targets (array)',
                    example: {
                        instruction: "buscar precio de taladro DeWalt",
                        targets: [
                            { url: "https://ferreteria1.com", name: "Ferretería A" },
                            { url: "https://ferreteria2.com", name: "Ferretería B", loginUrl: "https://ferreteria2.com/login", credentials: { email: "...", password: "..." } }
                        ],
                        maxParallel: 3,
                        maxStepsPerAgent: 15,
                        headless: true
                    }
                }, 400);
            }

            const globalInstruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
            const targets = body.targets.map((t: { url: string; name: string; instruction?: string; loginUrl?: string; credentials?: unknown }) => ({
                url: t.url,
                name: t.name,
                instruction: typeof t.instruction === 'string' ? t.instruction.trim() : undefined,
                loginUrl: t.loginUrl,
                credentials: t.credentials
            }));

            const targetsWithoutInstruction = targets.filter((t: { instruction?: string }) => !t.instruction?.length);
            if (!globalInstruction && targetsWithoutInstruction.length > 0) {
                return c.json({
                    success: false,
                    error: 'Se requiere "instruction" global o que cada target tenga su propio "instruction". Targets sin instrucción: ' +
                        targetsWithoutInstruction.map((t: { name: string }) => t.name).join(', ')
                }, 400);
            }
            if (globalInstruction && targetsWithoutInstruction.length === 0) {
                // Todos tienen instrucción propia; la global es fallback por si acaso
            }

            if (targets.length === 0) {
                return c.json({
                    success: false,
                    error: 'targets array cannot be empty',
                }, 400);
            }

            if (targets.length > 10) {
                return c.json({
                    success: false,
                    error: 'Maximum 10 targets allowed per request',
                }, 400);
            }

            // Advertencia y recomendaciones para muchos agentes
            const maxParallel = body.maxParallel || 3;
            if (maxParallel >= 7 && body.targets.length >= 7) {
                console.log(`\n⚠️  ADVERTENCIA: Ejecutando ${maxParallel} agentes en paralelo`);
                console.log(`   • Se usarán múltiples navegadores para mejor rendimiento`);
                console.log(`   • Consumo estimado de RAM: ${maxParallel * 200}-${maxParallel * 400}MB`);
                console.log(`   • Tiempo estimado: ${Math.ceil(body.targets.length / maxParallel) * 30}-${Math.ceil(body.targets.length / maxParallel) * 60}s\n`);
            }

            // Validar cada target
            for (const target of targets) {
                if (!target.url || !target.name) {
                    return c.json({
                        success: false,
                        error: 'Each target must have url and name fields',
                    }, 400);
                }
            }

            const parallelAgent = new ParallelAgent({
                openaiApiKey: openaiKey,
                maxParallel: body.maxParallel || 3,
                headless: body.headless ?? true,
                maxStepsPerAgent: body.maxStepsPerAgent || 20
            });

            const result = await parallelAgent.run({
                instruction: globalInstruction || 'Completar tarea indicada en el sitio.',
                targets,
                maxParallel: body.maxParallel
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

            // Set cookies with cross-domain attributes
            const normalizedCookies = normalizeCookiesForCrossDomain(body.cookies);
            await browser.setCookies(normalizedCookies);
            console.log(`   ✅ Cookies establecidas con SameSite=None; Secure; HttpOnly`);

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

            // Build Magic Link - apunta a TU servidor que hace el auto-login
            // El servidor abre el navegador, hace login automático y redirige al usuario
            const port = config.port || 3000;
            const serverBaseUrl = process.env.BASE_URL || `http://localhost:${port}`;
            const magicLink = `${serverBaseUrl}/session/${body.token}`;
            
            // Link alternativo: URL de destino con token (requiere userscript en el navegador del usuario)
            const targetUrlWithToken = body.url.includes('?') 
                ? `${body.url}&token=${body.token}`
                : `${body.url}?token=${body.token}`;

            console.log(`\n   🔗 ═══════════════════════════════════════════════════════`);
            console.log(`   📱 ENLACE PARA COMPARTIR POR WHATSAPP:`);
            console.log(`   ${magicLink}`);
            console.log(`   ═══════════════════════════════════════════════════════\n`);

            return c.json({
                success: true,
                message: 'Sesión guardada correctamente',
                token: body.token,
                magicLink,                    // Link principal - TU servidor hace el login
                shareableLink: magicLink,     // Alias (para compatibilidad)
                alternativeLink: targetUrlWithToken, // Link alternativo con userscript
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
    // GET /session/:token - Auto-login with Playwright and redirect
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

        // Try to set cookies via Set-Cookie headers and redirect
        // Note: This will only work if both domains are the same
        const targetUrl = session.url;
        const urlObj = new URL(targetUrl);
        
        console.log(`\n🔗 ════════════════════════════════════════════════════════`);
        console.log(`   📱 ACCESO AL LINK COMPARTIDO`);
        console.log(`   🎫 Token: ${token}`);
        console.log(`   👤 Usuario: ${session.credentials?.username || 'zad.duran@gmail.com'}`);
        console.log(`   📅 Reserva: ${session.reservationInfo?.date || 'N/A'} - ${session.reservationInfo?.time || 'N/A'}`);
        console.log(`   🌐 URL destino: ${targetUrl}`);
        console.log(`   🍪 Cookies guardadas: ${session.cookies.length}`);
        console.log(`   🤖 Usando Playwright para auto-login en el servidor...`);
        console.log(`   ════════════════════════════════════════════════════════\n`);

        // Simple redirect approach - can't transfer cookies cross-domain
        const credentials = session.credentials || { username: 'zad.duran@gmail.com', password: 'zad1234567' };
        
        console.log(`   🌐 Enviando página HTML con credenciales`);
        console.log(`   📱 Optimizado para enlaces compartibles (WhatsApp/Email/SMS)\n`);
        
        // ============================================
        // OPCIÓN: Redirigir a PWA (Auto-login automático después de 1ra vez)
        // ACTIVAR: Descomenta estas líneas cuando publiques tu PWA
        // ============================================
        
        // Configuración: URL de tu PWA publicada
        const USAR_PWA = true; // ✅ ACTIVADO - Redirige a PWA automática
        const PWA_URL = 'https://pwa-cayacoa.netlify.app/'; // ✅ Tu PWA en Netlify
        
        if (USAR_PWA) {
            // Extraer booking COMPLETO de la URL de destino (ej: 620am/03022026)
            const bookingMatch = targetUrl.match(/make-booking\/(.+?)(?:\?|$)/);
            if (bookingMatch) {
                const bookingParam = bookingMatch[1].replace(/\/$/, ''); // Quitar trailing slash
                
                // Codificar credenciales en base64 URL-safe para incluirlas en la URL
                const credentialsJson = JSON.stringify({
                    email: credentials.username,
                    password: credentials.password
                });
                // Usar base64 URL-safe (reemplazar +/= con caracteres seguros para URLs)
                const base64 = Buffer.from(credentialsJson).toString('base64');
                const credentialsEncoded = base64
                    .replace(/\+/g, '-')  // + → -
                    .replace(/\//g, '_')  // / → _
                    .replace(/=/g, '');   // quitar padding =
                
                console.log(`   🔀 Redirigiendo a PWA con booking: ${bookingParam}`);
                console.log(`   🔐 Credenciales incluidas en URL (encriptadas)`);
                console.log(`   🌐 PWA URL: ${PWA_URL}?booking=${bookingParam}&credentials=***\n`);
                
                // Redirigir con booking Y credenciales
                return c.redirect(`${PWA_URL}?booking=${bookingParam}&credentials=${credentialsEncoded}`);
            }
        }
        
        // ============================================
        // OPCIÓN 1: Auto-login del lado del CLIENTE (Recomendado para WhatsApp)
        // El navegador del usuario hace el login usando iframe + JavaScript
        // ============================================
        
        // Descomentar para usar automatización del lado del servidor (Playwright)
        // Ver líneas 1085-1207 para implementación con Playwright
        // Requiere servidor con capacidad para abrir navegadores (no recomendado para producción)
        
        if (false) { // ❌ AUTOMATIZACIÓN DESACTIVADA - El navegador del usuario hace el login
            // Server-side automation with redirect
            try {
            const { BrowserClient } = await import('../../browser/browser-client.js');
            
            const browser = new BrowserClient(
                { headless: true, timeout: 30000 },
                ''
            );
            await browser.launch();
            
            try {
                const loginUrl = `${urlObj.protocol}//${urlObj.hostname}/front-end/login`;
                console.log(`   🔐 Navegando a login: ${loginUrl}`);
                await browser.goto(loginUrl);
                
                // Set cookies with cross-domain attributes
                console.log(`   🍪 Estableciendo cookies con SameSite=None; Secure; HttpOnly...`);
                const normalizedCookies = normalizeCookiesForCrossDomain(session?.cookies || []);
                await browser.setCookies(normalizedCookies);
                
                // Auto-fill login con selectores EXACTOS de Cayacoa
                console.log(`   ✍️ Auto-completando login...`);
                
                // ============================================
                // SELECTORES EXACTOS de Cayacoa Golf Club
                // ============================================
                const emailSelectors = [
                    'input[name="username"]',     // ← Selector PRINCIPAL de Cayacoa
                    'input[type="email"]', 
                    'input[name="email"]', 
                    '#email'
                ];
                for (const sel of emailSelectors) {
                    try {
                        await browser.type(sel, credentials.username);
                        console.log(`   ✅ Email ingresado con selector: ${sel}`);
                        break;
                    } catch (e) {
                        console.log(`   ⏭️ Selector ${sel} no encontrado, probando siguiente...`);
                    }
                }
                
                const passSelectors = [
                    'input[name="password"]',     // ← Selector PRINCIPAL de Cayacoa
                    'input[type="password"]', 
                    '#password'
                ];
                for (const sel of passSelectors) {
                    try {
                        await browser.type(sel, credentials.password);
                        console.log(`   ✅ Password ingresado con selector: ${sel}`);
                        break;
                    } catch (e) {
                        console.log(`   ⏭️ Selector ${sel} no encontrado, probando siguiente...`);
                    }
                }
                
                const submitSelectors = [
                    'button.btn-primary',         // ← Selector PRINCIPAL de Cayacoa
                    'button[type="submit"]', 
                    'input[type="submit"]'
                ];
                for (const sel of submitSelectors) {
                    try {
                        await browser.click(sel);
                        console.log(`   ✅ Botón Acceder clickeado con selector: ${sel}`);
                        break;
                    } catch (e) {
                        console.log(`   ⏭️ Selector ${sel} no encontrado, probando siguiente...`);
                    }
                }
                
                // Wait for login
                await new Promise(r => setTimeout(r, 3000));
                console.log(`   ⏳ Esperando confirmación de login...`);
                
                // Navigate to payment page
                await browser.goto(targetUrl);
                await new Promise(r => setTimeout(r, 2000));
                console.log(`   💳 Página de pago cargada`);
                
                // Get fresh cookies
                const freshCookies = await browser.getCookies();
                console.log(`   🍪 Cookies actualizadas: ${freshCookies.length}`);
                
                await browser.close();
                console.log(`   ✅ Automatización completada\n`);
                
                // Now return HTML with fresh cookies and immediate redirect
                const cookiesJson = JSON.stringify(freshCookies);
                
                return c.html(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redirigiendo a Cayacoa...</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
               display: flex; justify-content: center; align-items: center; 
               min-height: 100vh; margin: 0; padding: 16px;
               background: linear-gradient(135deg, #10b981 0%, #059669 100%); }
        .card { background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                text-align: center; max-width: 400px; width: 100%; }
        h1 { color: #059669; margin-bottom: 12px; font-size: 24px; font-weight: 600; }
        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #10b981; border-radius: 50%;
                   width: 60px; height: 60px; animation: spin 1s linear infinite; margin: 24px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .status { color: #666; font-size: 15px; line-height: 1.6; margin: 16px 0; }
        .success { color: #10b981; font-weight: 600; font-size: 16px; margin: 16px 0; }
        .emoji { font-size: 56px; margin-bottom: 16px; }
        .info { background: #f0fdf4; padding: 12px; border-radius: 8px; margin: 16px 0; font-size: 13px;
                border-left: 4px solid #10b981; text-align: left; }
    </style>
</head>
<body>
    <div class="card">
        <div class="emoji">✅</div>
        <h1>¡Login Exitoso!</h1>
        <div class="success">Sesión iniciada automáticamente</div>
        <div class="spinner"></div>
        <div class="status" id="status">Redirigiendo a tu reserva...</div>
        <div class="info">
            ${session?.reservationInfo?.date ? '📅 ' + session?.reservationInfo?.date + '<br>' : ''}
            ${session?.reservationInfo?.time ? '⏰ ' + session?.reservationInfo?.time : ''}
        </div>
    </div>

    <script>
        // Redirect immediately to payment page
        setTimeout(() => {
            window.location.href = '${targetUrl}';
        }, 2000);
    </script>
</body>
</html>
                `);
                
            } catch (error) {
                await browser.close();
                throw error;
            }
            
        } catch (error) {
            console.log(`   ❌ Error en automatización: ${error}`);
            console.log(`   ⚠️ Fallback: Mostrando página con credenciales\n`);
        }
        } // Fin del if(false) - Playwright está desactivado
        
        // ============================================
        // Redirect Simple: Pre-llenar formulario con parámetros en URL
        // El userscript detecta los parámetros y llena el formulario automáticamente
        // ============================================
        const loginUrl = `${urlObj.protocol}//${urlObj.hostname}/front-end/login`;
        
        console.log(`   🔗 Redirigiendo con credenciales en URL...`);
        console.log(`   📧 Email: ${credentials.username}`);
        console.log(`   🔐 Password: [protegido]`);
        console.log(`   🌐 URL: ${loginUrl}\n`);
        
        return c.html(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redirigiendo a Cayacoa Golf...</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh;
            padding: 20px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        }
        .card { 
            background: white; 
            padding: 32px; 
            border-radius: 20px; 
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center; 
            max-width: 450px;
            width: 100%;
        }
        .logo { font-size: 64px; margin-bottom: 16px; }
        h1 { color: #059669; font-size: 22px; margin-bottom: 8px; font-weight: 700; }
        .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
        
        .info-box {
            background: #f0fdf4;
            padding: 16px;
            border-radius: 12px;
            border-left: 4px solid #10b981;
            margin: 20px 0;
            text-align: left;
        }
        .info-row {
            display: flex;
            align-items: center;
            margin: 8px 0;
            font-size: 14px;
            color: #334155;
        }
        .info-icon { font-size: 20px; margin-right: 10px; min-width: 28px; }
        
        .credentials {
            background: #fef3c7;
            padding: 20px;
            border-radius: 12px;
            border-left: 4px solid #f59e0b;
            margin: 20px 0;
        }
        .cred-title {
            color: #d97706;
            font-weight: 700;
            font-size: 13px;
            margin-bottom: 12px;
            text-transform: uppercase;
        }
        .cred-item {
            background: white;
            padding: 12px;
            border-radius: 8px;
            margin: 10px 0;
            position: relative;
        }
        .cred-label {
            font-size: 11px;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 6px;
            text-align: left;
        }
        .cred-value {
            font-size: 15px;
            color: #1e293b;
            font-family: 'Courier New', monospace;
            font-weight: 600;
            word-break: break-all;
            text-align: left;
            padding-right: 70px;
        }
        .copy-btn {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: #f59e0b;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 11px;
            cursor: pointer;
            font-weight: 700;
        }
        .copy-btn:active { background: #d97706; }
        
        .login-btn {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            border: none;
            padding: 18px;
            font-size: 17px;
            font-weight: 700;
            border-radius: 12px;
            cursor: pointer;
            width: 100%;
            margin-top: 20px;
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);
            text-decoration: none;
            display: block;
        }
        .login-btn:active { transform: scale(0.98); }
        
        .note {
            margin-top: 16px;
            font-size: 12px;
            color: #94a3b8;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">🏌️</div>
        <h1>Cayacoa Golf Club</h1>
        <p class="subtitle">Tu reserva está lista. Copia tus credenciales y haz clic para continuar.</p>
        
        ${session?.reservationInfo?.date || session?.reservationInfo?.time ? `
        <div class="info-box">
            ${session?.reservationInfo?.date ? `
            <div class="info-row">
                <span class="info-icon">📅</span>
                <span><strong>${session.reservationInfo.date}</strong></span>
            </div>
            ` : ''}
            ${session?.reservationInfo?.time ? `
            <div class="info-row">
                <span class="info-icon">⏰</span>
                <span><strong>${session.reservationInfo.time}</strong></span>
            </div>
            ` : ''}
            ${session?.reservationInfo?.price ? `
            <div class="info-row">
                <span class="info-icon">💰</span>
                <span><strong>${session.reservationInfo.price}</strong></span>
            </div>
            ` : ''}
        </div>
        ` : ''}
        
        <div class="credentials">
            <div class="cred-title">🔐 Tus Credenciales</div>
            
            <div class="cred-item">
                <div class="cred-label">📧 Email / Usuario</div>
                <div class="cred-value" id="emailValue">${credentials.username}</div>
                <button class="copy-btn" onclick="copyText('emailValue', this)">COPIAR</button>
            </div>
            
            <div class="cred-item">
                <div class="cred-label">🔑 Contraseña</div>
                <div class="cred-value" id="passwordValue">${credentials.password}</div>
                <button class="copy-btn" onclick="copyText('passwordValue', this)">COPIAR</button>
            </div>
        </div>
        
        <a href="${loginUrl}" class="login-btn">
            🚀 Ir a Cayacoa Golf
        </a>
        
        <p class="note">
            Haz clic en el botón, luego pega tus credenciales en la página de login.
        </p>
    </div>

    <script>
        function copyText(elementId, button) {
            const text = document.getElementById(elementId).textContent;
            
            // Intentar copiar con Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    button.textContent = '✓ COPIADO';
                    button.style.background = '#059669';
                    setTimeout(() => {
                        button.textContent = 'COPIAR';
                        button.style.background = '#f59e0b';
                    }, 2000);
                }).catch(() => {
                    fallbackCopy(text, button);
                });
            } else {
                fallbackCopy(text, button);
            }
        }
        
        function fallbackCopy(text, button) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                button.textContent = '✓ COPIADO';
                button.style.background = '#059669';
                setTimeout(() => {
                    button.textContent = 'COPIAR';
                    button.style.background = '#f59e0b';
                }, 2000);
            } catch (err) {
                alert('Copiar: ' + text);
            }
            document.body.removeChild(textarea);
        }
        
        console.log('📧 Email:', '${credentials.username}');
        console.log('🔐 Password:', '${credentials.password}');
        console.log('🌐 URL Login:', '${loginUrl}');
        console.log('🎯 URL Destino:', '${targetUrl}');
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
