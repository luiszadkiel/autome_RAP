# 🚀 Cómo Publicar la PWA en GitHub Pages

## Paso 1: Crear Repositorio en GitHub

1. Ve a: https://github.com/new
2. Nombre del repositorio: `cayacoa-pwa`
3. Público ✅
4. Click "Create repository"

## Paso 2: Subir los Archivos

```bash
cd web-automation-standalone/pwa

git init
git add .
git commit -m "PWA Cayacoa Golf - Acceso Automático"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/cayacoa-pwa.git
git push -u origin main
```

## Paso 3: Activar GitHub Pages

1. En tu repositorio, ve a **Settings**
2. En el menú lateral, click en **Pages**
3. En "Source", selecciona:
   - Branch: **main**
   - Folder: **/ (root)**
4. Click **Save**
5. Espera 1-2 minutos

## ✅ Tu PWA Estará Lista

**URL de tu PWA:**
```
https://TU_USUARIO.github.io/cayacoa-pwa/
```

**Ejemplo:**
```
https://zadkiel.github.io/cayacoa-pwa/
```

## 🔗 Links para Compartir

### Link para reserva específica:
```
https://zadkiel.github.io/cayacoa-pwa/?booking=630am/03022026
```

### Link para otra reserva:
```
https://zadkiel.github.io/cayacoa-pwa/?booking=200pm/15032026
```

## 🎯 Cómo Funciona

### Primera Vez (Usuario Nuevo):
```
Usuario abre tu link
   ↓
Ve formulario con info de reserva
   ↓
Escribe email y contraseña de Cayacoa
   ↓
Marca "Recordar credenciales"
   ↓
Click "Guardar y Acceder"
   ↓
✅ Login automático
```

### Próximas Veces (Usuario Recurrente):
```
Usuario abre tu link
   ↓
PWA detecta credenciales guardadas
   ↓
✅ Login automático (sin escribir nada)
```

## 💬 Mensaje de WhatsApp

```
¡Hola! 👋

Tu reserva en Cayacoa Golf:
📅 3 de Febrero 2026
⏰ 6:30 AM

Accede aquí:
https://zadkiel.github.io/cayacoa-pwa/?booking=630am/03022026

✨ La primera vez te pedirá tus credenciales.
Las próximas veces entrarás automáticamente.

¡Nos vemos! 🏌️
```

## 🔧 Actualizar la PWA

Si haces cambios en los archivos:

```bash
cd web-automation-standalone/pwa

git add .
git commit -m "Actualización"
git push
```

Espera 1-2 minutos y los cambios estarán en vivo.
