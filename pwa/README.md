# 🏌️ Cayacoa Golf PWA - Acceso Rápido

Progressive Web App para acceso rápido a reservas en Cayacoa Golf Club.

## 🎯 ¿Qué hace?

Esta PWA permite a los usuarios:
- **Guardar sus credenciales** de forma segura en su dispositivo
- **Acceso automático** - Solo abre el link y entra sin escribir nada
- **Links directos a reservas** - Envía links específicos por WhatsApp
- **Funciona como app** - Se puede instalar en la pantalla de inicio

## 📱 Cómo Funciona

### Primera vez que el usuario abre el link:

```
Usuario abre: https://tu-pwa.com/?booking=630am/03022026
   ↓
Ve formulario bonito con info de la reserva
   ↓
Escribe email y contraseña de Cayacoa
   ↓
Marca "Recordar mis credenciales"
   ↓
Clic en "Guardar y Acceder"
   ↓
Redirige a Cayacoa con login automático
   ↓
✅ Usuario logueado viendo su reserva
```

### Próximas veces:

```
Usuario abre: https://tu-pwa.com/?booking=700am/15032026
   ↓
PWA detecta credenciales guardadas
   ↓
Auto-login automático (el usuario no escribe nada)
   ↓
✅ Usuario logueado viendo su nueva reserva
```

## 🔗 URLs que Puedes Compartir

### 1. Reserva específica con fecha y hora:

```
https://tu-pwa.com/?booking=630am/03022026
```

Formato del parámetro `booking`: `HHMMam/pm/DDMMYYYY`

**Ejemplos:**
- `630am/03022026` = 6:30 AM del 03 Feb 2026
- `200pm/15032026` = 2:00 PM del 15 Mar 2026
- `1130am/10042026` = 11:30 AM del 10 Abr 2026

### 2. Redirigir a cualquier página:

```
https://tu-pwa.com/?redirect=/front-end/tee-time
```

### 3. Solo login (sin destino específico):

```
https://tu-pwa.com/
```

## 🚀 Publicar la PWA (GRATIS)

### Opción 1: GitHub Pages (Recomendado)

1. **Crear repositorio en GitHub:**
   - Ve a https://github.com/new
   - Nombre: `cayacoa-pwa`
   - Público
   - Click "Create repository"

2. **Subir archivos:**
   ```bash
   cd pwa
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/cayacoa-pwa.git
   git push -u origin main
   ```

3. **Activar GitHub Pages:**
   - En tu repo, ve a "Settings" > "Pages"
   - Source: "Deploy from a branch"
   - Branch: "main" / "root"
   - Click "Save"

4. **Tu PWA estará en:**
   ```
   https://TU_USUARIO.github.io/cayacoa-pwa/
   ```

**Ejemplo de link completo:**
```
https://tu-usuario.github.io/cayacoa-pwa/?booking=630am/03022026
```

### Opción 2: Netlify (Aún más fácil)

1. **Arrastra y suelta:**
   - Ve a https://app.netlify.com/drop
   - Arrastra la carpeta `pwa`
   - ¡Listo! Te da un link automáticamente

2. **Tu PWA estará en:**
   ```
   https://RANDOM-NAME.netlify.app/
   ```

3. **Cambiar nombre (opcional):**
   - Click en "Site settings"
   - "Change site name"
   - Elige un nombre: `cayacoa-golf`
   - Nuevo link: `https://cayacoa-golf.netlify.app/`

### Opción 3: Vercel

Similar a Netlify:
```bash
npm i -g vercel
cd pwa
vercel
```

## 📱 Instalar como App

### En Android:

1. Abre el link de la PWA en Chrome
2. Menú (⋮) → "Añadir a pantalla de inicio"
3. Aparece el ícono 🏌️ en tu pantalla
4. Toca el ícono para abrir como si fuera una app

### En iPhone:

1. Abre el link de la PWA en Safari
2. Botón de compartir (⬆️)
3. "Añadir a pantalla de inicio"
4. Aparece el ícono 🏌️ en tu pantalla

## 💬 Ejemplo de Uso Real

**Tú (admin) envías por WhatsApp:**

```
¡Hola Juan! 👋

Tu reserva en Cayacoa Golf está confirmada:
📅 3 de Febrero 2026
⏰ 6:30 AM

Accede directamente aquí:
https://cayacoa-golf.netlify.app/?booking=630am/03022026

La primera vez te pedirá tus credenciales de Cayacoa.
Las próximas veces entrarás automáticamente. ✨

¡Nos vemos en el campo! 🏌️
```

**El usuario (Juan):**

**Primera vez:**
1. Abre el link
2. Ve formulario bonito con la info de su reserva
3. Escribe su email y contraseña de Cayacoa
4. Clic en "Guardar y Acceder"
5. ✅ Entra automáticamente a ver su reserva

**Próximas veces:**
1. Abre el link
2. ✅ Entra automáticamente (no escribe nada)

## 🔒 Seguridad

- ✅ Las credenciales se guardan **solo en el dispositivo del usuario**
- ✅ Usa `localStorage` del navegador (encriptado por el OS)
- ✅ Nunca pasan por tu servidor
- ✅ El usuario puede borrarlas en cualquier momento

## 🎨 Personalizar

### Cambiar colores:

En `index.html`, busca:

```css
background: linear-gradient(135deg, #10b981 0%, #059669 100%);
```

Cambia los colores a los de tu marca.

### Cambiar logo:

Reemplaza el emoji 🏌️ por una imagen:

```html
<div class="logo">
    <img src="logo.png" alt="Cayacoa" style="width: 80px;">
</div>
```

## 📊 Ventajas vs. Tu Sistema Actual

| Característica | Sistema Actual | PWA |
|----------------|----------------|-----|
| **Servidor usa Playwright** | ✅ Sí (consume recursos) | ❌ No |
| **Funciona en Android** | ✅ Sí | ✅ Sí |
| **Funciona en iOS** | ⚠️ Limitado | ✅ Sí |
| **Costo servidor** | Alto | Gratis (hosting estático) |
| **Login automático** | ✅ Sí | ✅ Sí (después de la 1ra vez) |
| **Usuario escribe credenciales** | ❌ No | ⚠️ Solo la 1ra vez |
| **Tiempo de respuesta** | 10-15 seg | 2-3 seg |
| **Se puede instalar** | ❌ No | ✅ Sí |

## 🆚 Comparación con Tu Sistema

### Tu sistema actual (con Playwright):
```
Usuario → Tu servidor → Playwright abre navegador → Login → Redirect → Usuario
         (tu-server.ngrok.io)    (consume recursos)
```

### Con PWA:
```
Usuario → PWA estática → Redirect directo → Usuario
         (GitHub Pages)    (gratis)
```

## 🚀 Recomendación

**Usa ambos sistemas:**

1. **PWA** - Para usuarios recurrentes que ya confiaron sus credenciales
2. **Tu servidor con Playwright** - Para casos especiales o usuarios nuevos que no quieren guardar credenciales

Puedes incluso hacer que tu servidor redirija a la PWA:

```typescript
// En tu server.ts
return c.redirect(`https://cayacoa-golf.netlify.app/?booking=${bookingParam}`);
```

## 📞 Soporte

Si el usuario tiene problemas:
1. Abre la consola del navegador (F12)
2. Ve a la pestaña "Console"
3. Busca mensajes con 🏌️

## 🎉 ¡Listo!

Tu PWA está lista para usar. Solo publícala en GitHub Pages o Netlify y comparte los links por WhatsApp.

**Link de ejemplo:**
```
https://tu-usuario.github.io/cayacoa-pwa/?booking=630am/03022026
```
