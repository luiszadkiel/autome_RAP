# 🔗 Sistema de Magic Link - Auto-Login para Cayacoa Golf

## 📋 ¿Qué es un Magic Link?

Un **Magic Link** es un enlace compartible que permite a los usuarios acceder directamente a una página específica de Cayacoa Golf (como una página de pago) sin tener que ingresar sus credenciales manualmente. El sistema hace login automático en el navegador del usuario.

## 🎯 Flujo del Sistema

```
1. Usuario autenticado en Cayacoa
   ↓
2. Tu App genera un Magic Link con token único
   ↓
3. Usuario recibe el link: https://cayacoagolf.com/auto-login?token=abc123
   ↓
4. Usuario hace clic en el link
   ↓
5. Userscript de Tampermonkey detecta el token
   ↓
6. Userscript consulta tu servidor para obtener credenciales
   ↓
7. Login automático en Cayacoa
   ↓
8. Redirección a la página de pago/destino
```

## 🔧 Configuración

### 1. Variables de Entorno

Configura estas variables en tu archivo `.env`:

```bash
# URL base de tu servidor (usar tu dominio de Ngrok para producción)
BASE_URL=https://tu-dominio.ngrok-free.app

# URL base de Cayacoa (opcional, por defecto usa cayacoagolf.com)
CAYACOA_BASE_URL=https://cayacoagolf.com

# Puerto del servidor
PORT=3000
```

### 2. Instalación del Userscript

Los usuarios deben instalar el userscript de Tampermonkey **una sola vez**:

1. Instalar [Tampermonkey](https://www.tampermonkey.net/) en el navegador
2. Visitar: `http://localhost:3000/userscript/cayacoa-autofill.user.js`
3. Hacer clic en "Instalar"
4. En la consola del navegador, configurar el servidor:
   ```javascript
   cayacoaAutoLogin.setApiServer("https://tu-dominio.ngrok-free.app")
   ```

## 📡 API Endpoints

### 1. Crear Magic Link

**POST** `/api/session`

Genera un Magic Link con cookies y credenciales del usuario.

#### Request Body:

```json
{
  "token": "abc123xyz",
  "url": "https://cayacoagolf.com/payment/12345",
  "cookies": [
    {
      "name": "session_id",
      "value": "xyz789",
      "domain": "cayacoagolf.com",
      "path": "/"
    }
  ],
  "credentials": {
    "username": "usuario@email.com",
    "password": "contraseña123"
  },
  "reservationInfo": {
    "date": "2026-02-15",
    "time": "10:00 AM",
    "price": "$50"
  }
}
```

#### Response:

```json
{
  "success": true,
  "message": "Sesión guardada correctamente",
  "token": "abc123xyz",
  "magicLink": "https://cayacoagolf.com/auto-login?token=abc123xyz",
  "serverLink": "https://tu-servidor.ngrok-free.app/session/abc123xyz",
  "shareableLink": "https://cayacoagolf.com/auto-login?token=abc123xyz",
  "expiresAt": "2026-02-02T15:30:00.000Z"
}
```

### 2. Validar Token

**POST** `/api/validate-token`

Endpoint llamado por el userscript para validar el token y obtener credenciales.

#### Request Body:

```json
{
  "token": "abc123xyz"
}
```

#### Response:

```json
{
  "success": true,
  "valid": true,
  "data": {
    "url": "https://cayacoagolf.com/payment/12345",
    "cookies": [...],
    "credentials": {
      "username": "usuario@email.com",
      "password": "contraseña123"
    },
    "reservationInfo": {
      "date": "2026-02-15",
      "time": "10:00 AM",
      "price": "$50"
    },
    "createdAt": "2026-02-02T14:30:00.000Z",
    "expiresAt": "2026-02-02T15:30:00.000Z"
  }
}
```

## 💻 Ejemplo de Uso

### Desde Node.js / JavaScript:

```javascript
// 1. Generar un Magic Link
const response = await fetch('http://localhost:3000/api/session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    token: 'unique-token-' + Date.now(),
    url: 'https://cayacoagolf.com/payment/12345',
    cookies: [
      // Cookies obtenidas del navegador del usuario
      {
        name: 'session_id',
        value: 'xyz789',
        domain: 'cayacoagolf.com',
        path: '/'
      }
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
  })
});

const result = await response.json();

// 2. Compartir el Magic Link con el usuario
console.log('Magic Link:', result.magicLink);
// Salida: https://cayacoagolf.com/auto-login?token=unique-token-1234567890

// 3. Enviar por email, WhatsApp, SMS, etc.
sendToUser(result.magicLink);
```

### Desde cURL:

```bash
curl -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d '{
    "token": "test-token-123",
    "url": "https://cayacoagolf.com/payment/12345",
    "cookies": [
      {
        "name": "session_id",
        "value": "xyz789",
        "domain": "cayacoagolf.com",
        "path": "/"
      }
    ],
    "credentials": {
      "username": "usuario@email.com",
      "password": "contraseña123"
    }
  }'
```

## 🔒 Seguridad

### Cookies con Atributos Cross-Domain

El sistema automáticamente configura las cookies con los atributos necesarios para contextos cross-domain:

- **`SameSite=None`**: Permite envío en contextos cross-site
- **`Secure=true`**: Requiere HTTPS (Ngrok lo proporciona por defecto)
- **`HttpOnly=true`**: Protección contra acceso por JavaScript malicioso

### Expiración de Tokens

- Los tokens expiran automáticamente después de **1 hora**
- Las sesiones expiradas se eliminan automáticamente cada 5 minutos
- Si un usuario intenta usar un token expirado, recibe un error 410

## 🧪 Testing

### 1. Probar Generación de Magic Link

```bash
# En el directorio del proyecto
cd web-automation-standalone

# Iniciar el servidor
npm start

# En otra terminal, crear un Magic Link de prueba
curl -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d '{
    "token": "test-123",
    "url": "https://cayacoagolf.com/payment/test",
    "cookies": [],
    "credentials": {
      "username": "test@example.com",
      "password": "test123"
    }
  }'
```

### 2. Probar Validación de Token

```bash
curl -X POST http://localhost:3000/api/validate-token \
  -H "Content-Type: application/json" \
  -d '{"token": "test-123"}'
```

### 3. Probar en el Navegador

1. Instalar el userscript
2. Configurar el servidor en la consola:
   ```javascript
   cayacoaAutoLogin.setApiServer("http://localhost:3000")
   ```
3. Visitar el Magic Link:
   ```
   https://cayacoagolf.com/auto-login?token=test-123
   ```
4. El userscript debería:
   - Detectar el token
   - Consultar el servidor
   - Hacer login automático
   - Redirigir a la página de destino

## 🐛 Debugging

### Ver configuración actual del userscript:

```javascript
// En la consola del navegador
cayacoaAutoLogin.getConfig()
```

### Ver logs del userscript:

Abre la consola del navegador (F12) y busca mensajes que empiecen con:
- 🏌️ (Script cargado)
- 🎫 (Magic Link detectado)
- 🌐 (Consultando servidor)
- ✅ (Sesión validada)
- 🍪 (Cookies establecidas)
- 🔐 (Auto-completando credenciales)

### Cambiar servidor del userscript:

```javascript
cayacoaAutoLogin.setApiServer("https://otro-servidor.ngrok-free.app")
```

## 📝 Notas Importantes

1. **HTTPS Requerido**: Para que las cookies con `SameSite=None` funcionen, tanto Cayacoa como tu servidor deben usar HTTPS. Ngrok proporciona HTTPS por defecto.

2. **Compatibilidad de Navegadores**: El sistema funciona en Chrome, Firefox, Safari y Edge con Tampermonkey instalado.

3. **Tokens Únicos**: Usa tokens únicos para cada Magic Link (recomendado: UUID o timestamp).

4. **Expiración**: Los Magic Links expiran después de 1 hora. Ajusta en `server.ts` si necesitas más/menos tiempo.

5. **Credenciales Seguras**: Las credenciales se almacenan temporalmente en el servidor. Considera encriptarlas si es necesario.

## 🚀 Mejoras Futuras

- [ ] Encriptación de credenciales en la base de datos
- [ ] Notificaciones por email/SMS cuando se use un Magic Link
- [ ] Dashboard para ver links activos y estadísticas
- [ ] Soporte para múltiples sitios (no solo Cayacoa)
- [ ] Rate limiting para prevenir abuso
- [ ] Autenticación con JWT para mayor seguridad

## 📞 Soporte

Para más información, visita la documentación interactiva en:
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`
