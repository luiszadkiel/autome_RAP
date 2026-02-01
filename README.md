# 🤖 Sistema de Automatización Web con IA

## Arquitectura Clean + Domain-Driven Design

Sistema que combina automatización web, extracción de información, generación de respuestas con OpenAI y **persistencia de flujos web reproducibles**.

---

## 🚀 Instalación

```bash
cd web-automation-standalone

# Instalar dependencias
npm install

# Copiar configuración
cp .env.example .env

# Editar .env y agregar tu OPENAI_API_KEY
notepad .env
```

## ⚙️ Configuración

Edita el archivo `.env`:

```bash
# REQUERIDO
OPENAI_API_KEY=sk-...

# Opcional
OPENAI_MODEL=gpt-4o
HEADLESS=true
```

---

## 📖 Comandos

### 1. Agente IA (ejecución inteligente)

```bash
# Básico
npm run agent -- --url "https://example.com" --message "Busca precios"

# Con login
npm run agent -- \
  --url "https://app.example.com/login" \
  --message "Inicia sesión y descarga reporte" \
  --email "user@mail.com" \
  --password "pass123"

# Con grabación de flujo
npm run agent -- \
  --url "https://example.com" \
  --message "Completa el registro" \
  --record "registro_flow"
```

### 2. Ejecutar flujo guardado

```bash
# Por nombre
npm run execute -- --name "registro_flow" --var username=john --var password=secret

# Por ID
npm run execute -- --id flow_123456 --no-headless
```

### 3. Reproducir con validación

```bash
# Con validación de snapshots
npm run replay -- --name "login_flow" --var password=secret123

# Sin validación (más rápido)
npm run replay -- --id flow_123 --no-validate
```

### 4. Listar flujos

```bash
npm run list
```

### 5. Servidor REST API

```bash
npm run server -- --port 3000
```

**Endpoints disponibles:**

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/flows` | Listar todos los flujos |
| GET | `/api/flows/:id` | Obtener flujo por ID |
| POST | `/api/flows/execute` | Ejecutar un flujo |
| POST | `/api/flows/replay` | Reproducir con validación |
| DELETE | `/api/flows/:id` | Eliminar un flujo |

---

## 📂 Estructura del Proyecto

```
src/
├── domain/                        # 🎯 NÚCLEO - Lógica de negocio pura
│   ├── entities/                  # Entidades del dominio
│   │   ├── WebFlow.ts             # Flujo de automatización web
│   │   ├── FlowStep.ts            # Paso individual de un flujo
│   │   └── HtmlSnapshot.ts        # Captura HTML de un paso
│   │
│   ├── value-objects/             # Objetos de valor inmutables
│   │   ├── StepAction.ts          # click, type, navigate, wait...
│   │   └── FlowStatus.ts          # draft, ready, running, completed
│   │
│   ├── repositories/              # Interfaces de repositorios (contratos)
│   │   └── index.ts               # IWebFlowRepository, ISnapshotRepository
│   │
│   ├── services/                  # Servicios de dominio
│   │   └── FlowExecutionService.ts
│   │
│   └── events/                    # Eventos de dominio
│       └── index.ts               # FlowExecutedEvent, StepCompletedEvent
│
├── application/                   # 📦 CASOS DE USO
│   └── use-cases/
│       └── flow-management/
│           ├── RecordFlowUseCase.ts      # Grabar nuevo flujo
│           ├── ExecuteFlowUseCase.ts     # Ejecutar flujo
│           └── ReplayFlowUseCase.ts      # Reproducir con validación
│
├── infrastructure/                # 🔧 IMPLEMENTACIONES CONCRETAS
│   ├── browser/
│   │   └── PlaywrightBrowserAdapter.ts
│   │
│   └── persistence/
│       └── sqlite/
│           ├── SqliteWebFlowRepository.ts
│           └── SqliteSnapshotRepository.ts
│
├── interfaces/                    # 🌐 PUNTOS DE ENTRADA
│   └── http/
│       └── server.ts              # API REST con Hono
│
├── agent/                         # 🤖 AGENTE IA (OpenAI)
│   ├── web-agent.ts               # Agente principal
│   ├── openai-client.ts           # Cliente OpenAI
│   ├── action-executor.ts         # Ejecutor de acciones
│   └── prompts.ts                 # System prompts
│
├── browser/                       # Control de navegador simple
│   └── browser-client.ts
│
├── recorder/                      # Grabación simple (JSON)
│   ├── flow-recorder.ts
│   └── flow-player.ts
│
├── core/                          # Tipos y configuración
│   ├── types.ts
│   └── config.ts
│
├── index.ts                       # CLI original (simple)
└── main.ts                        # CLI nuevo (Clean Architecture)
```

---

## 🎯 Conceptos Clave

### 1. **WebFlow** (Flujo Web)

Un flujo es una secuencia de pasos que se pueden grabar y reproducir:

```typescript
// Ejemplo de flujo guardado
{
  "id": "login-github",
  "name": "Login en GitHub",
  "steps": [
    {
      "action": "navigate",
      "url": "https://github.com/login",
      "snapshotId": "snap_001"
    },
    {
      "action": "type",
      "selector": "input[name='login']",
      "value": "{{username}}",
      "snapshotId": "snap_002"
    },
    {
      "action": "click",
      "selector": "input[type='submit']",
      "waitFor": "navigation",
      "snapshotId": "snap_003"
    }
  ],
  "variables": ["username", "password"],
  "createdAt": "2026-01-30T19:00:00Z"
}
```

### 2. **Variables** (Plantillas)

Usa `{{variable}}` para parametrizar tus flujos:

```bash
# Grabar flujo con variables
npm run agent -- \
  --url "https://example.com/login" \
  --message "Ingresa {{username}} en el campo usuario y {{password}} en contraseña"

# Ejecutar con valores reales
npm run execute -- --name "login_flow" \
  --var username=john \
  --var password=secret123
```

### 3. **HtmlSnapshot** (Validación)

Cada paso guarda el estado de la página para validar durante el replay:

```
┌─────────────────┐     ┌──────────────────┐
│ Estado Actual   │────▶│ Comparar con     │
│ de la Página    │     │ Snapshot Guardado│
└─────────────────┘     └────────┬─────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
              ✅ Match                   ❌ Mismatch
              Ejecutar paso              Notificar cambio
```

---

## 🔧 API Programática

```typescript
import { WebAgent } from './src/agent/web-agent.js';

const agent = new WebAgent({
  openaiApiKey: 'sk-...',
  headless: true,
  recordFlow: true,
});

const result = await agent.run({
  url: 'https://example.com/login',
  instruction: 'Inicia sesión y descarga el reporte',
  credentials: {
    email: 'user@example.com',
    password: 'password123',
  },
  flowName: 'download_report',
});

console.log(result.success);  // true/false
console.log(result.summary);  // "Descargué el reporte..."
console.log(result.data);     // Datos extraídos
```

---

## 📦 Dependencias

```json
{
  "dependencies": {
    "playwright": "^1.50.0",
    "openai": "^4.x",
    "hono": "^4.x",
    "@hono/node-server": "^1.x",
    "better-sqlite3": "^11.x",
    "zod": "^3.x",
    "commander": "^12.x",
    "dotenv": "^16.x",
    "chalk": "^5.x"
  }
}
```

---

## 💰 Costos de OpenAI

| Tarea | Costo aproximado |
|-------|------------------|
| Simple (5-10 pasos) | $0.01 - $0.05 |
| Compleja (20+ pasos) | $0.10 - $0.20 |

**Recomendación:** Usa `gpt-4o-mini` para reducir costos.

---

## 🐛 Solución de Problemas

### "OPENAI_API_KEY not set"
Asegúrate de que tu `.env` tenga la API key correcta.

### "Element not found"
El selector puede haber cambiado. Usa `--no-headless` para depurar visualmente.

### "Snapshot mismatch"
La página cambió desde que grabaste el flujo. Regrabarlo o actualizar manualmente.

---

## 📝 Licencia

MIT
