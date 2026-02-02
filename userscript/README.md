# 🏌️ Cayacoa Golf Auto-Login

UserScript para auto-completar el formulario de login de Cayacoa Golf automáticamente cuando accedes desde un link compartido.

## 🚀 Instalación Rápida (2 minutos)

### Paso 1: Instalar Tampermonkey

**En Chrome/Edge:**
1. Ve a la [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
2. Haz clic en "Agregar a Chrome"

**En Firefox:**
1. Ve a [Firefox Add-ons](https://addons.mozilla.org/es/firefox/addon/tampermonkey/)
2. Haz clic en "Agregar a Firefox"

**En Safari (iOS/Mac):**
1. Descarga Userscripts desde el App Store
2. O usa Tampermonkey desde Safari Extensions

### Paso 2: Instalar el Script

1. Abre el archivo `cayacoa-autofill.user.js`
2. Tampermonkey detectará automáticamente el script
3. Haz clic en "Instalar"

**O manualmente:**
1. Haz clic en el ícono de Tampermonkey
2. Selecciona "Dashboard"
3. Haz clic en el ícono "+" para crear un nuevo script
4. Copia y pega el contenido de `cayacoa-autofill.user.js`
5. Presiona Ctrl+S (Cmd+S en Mac) para guardar

## ✨ Cómo Funciona

### Automático
Cuando abres un link de reserva desde WhatsApp:

1. **Click en link** → Abre página intermedia
2. **Countdown 3 segundos** → Muestra info de reserva
3. **Redirige a Cayacoa** → Abre página de login
4. **🤖 AUTO-COMPLETA** → Llena email y password
5. **🚀 AUTO-SUBMIT** → Hace clic en "Acceder" (1.5s)
6. **✅ Login exitoso** → Entra directo al pago

### Credenciales

El script usará las credenciales en este orden:
1. Las guardadas en el link (si vienen del sistema)
2. Las por defecto: `zad.duran@gmail.com` / `zad1234567`

## 🔧 Configuración

### Cambiar Credenciales por Defecto

Edita las líneas 16-17 del script:

```javascript
const DEFAULT_EMAIL = 'tu-email@ejemplo.com';
const DEFAULT_PASSWORD = 'tu-password';
```

### Deshabilitar Auto-Submit

Si prefieres solo auto-completar sin hacer submit automático, comenta las líneas 118-129:

```javascript
// Auto-submit después de 1.5 segundos
/*
if (submitButton) {
    setTimeout(() => {
        console.log('🚀 Enviando formulario...');
        submitButton.click();
        ...
    }, 1500);
}
*/
```

## 🐛 Solución de Problemas

### El script no se ejecuta

1. Verifica que Tampermonkey esté habilitado (ícono verde)
2. Asegúrate de estar en `https://app.cayacoagolf.com/front-end/login`
3. Abre la consola (F12) y busca mensajes `🏌️ Cayacoa Auto-Login`

### No encuentra los campos

El script intentará múltiples selectores. Si falla:
1. Abre la consola del navegador (F12)
2. Busca mensajes de error del script
3. Inspecciona los campos del formulario de Cayacoa
4. Ajusta los selectores en el script si es necesario

### Los campos se llenan pero no hace submit

Esto es por seguridad del sitio. El script espera 1.5 segundos antes de hacer submit. Si no funciona:
- Presiona Enter manualmente
- O haz clic en "Acceder"

## 📊 Logs en Consola

El script genera logs detallados:

```
🏌️ Cayacoa Auto-Login: Script cargado
🔐 Email a usar: zad.duran@gmail.com
🎯 URL destino: https://app.cayacoagolf.com/front-end/make-booking/...
🔍 Buscando campos de login...
✅ Campo de email encontrado: input[type="email"]
✅ Campo de password encontrado: input[type="password"]
✅ Botón de acceder encontrado: button[type="submit"]
🔐 Auto-completando credenciales...
✅ Credenciales ingresadas
🚀 Enviando formulario...
```

## 🔒 Seguridad

- ✅ El script solo se ejecuta en `app.cayacoagolf.com`
- ✅ Las credenciales se guardan localmente en tu navegador
- ✅ No se envían datos a servidores externos
- ✅ Código abierto y auditable

## 💡 Uso Avanzado

### Con Otros Sitios

Puedes adaptar este script para otros sitios modificando:

1. `@match` - Cambia la URL
2. Los selectores de campos (líneas 25-56)
3. Las credenciales por defecto

### Integración con Sistema

El script lee automáticamente las credenciales de:
- `sessionStorage.cayacoa_email`
- `sessionStorage.cayacoa_password`
- `sessionStorage.cayacoa_target`

Estos valores se establecen automáticamente desde la página intermedia del link compartido.

## 🆘 Soporte

Si tienes problemas:
1. Revisa los logs en la consola del navegador (F12)
2. Verifica que Tampermonkey esté habilitado
3. Comprueba que la URL coincida con `@match`
4. Inspecciona los selectores del formulario de Cayacoa

## 📝 Licencia

MIT License - Úsalo libremente para tus proyectos
