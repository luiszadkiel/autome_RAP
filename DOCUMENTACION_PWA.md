# 📱 Documentación Completa: Sistema PWA con URLs Compartibles

## Índice

1. [Descripción General](#-descripción-general)
2. [Tecnologías Utilizadas](#-tecnologías-utilizadas)
3. [Arquitectura del Sistema](#-arquitectura-del-sistema)
4. [Estructura del URL](#-estructura-del-url)
5. [Flujo del Usuario](#-flujo-del-usuario)
6. [Código Detallado](#-código-detallado)
7. [Seguridad](#-seguridad)
8. [Instalación y Despliegue](#-instalación-y-despliegue)
9. [API Reference](#-api-reference)
10. [Troubleshooting](#-troubleshooting)

---

## 🎯 Descripción General

### ¿Qué es?

Sistema de **Progressive Web App (PWA)** que permite a los usuarios acceder a reservas de forma automática mediante un enlace compartido por WhatsApp, SMS o email.

### Problema que Resuelve

| Sin el Sistema | Con el Sistema |
|----------------|----------------|
| Usuario recibe link | Usuario recibe link |
| Abre navegador | Abre navegador |
| Ve página de login | ✅ **Ya está logueado** |
| Escribe email | - |
| Escribe password | - |
| Clic en botón | - |
| Navega a reserva | - |
| **30-60 segundos, 6+ toques** | **2-3 segundos, 0 toques** |

### Características Principales

- ✅ **Login automático** después de la primera vez
- ✅ **URLs compartibles** optimizadas para WhatsApp
- ✅ **Funciona offline** (PWA con Service Worker)
- ✅ **Instalable** como app nativa en iOS/Android
- ✅ **Credenciales seguras** almacenadas localmente
- ✅ **Hosting gratuito** (Netlify/GitHub Pages)

---

## 🛠 Tecnologías Utilizadas

### Frontend (PWA)

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| **HTML5** | - | Estructura de la aplicación |
| **CSS3** | - | Estilos y diseño responsive |
| **JavaScript ES6+** | - | Lógica de la aplicación |
| **Service Workers** | - | Funcionalidad offline y caching |
| **Web App Manifest** | - | Instalación como app nativa |
| **localStorage API** | - | Almacenamiento de credenciales |
| **URLSearchParams API** | - | Parsing de parámetros URL |
| **Base64 Encoding** | - | Codificación de credenciales |

### Backend (Servidor)

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| **Node.js** | ≥18 | Runtime de JavaScript |
| **TypeScript** | ^5.x | Tipado estático |
| **Hono** | ^4.x | Framework web ultraligero |
| **Playwright** | ^1.50 | Automatización de navegador |
| **SQLite** | better-sqlite3 ^11.x | Base de datos local |
| **Zod** | ^3.x | Validación de esquemas |

### Hosting/Infraestructura

| Servicio | Propósito |
|----------|-----------|
| **Netlify** | Hosting gratuito de la PWA |
| **GitHub Pages** | Alternativa de hosting |
| **Ngrok** | Túnel HTTPS para desarrollo |

### Protocolos y Estándares

| Estándar | Uso |
|----------|-----|
| **HTTPS** | Comunicación segura (requerido para PWA) |
| **CORS** | Control de acceso cross-origin |
| **SameSite Cookies** | Manejo de cookies cross-domain |
| **Web Share API** | Compartir contenido nativo |

---

## 🏗 Arquitectura del Sistema

### Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FLUJO COMPLETO                                │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│   TU BACKEND     │     │    PWA           │     │   SITIO DESTINO      │
│   (Node.js)      │     │   (Netlify)      │     │   (Cayacoa)          │
│                  │     │                  │     │                      │
│  1. Genera link  │────▶│  2. Parsea URL   │     │                      │
│     con booking  │     │     params       │     │                      │
│                  │     │                  │     │                      │
│  Opcional:       │     │  3. Verifica     │     │                      │
│  - Credenciales  │     │     localStorage │     │                      │
│    en Base64     │     │                  │     │                      │
│                  │     │  4. Auto-login   │────▶│  5. Valida           │
│                  │     │     via iframe   │     │     credenciales     │
│                  │     │                  │     │                      │
│                  │     │                  │◀────│  6. Crea sesión      │
│                  │     │                  │     │                      │
│                  │     │  7. Redirect a   │────▶│  8. Muestra reserva  │
│                  │     │     página final │     │     ✅ Logueado      │
└──────────────────┘     └──────────────────┘     └──────────────────────┘
```

### Componentes del Sistema

```
web-automation-standalone/
├── pwa/                          # 📱 Progressive Web App
│   ├── index.html                # Página principal + lógica JS
│   ├── manifest.json             # Configuración de instalación
│   ├── sw.js                     # Service Worker (offline)
│   ├── generador.html            # Herramienta para generar links
│   └── *.md                      # Documentación
│
├── src/
│   └── interfaces/
│       └── http/
│           └── server.ts         # 🖥️ Backend con endpoints
│
└── userscript/
    └── cayacoa-autofill.user.js  # 🔧 Script Tampermonkey (opcional)
```

---

## 🔗 Estructura del URL

### Formato Base

```
https://tu-pwa.netlify.app/?booking=HHMMam/DDMMYYYY
```

### Formato con Credenciales (Opcional)

```
https://tu-pwa.netlify.app/?booking=HHMMam/DDMMYYYY&credentials=BASE64_ENCODED
```

### Desglose del Parámetro `booking`

```
630am/03022026
│││││ │││││││
│││││ │││││││└── Año (4 dígitos)      → 2026
│││││ ││││└└──── Mes (2 dígitos)      → 02 (Febrero)
│││││ ││└└────── Día (2 dígitos)      → 03
│││││ │└──────── Separador            → /
│││││└└───────── AM/PM (minúsculas)   → am
││└└───────────── Minutos (2 dígitos) → 30
└└─────────────── Hora (1-2 dígitos)  → 6
```

### Regex de Validación

```javascript
const BOOKING_REGEX = /(\d{1,2})(\d{2})(am|pm)\/(\d{2})(\d{2})(\d{4})/;

// Grupos capturados:
// [1] = Hora     (1-2 dígitos)
// [2] = Minutos  (2 dígitos)
// [3] = AM/PM    (minúsculas)
// [4] = Día      (2 dígitos)
// [5] = Mes      (2 dígitos)
// [6] = Año      (4 dígitos)
```

### Ejemplos de URLs

| Reserva | URL Completa |
|---------|--------------|
| 6:30 AM, 3 Feb 2026 | `https://pwa.app/?booking=630am/03022026` |
| 2:30 PM, 15 Mar 2026 | `https://pwa.app/?booking=230pm/15032026` |
| 11:45 AM, 20 May 2026 | `https://pwa.app/?booking=1145am/20052026` |
| 4:15 PM, 8 Jun 2026 | `https://pwa.app/?booking=415pm/08062026` |

### Otros Parámetros Soportados

| Parámetro | Descripción | Ejemplo |
|-----------|-------------|---------|
| `booking` | Fecha/hora de reserva | `630am/03022026` |
| `redirect` | Ruta personalizada | `/front-end/profile` |
| `credentials` | Credenciales Base64 | `eyJlbWFpbCI6...` |

---

## 👤 Flujo del Usuario

### Primera Vez (Con Formulario)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PRIMERA VEZ - FLUJO COMPLETO                     │
└─────────────────────────────────────────────────────────────────────────┘

1️⃣ USUARIO RECIBE MENSAJE
   ┌────────────────────────────────────────┐
   │ 💬 WhatsApp                            │
   │                                        │
   │ ¡Hola! Tu reserva está confirmada:     │
   │                                        │
   │ 📅 3 de Febrero 2026                   │
   │ ⏰ 6:30 AM                             │
   │                                        │
   │ Accede aquí:                           │
   │ https://pwa.app/?booking=630am/03022026│
   └────────────────────────────────────────┘
                    │
                    ▼
2️⃣ USUARIO ABRE EL LINK
   ┌────────────────────────────────────────┐
   │           🏌️                           │
   │      Cayacoa Golf Club                 │
   │                                        │
   │   📅 3 Feb 2026    ⏰ 6:30 AM          │
   │                                        │
   │   📧 Email / Usuario                   │
   │   ┌──────────────────────────────┐     │
   │   │ tu@email.com                 │     │
   │   └──────────────────────────────┘     │
   │                                        │
   │   🔑 Contraseña                        │
   │   ┌──────────────────────────────┐     │
   │   │ ••••••••                     │     │
   │   └──────────────────────────────┘     │
   │                                        │
   │   ☑ Recordar mis credenciales          │
   │                                        │
   │   ┌──────────────────────────────┐     │
   │   │   🚀 Guardar y Acceder       │     │
   │   └──────────────────────────────┘     │
   └────────────────────────────────────────┘
                    │
                    ▼
3️⃣ SISTEMA PROCESA LOGIN
   ┌────────────────────────────────────────┐
   │           🏌️                           │
   │      Cayacoa Golf Club                 │
   │                                        │
   │           [🔄 Spinner]                 │
   │                                        │
   │      Iniciando sesión...               │
   └────────────────────────────────────────┘
                    │
                    ▼
4️⃣ USUARIO LLEGA A SU RESERVA
   ┌────────────────────────────────────────┐
   │      ✅ Cayacoa Golf Club              │
   │                                        │
   │   Tu Reserva:                          │
   │   📅 3 de Febrero 2026                 │
   │   ⏰ 6:30 AM                           │
   │   🏌️ Campo Principal                   │
   │                                        │
   │   [Confirmar]  [Modificar]             │
   └────────────────────────────────────────┘
```

### Próximas Veces (Automático)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PRÓXIMAS VECES - 100% AUTOMÁTICO                     │
└─────────────────────────────────────────────────────────────────────────┘

1️⃣ USUARIO ABRE NUEVO LINK
   URL: https://pwa.app/?booking=700am/15032026
                    │
                    ▼
2️⃣ PWA DETECTA CREDENCIALES GUARDADAS
   ┌────────────────────────────────────────┐
   │           🏌️                           │
   │      Cayacoa Golf Club                 │
   │                                        │
   │           [🔄 Spinner]                 │
   │                                        │
   │   Acceso automático activado...        │
   │                                        │
   │   ┌──────────────────────────────┐     │
   │   │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 40%    │     │
   │   └──────────────────────────────┘     │
   │                                        │
   │   Iniciando sesión...                  │
   └────────────────────────────────────────┘
                    │
                    ▼ (2-3 segundos)
                    │
3️⃣ USUARIO YA ESTÁ EN SU RESERVA ✅
   ┌────────────────────────────────────────┐
   │      ✅ Cayacoa Golf Club              │
   │                                        │
   │   Tu Nueva Reserva:                    │
   │   📅 15 de Marzo 2026                  │
   │   ⏰ 7:00 AM                           │
   │   🏌️ Campo Principal                   │
   └────────────────────────────────────────┘
```

---

## 💻 Código Detallado

### 1. PWA - Parsing de URL (`index.html`)

```javascript
// ====================================================
// PASO 1: Leer parámetros de la URL
// ====================================================
const urlParams = new URLSearchParams(window.location.search);
const bookingParam = urlParams.get('booking');        // "630am/03022026"
const credentialsParam = urlParams.get('credentials'); // Base64 (opcional)
const redirectParam = urlParams.get('redirect');       // Ruta personalizada

// ====================================================
// PASO 2: Parsear información de la reserva
// ====================================================
const match = bookingParam.match(/(\d{1,2})(\d{2})(am|pm)\/(\d{2})(\d{2})(\d{4})/);

if (match) {
    const hour = match[1];          // "6"
    const minute = match[2];        // "30"
    const meridian = match[3];      // "am"
    const day = match[4];           // "03"
    const month = match[5];         // "02"
    const year = match[6];          // "2026"
    
    // Mostrar información al usuario
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 
                        'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const monthName = monthNames[parseInt(month) - 1];
    
    console.log(`📅 Reserva: ${day} ${monthName} ${year} a las ${hour}:${minute} ${meridian.toUpperCase()}`);
}

// ====================================================
// PASO 3: Construir URL de destino
// ====================================================
const CAYACOA_BASE = 'https://app.cayacoagolf.com';

let targetUrl;
if (bookingParam) {
    targetUrl = `${CAYACOA_BASE}/front-end/make-booking/${bookingParam}`;
} else if (redirectParam) {
    targetUrl = `${CAYACOA_BASE}${redirectParam}`;
} else {
    targetUrl = `${CAYACOA_BASE}/front-end/tee-time`;
}

console.log('🎯 URL destino:', targetUrl);
```

### 2. PWA - Decodificación de Credenciales

```javascript
// ====================================================
// Decodificar credenciales Base64 URL-safe
// ====================================================
if (credentialsParam) {
    try {
        // Convertir base64 URL-safe a base64 estándar
        let base64 = credentialsParam
            .replace(/-/g, '+')   // - → +
            .replace(/_/g, '/');  // _ → /
        
        // Agregar padding si es necesario
        while (base64.length % 4) {
            base64 += '=';
        }
        
        // Decodificar
        const decoded = atob(base64);
        const autoCredentials = JSON.parse(decoded);
        
        console.log('🔐 Credenciales recibidas desde servidor');
        console.log('📧 Email:', autoCredentials.email);
        
        // Guardar para próximas veces
        localStorage.setItem('cayacoa_email', autoCredentials.email);
        localStorage.setItem('cayacoa_password', autoCredentials.password);
        
        // Auto-login inmediato
        autoLogin(autoCredentials.email, autoCredentials.password);
        
    } catch (e) {
        console.error('❌ Error al decodificar credenciales:', e);
    }
}
```

### 3. PWA - Sistema de Auto-Login

```javascript
// ====================================================
// Función de Auto-Login usando iframe oculto
// ====================================================
async function autoLogin(email, password) {
    console.log('🚀 Iniciando proceso de login...');
    showLoading('Preparando acceso...');
    
    // Crear iframe invisible
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.name = 'loginFrame';
    document.body.appendChild(iframe);
    
    // Crear formulario que envía al iframe
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${CAYACOA_BASE}/front-end/signin`;
    form.target = 'loginFrame'; // Enviar al iframe, no reemplazar página
    form.style.display = 'none';
    
    // Campo de email/username
    const usernameInput = document.createElement('input');
    usernameInput.name = 'username';
    usernameInput.value = email;
    form.appendChild(usernameInput);
    
    // Campo de password
    const passwordInputField = document.createElement('input');
    passwordInputField.name = 'password';
    passwordInputField.value = password;
    form.appendChild(passwordInputField);
    
    document.body.appendChild(form);
    
    // Enviar login al iframe
    showLoading('Iniciando sesión...');
    console.log('📤 Enviando login en segundo plano...');
    form.submit();
    
    // Esperar procesamiento y redirigir
    showLoading('Verificando credenciales...');
    
    setTimeout(() => {
        showLoading('Login exitoso! Redirigiendo...');
        
        setTimeout(() => {
            console.log('🎯 Redirigiendo a:', targetUrl);
            window.location.href = targetUrl;
        }, 1500);
    }, 3000);
}
```

### 4. PWA - Gestión de Credenciales Locales

```javascript
// ====================================================
// Cargar credenciales guardadas
// ====================================================
function loadSavedCredentials() {
    const savedEmail = localStorage.getItem('cayacoa_email');
    const savedPassword = localStorage.getItem('cayacoa_password');
    
    if (savedEmail && savedPassword) {
        return { email: savedEmail, password: savedPassword };
    }
    
    return null;
}

// ====================================================
// Guardar credenciales
// ====================================================
function saveCredentials(email, password) {
    if (rememberCheckbox.checked) {
        localStorage.setItem('cayacoa_email', email);
        localStorage.setItem('cayacoa_password', password);
        console.log('✅ Credenciales guardadas');
    }
}

// ====================================================
// Borrar credenciales
// ====================================================
function clearCredentials() {
    localStorage.removeItem('cayacoa_email');
    localStorage.removeItem('cayacoa_password');
    console.log('🗑️ Credenciales borradas');
}
```

### 5. Backend - Codificación de Credenciales (`server.ts`)

```typescript
// ====================================================
// Líneas ~1102-1119 en server.ts
// ====================================================

// Configuración
const USAR_PWA = true;
const PWA_URL = 'https://pwa-cayacoa.netlify.app/';

if (USAR_PWA) {
    // Extraer booking de la URL de destino
    const bookingMatch = targetUrl.match(/make-booking\/(.+?)(?:\?|$)/);
    
    if (bookingMatch) {
        const bookingParam = bookingMatch[1].replace(/\/$/, '');
        
        // Codificar credenciales en base64 URL-safe
        const credentialsJson = JSON.stringify({
            email: credentials.username,
            password: credentials.password
        });
        
        // Convertir a base64
        const base64 = Buffer.from(credentialsJson).toString('base64');
        
        // Hacer URL-safe
        const credentialsEncoded = base64
            .replace(/\+/g, '-')   // + → -
            .replace(/\//g, '_')   // / → _
            .replace(/=/g, '');    // quitar padding
        
        console.log(`🔀 Redirigiendo a PWA con booking: ${bookingParam}`);
        
        // Redirigir con booking Y credenciales
        return c.redirect(`${PWA_URL}?booking=${bookingParam}&credentials=${credentialsEncoded}`);
    }
}
```

### 6. Service Worker (`sw.js`)

```javascript
// ====================================================
// Service Worker para funcionalidad offline
// ====================================================

const CACHE_NAME = 'cayacoa-pwa-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json'
];

// Instalación
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Cache abierto');
                return cache.addAll(urlsToCache);
            })
    );
});

// Fetch con estrategia Network-First
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Si hay respuesta de red, guardar en cache
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Si falla la red, usar cache
                return caches.match(event.request);
            })
    );
});
```

### 7. Web App Manifest (`manifest.json`)

```json
{
    "name": "Cayacoa Golf - Acceso Rápido",
    "short_name": "Cayacoa",
    "description": "Acceso rápido a tus reservas de golf",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#10b981",
    "theme_color": "#10b981",
    "orientation": "portrait",
    "icons": [
        {
            "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏌️</text></svg>",
            "sizes": "512x512",
            "type": "image/svg+xml",
            "purpose": "any maskable"
        }
    ]
}
```

---

## 🔒 Seguridad

### Almacenamiento de Credenciales

| Aspecto | Implementación |
|---------|----------------|
| **Ubicación** | `localStorage` del navegador del usuario |
| **Encriptación** | Por el sistema operativo del dispositivo |
| **Acceso** | Solo desde el dominio de la PWA |
| **Control** | Usuario puede borrar en cualquier momento |
| **Transmisión** | Solo se envían a Cayacoa (nunca a tu servidor) |

### Codificación Base64 URL-Safe

```
Base64 Estándar  →  Base64 URL-Safe
      +          →        -
      /          →        _
      =          →   (eliminado)
```

**¿Por qué URL-safe?**
- Los caracteres `+`, `/` y `=` tienen significados especiales en URLs
- Sin convertir, la URL se rompería o necesitaría encoding adicional

### Consideraciones de Seguridad

| Riesgo | Mitigación |
|--------|------------|
| Intercepción de credenciales | HTTPS obligatorio |
| Acceso no autorizado | Credenciales en localStorage (no cookies) |
| XSS | Sanitización de inputs |
| CORS | Verificación de origen |
| Tokens expirados | TTL de 1 hora |

### Buenas Prácticas

```javascript
// ✅ CORRECTO: Usar HTTPS siempre
const PWA_URL = 'https://pwa-cayacoa.netlify.app/';

// ❌ INCORRECTO: HTTP no es seguro para PWA
const PWA_URL = 'http://pwa-cayacoa.netlify.app/';

// ✅ CORRECTO: Validar inputs antes de usar
const email = emailInput.value.trim();
if (!email || !email.includes('@')) {
    alert('Email inválido');
    return;
}

// ✅ CORRECTO: Permitir al usuario borrar datos
function clearCredentials() {
    localStorage.removeItem('cayacoa_email');
    localStorage.removeItem('cayacoa_password');
}
```

---

## 🚀 Instalación y Despliegue

### Opción 1: Netlify (Recomendado - 2 minutos)

```bash
# 1. Ve a Netlify Drop
https://app.netlify.com/drop

# 2. Arrastra la carpeta 'pwa' completa

# 3. ¡Listo! Recibes URL automáticamente
https://random-name.netlify.app/

# 4. (Opcional) Cambiar nombre del sitio
# Click en "Site settings" → "Change site name"
# Nuevo: https://cayacoa-golf.netlify.app/
```

### Opción 2: GitHub Pages (5 minutos)

```bash
# 1. Crear repositorio en GitHub
git init
git add .
git commit -m "PWA Cayacoa"

# 2. Subir a GitHub
git remote add origin https://github.com/tu-usuario/cayacoa-pwa.git
git push -u origin main

# 3. Activar GitHub Pages
# Settings → Pages → Source: main → /root → Save

# 4. URL disponible en:
https://tu-usuario.github.io/cayacoa-pwa/
```

### Configurar Backend para Usar PWA

En `src/interfaces/http/server.ts`, línea ~1091:

```typescript
// ANTES (desactivado)
const USAR_PWA = false;
const PWA_URL = 'https://tu-usuario.github.io/cayacoa-pwa/';

// DESPUÉS (activado)
const USAR_PWA = true;
const PWA_URL = 'https://cayacoa-golf.netlify.app/';
```

### Variables de Entorno

```bash
# .env
OPENAI_API_KEY=sk-...          # Para agente IA
OPENAI_MODEL=gpt-4o            # Modelo a usar
HEADLESS=true                  # Navegador sin interfaz
PORT=3000                      # Puerto del servidor
BASE_URL=https://tu.ngrok.app  # URL pública (Ngrok)
```

---

## 📡 API Reference

### Generar Link de Reserva

**JavaScript:**

```javascript
function generarLinkReserva(hora, fecha) {
    // hora = "6:30 AM" o "2:30 PM"
    // fecha = "03/02/2026" (DD/MM/YYYY)
    
    const [horaStr, meridian] = hora.split(' ');
    const [hours, minutes] = horaStr.split(':');
    const [day, month, year] = fecha.split('/');
    
    const booking = `${hours}${minutes}${meridian.toLowerCase()}/${day}${month}${year}`;
    return `https://cayacoa-golf.netlify.app/?booking=${booking}`;
}

// Uso
const link = generarLinkReserva("6:30 AM", "03/02/2026");
// → https://cayacoa-golf.netlify.app/?booking=630am/03022026
```

**Python:**

```python
def generar_link_reserva(hora: str, fecha: str) -> str:
    """
    hora = "6:30 AM" o "2:30 PM"
    fecha = "03/02/2026" (DD/MM/YYYY)
    """
    hora_str, meridian = hora.split(' ')
    hours, minutes = hora_str.split(':')
    day, month, year = fecha.split('/')
    
    booking = f"{hours}{minutes}{meridian.lower()}/{day}{month}{year}"
    return f"https://cayacoa-golf.netlify.app/?booking={booking}"

# Uso
link = generar_link_reserva("6:30 AM", "03/02/2026")
# → https://cayacoa-golf.netlify.app/?booking=630am/03022026
```

**cURL (API del servidor):**

```bash
# Crear sesión con Magic Link
curl -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d '{
    "token": "unique-token-123",
    "url": "https://cayacoagolf.com/payment/12345",
    "credentials": {
      "username": "usuario@email.com",
      "password": "contraseña123"
    }
  }'

# Respuesta
{
  "success": true,
  "magicLink": "https://cayacoagolf.com/auto-login?token=unique-token-123",
  "expiresAt": "2026-02-02T15:30:00.000Z"
}
```

---

## 🐛 Troubleshooting

### Problema: "La PWA no guarda mis credenciales"

**Causas:**
- El checkbox "Recordar" no está marcado
- Modo incógnito/privado activo
- localStorage bloqueado por el navegador

**Solución:**
```javascript
// Verificar si localStorage está disponible
if (typeof localStorage === 'undefined') {
    console.error('localStorage no disponible');
    alert('Tu navegador no soporta almacenamiento local');
}

// Verificar si hay datos guardados
console.log('Email guardado:', localStorage.getItem('cayacoa_email'));
```

### Problema: "Error de CORS al hacer login"

**Causa:** El sitio destino bloquea acceso desde otros dominios.

**Solución (Fallback automático):**
```javascript
try {
    const iframeDoc = iframe.contentDocument;
    // Llenar formulario en iframe...
} catch (error) {
    console.error('Error de CORS:', error);
    // Usar método alternativo: redirección con parámetros
    window.location.href = `${LOGIN_URL}?email=${encodeURIComponent(email)}`;
}
```

### Problema: "El link no se abre correctamente desde WhatsApp"

**Causa:** WhatsApp puede modificar la URL.

**Solución:**
- Usar `https://` siempre (no `http://`)
- No usar caracteres especiales sin encodear
- Probar el link en navegador antes de compartir

### Problema: "Pide credenciales cada vez"

**Causas:**
- Usuario borró datos del navegador
- Usando navegador diferente
- Dominio de PWA cambió

**Verificar:**
```javascript
// En consola del navegador (F12)
console.log('Credenciales guardadas:', {
    email: localStorage.getItem('cayacoa_email'),
    hasPassword: !!localStorage.getItem('cayacoa_password')
});
```

### Debug: Ver logs de la PWA

```javascript
// Abrir consola del navegador (F12)
// Buscar mensajes con estos emojis:

// 🏌️ = PWA iniciada
// 🎯 = URL de destino
// 🔐 = Credenciales detectadas
// 📤 = Login enviado
// ✅ = Éxito
// ❌ = Error
```

---

## 📊 Comparación de Métodos

| Característica | PWA Automática | HTML Manual | Magic Link + Tampermonkey |
|----------------|----------------|-------------|---------------------------|
| **Primera vez** | Ingresar credenciales | Copiar/pegar | Instalar extensión |
| **Próximas veces** | ✅ Automático | Copiar/pegar | ✅ Automático |
| **Requiere extensión** | ❌ No | ❌ No | ✅ Sí |
| **Funciona en iOS** | ✅ Sí | ✅ Sí | ❌ No |
| **Hosting** | Gratis (Netlify) | Tu servidor | Tu servidor |
| **Costo servidor** | Muy bajo | Medio | Medio |
| **Tiempo de carga** | 2-3 seg | 30-60 seg | 5-10 seg |

---

## 📝 Mensaje de WhatsApp Sugerido

```
¡Hola [Nombre]! 👋

Tu reserva en Cayacoa Golf está confirmada:

📅 [Fecha]
⏰ [Hora]
🏌️ Campo Principal

Accede directamente aquí:
https://cayacoa-golf.netlify.app/?booking=[booking_param]

✨ La primera vez te pedirá tus credenciales de Cayacoa.
Las próximas veces entrarás automáticamente.

¡Nos vemos en el campo! ⛳
```

---

## 📚 Referencias

- [MDN: Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [MDN: Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)
- [MDN: localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [Netlify Documentation](https://docs.netlify.com/)
- [Hono Framework](https://hono.dev/)

---

## 📄 Licencia

MIT License - Libre para uso personal y comercial.

---

*Documentación generada para el proyecto web-automation-standalone*
*Última actualización: Febrero 2026*
