# Arquitectura: Manejo de Login y Proceso Continuo

## 📋 Resumen Ejecutivo

El sistema maneja el login como **un paso previo automático** que permite continuar con la acción principal del usuario. El login no es el objetivo final, sino un paso necesario para acceder al contenido protegido.

---

## 🏗️ Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                    POST /api/agent/parallel                  │
│  { instruction, targets: [{url, loginUrl?, credentials?}] } │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              ParallelAgent.run()                             │
│  • Crea Browser compartido                                  │
│  • Divide targets en chunks (maxParallel)                   │
│  • Ejecuta agentes en paralelo                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         ParallelAgent.runSingleAgent()                      │
│  • Crea contexto por agente (browser.newContext())          │
│  • Pasa: url, loginUrl, credentials, instruction           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              WebAgent.run()                                 │
│  FASE 1: Inicialización                                     │
│  ────────────────────────                                  │
│  1. Si hay loginUrl → navega a loginUrl                    │
│     Si no → navega a url                                    │
│  2. Warm-up: espera elementos (15 intentos)                 │
│  3. Selecciona adaptador de sitio                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         WebAgent.run() - Loop Principal                     │
│  ────────────────────────────────────────                   │
│  while (true) {                                             │
│    1. Snapshot de la página                                 │
│    2. OpenAI decide acciones (con prompt)                    │
│    3. BatchExecutor ejecuta acciones                        │
│    4. ActionVerifier verifica resultados                     │
│    5. Si "done" → termina                                   │
│  }                                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         BatchExecutor.executeBatch()                        │
│  • Ejecuta acciones secuencialmente                         │
│  • Para cada acción:                                        │
│    - Captura estado ANTES (PreActionState)                  │
│    - Ejecuta acción (type/click/scroll)                    │
│    - Espera inteligente (smartWait)                        │
│    - Verifica resultado (ActionVerifier)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         ActionVerifier.verifyAction()                       │
│  • Compara estado ANTES vs DESPUÉS                          │
│  • Detecta: cambios DOM, URL, errores, loading              │
│  • Calcula confianza (0-100)                                │
│  • Si es página de login → reglas permisivas               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Flujo de Login Detallado

### 1. **Configuración Inicial** (`ParallelAgent` → `WebAgent`)

```typescript
// En ParallelTarget
{
  url: "https://cayacoagolf.com/",           // URL principal
  loginUrl: "https://app.cayacoagolf.com/front-end/login",  // URL de login
  credentials: { email: "...", password: "..." },
  name: "cayacoagolf"
}
```

**Decisión**: Si `loginUrl` existe → navegar primero a `loginUrl`, si no → navegar a `url`.

### 2. **Navegación Inicial** (`WebAgent.run()`)

```typescript
// Línea 136-142
const initialUrl = params.loginUrl || config.url;
if (params.loginUrl) {
    console.log(`🌐 Navegando a página de login: ${params.loginUrl}...`);
} else {
    console.log(`🌐 Navegando a ${config.url}...`);
}
```

**Estrategias de navegación** (fallback):
1. `domcontentloaded` (20s)
2. `load` (25s)
3. `networkidle` (30s)
4. `commit` (15s)

### 3. **Loop Principal - El LLM Decide**

El **System Prompt** incluye la regla:

```
### LOGIN ES UN PASO PREVIO (MUY IMPORTANTE)
- Objetivo: Iniciar sesión y seguir con la acción que pidió el usuario
- Flujo: 1) Completa login → 2) Continúa con la tarea real
- No te quedes en login ni repitas
```

**Ejemplo de decisión del LLM**:
```json
{
  "thinking": "Estoy en página de login. Tengo credenciales. Debo completar login y luego buscar horarios de golf.",
  "actions": [
    {"action": "type", "ref": "e1", "value": "user@example.com"},
    {"action": "type", "ref": "e2", "value": "password123"},
    {"action": "click", "ref": "e3", "why": "Enviar formulario de login"}
  ]
}
```

### 4. **Ejecución y Verificación Permisiva** (`ActionVerifier`)

#### **Detección de Página de Login**

```typescript
// action-verifier.ts línea 312-315
private isLoginPage(url: string): boolean {
    const u = url.toLowerCase();
    return /\/login|\/signin|\/auth|\/iniciar-sesion|front-end\/login|consumer\/login/.test(u);
}
```

#### **Reglas Permisivas en Login**

**Para `type` (escribir email/contraseña)**:
```typescript
// Línea 360-367
if (!evidence.errorsDetected.length) {
    if (onLoginPage) {
        confidence += 25;  // ✅ Acepta como éxito
        reasons.push('Login: texto ingresado sin errores, continuar');
    } else {
        confidence += 10;  // Menos permisivo
    }
}
```

**Para `click` (botón Enviar/Acceder)**:
```typescript
// Línea 347-353
if (!evidence.domChanged && !evidence.urlChanged) {
    if (onLoginPage) {
        confidence -= 5;  // ✅ Penalización mínima
        reasons.push('Sin cambios visibles aún (login puede estar procesando)');
    } else {
        confidence -= 30;  // ❌ Penalización fuerte
        shouldRetry = true;
    }
}
```

**Para `loadingComplete`**:
```typescript
// Línea 427-433
if (!evidence.loadingComplete) {
    if (onLoginPage) {
        confidence -= 0;  // ✅ No penaliza
        reasons.push('Página de login puede seguir cargando (no bloqueante)');
    } else {
        confidence -= 15;  // ❌ Penaliza
    }
}
```

### 5. **Continuación Automática**

Después del login exitoso:

1. **El LLM detecta cambio de URL** o nueva página → continúa con la instrucción
2. **Ejemplo siguiente paso**:
   ```json
   {
     "thinking": "Login exitoso, ahora estoy en el dashboard. Debo buscar horarios de golf para mañana.",
     "actions": [
       {"action": "click", "ref": "e5", "why": "Ir a sección de reservas"},
       {"action": "click", "ref": "e8", "why": "Ver horarios disponibles"}
     ]
   }
   ```

---

## 🔄 Flujo Completo: Ejemplo Real

### Escenario: "dime los horarios disponibles para jugar golf mañana"

```
1. POST /api/agent/parallel
   {
     instruction: "dime los horarios disponibles para jugar golf mañana",
     targets: [{
       url: "https://cayacoagolf.com/",
       loginUrl: "https://app.cayacoagolf.com/front-end/login",
       credentials: { email: "...", password: "..." }
     }]
   }

2. ParallelAgent.run()
   └─> Crea Browser compartido
   └─> runSingleAgent() con contexto nuevo

3. WebAgent.run()
   └─> Navega a loginUrl (no a url)
   └─> Warm-up: espera elementos
   └─> Loop principal:

   Paso 1: Snapshot → LLM ve formulario login
   └─> Acciones: [type email, type password, click Enviar]
   └─> BatchExecutor ejecuta
   └─> ActionVerifier: ✅ Éxito (reglas permisivas login)
   
   Paso 2: Snapshot → LLM ve dashboard/home (URL cambió)
   └─> Acciones: [click "Reservas", click "Golf"]
   └─> BatchExecutor ejecuta
   └─> ActionVerifier: ✅ Éxito
   
   Paso 3: Snapshot → LLM ve calendario/horarios
   └─> Acciones: [click "Mañana", extractInfo horarios]
   └─> BatchExecutor ejecuta
   └─> ActionVerifier: ✅ Éxito
   
   Paso 4: LLM decide "done" → termina

4. Resultado:
   {
     status: "success",
     extractedInfo: [
       {type: "schedule", content: "Horario 8:00 AM - Disponible"},
       {type: "schedule", content: "Horario 10:00 AM - Disponible"}
     ]
   }
```

---

## 🎯 Componentes Clave

### 1. **ParallelAgent** (`parallel-agent.ts`)
- **Responsabilidad**: Orquestar múltiples agentes en paralelo
- **Gestión de recursos**: Browser compartido, contextos independientes
- **No maneja login directamente**: Solo pasa `loginUrl` y `credentials` a `WebAgent`

### 2. **WebAgent** (`web-agent.ts`)
- **Responsabilidad**: Ejecutar la tarea completa (login + acción)
- **Decisión de navegación**: `loginUrl` → login primero, luego continúa
- **Loop principal**: Snapshot → LLM → Ejecutar → Verificar → Repetir

### 3. **BatchExecutor** (`batch-executor.ts`)
- **Responsabilidad**: Ejecutar acciones secuencialmente
- **Captura estado**: Antes y después de cada acción
- **Espera inteligente**: `smartWait()` adapta esperas según tipo de acción

### 4. **ActionVerifier** (`action-verifier.ts`)
- **Responsabilidad**: Verificar si una acción tuvo éxito
- **Detección de login**: `isLoginPage(url)` identifica páginas de login
- **Reglas permisivas**: En login, acepta acciones aunque no haya cambios visibles inmediatos

### 5. **System Prompt** (`system-prompt.ts`)
- **Responsabilidad**: Guiar al LLM sobre cómo manejar login
- **Regla clave**: "LOGIN ES UN PASO PREVIO" → completa login y continúa

---

## 🔑 Puntos Clave de la Arquitectura

### ✅ **Ventajas**

1. **Login transparente**: El usuario solo especifica `loginUrl` y `credentials`, el sistema maneja el resto
2. **Continuación automática**: Después del login, el LLM automáticamente continúa con la tarea
3. **Verificación permisiva**: En login, no se bloquea por "página cargando" o "sin cambios visibles"
4. **Multi-sitio**: Cada target puede tener su propio `loginUrl` y `credentials`
5. **Paralelismo seguro**: Cada agente tiene su propio contexto, no interfiere con otros

### ⚠️ **Consideraciones**

1. **El LLM debe seguir el prompt**: Si no sigue "login es paso previo", puede quedarse atascado
2. **Detección de login por URL**: Si la URL de login no coincide con el patrón, no se aplican reglas permisivas
3. **Verificación post-login**: El sistema confía en cambio de URL o nuevos elementos para detectar login exitoso
4. **No hay timeout específico de login**: Usa el mismo `maxSteps` que la tarea completa

---

## 📝 Resumen

**Arquitectura de Login = Navegación inicial + Verificación permisiva + Continuación automática**

1. **Navegación**: Si hay `loginUrl` → va ahí primero
2. **Ejecución**: LLM completa login (type + click) guiado por el prompt
3. **Verificación**: ActionVerifier es permisivo en páginas de login
4. **Continuación**: LLM detecta éxito y continúa con la acción real
5. **Resultado**: Información extraída de la tarea completa (no solo login)

El login es **invisible para el usuario final** - solo especifica credenciales y el sistema maneja todo el flujo automáticamente.
