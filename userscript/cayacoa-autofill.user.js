// ==UserScript==
// @name         Cayacoa Golf Auto-Login con Magic Link
// @namespace    http://cayacoagolf.com/
// @version      2.0
// @description  Auto-login con Magic Link - Detecta token en URL y obtiene credenciales del servidor
// @author       OpenClaw
// @match        https://app.cayacoagolf.com/*
// @match        https://cayacoagolf.com/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      *.ngrok-free.app
// @connect      *.ngrok.io
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('🏌️ Cayacoa Auto-Login: Script cargado (v2.0 - Magic Link)');
    
    // Configuración del servidor
    const API_SERVER = localStorage.getItem('cayacoa_api_server') || 'http://localhost:3000';
    
    // Credenciales por defecto (fallback)
    const DEFAULT_EMAIL = 'zad.duran@gmail.com';
    const DEFAULT_PASSWORD = 'zad1234567';
    
    // Detectar si hay un token en la URL o credenciales en el hash/query
    const urlParams = new URLSearchParams(window.location.search);
    const magicToken = urlParams.get('token');
    const hashParams = window.location.hash;
    
    let email = DEFAULT_EMAIL;
    let password = DEFAULT_PASSWORD;
    let targetUrl = null;
    let sessionData = null;
    
    // ============================================
    // PRIORIDAD 1: Detectar credenciales en URL query params
    // Ejemplo: ?email=usuario@email.com&password=secreto
    // ============================================
    const urlEmail = urlParams.get('email');
    const urlPassword = urlParams.get('password');
    
    if (urlEmail && urlPassword) {
        email = urlEmail;
        password = urlPassword;
        console.log('🔗 Credenciales detectadas en URL query params');
        console.log('📧 Email:', email);
        console.log('🔐 Password detectado');
        
        // Limpiar URL (quitar parámetros sensibles del historial)
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        console.log('✅ URL limpiada (parámetros removidos del historial)');
    }
    // PRIORIDAD 2: Detectar credenciales en el hash (para Chrome móvil sin Tampermonkey)
    else if (hashParams.includes('autologin=')) {
        try {
            const hashData = hashParams.split('autologin=')[1];
            const decoded = JSON.parse(atob(hashData));
            email = decoded.email || email;
            password = decoded.password || password;
            console.log('✅ Credenciales detectadas en hash de URL');
            console.log('🔐 Email:', email);
            
            // Limpiar hash después de leer
            window.location.hash = '';
        } catch (e) {
            console.warn('⚠️ Error al decodificar hash:', e);
        }
    }
    
    // Si hay token en la URL, obtener las credenciales del servidor
    if (magicToken) {
        console.log('🎫 Magic Link detectado! Token:', magicToken);
        fetchSessionFromToken(magicToken);
    } 
    // Si NO hay credenciales en URL, intentar obtener de sessionStorage/localStorage
    else if (!urlEmail || !urlPassword) {
        email = sessionStorage.getItem('cayacoa_email') || 
                localStorage.getItem('cayacoa_email') ||
                localStorage.getItem('cayacoa_autofill_email') || 
                email; // Ya viene de URL o DEFAULT
        
        password = sessionStorage.getItem('cayacoa_password') || 
                   localStorage.getItem('cayacoa_password') ||
                   localStorage.getItem('cayacoa_autofill_password') || 
                   password; // Ya viene de URL o DEFAULT
        
        targetUrl = sessionStorage.getItem('cayacoa_target') || 
                    localStorage.getItem('cayacoa_target') ||
                    urlParams.get('redirect');
        
        console.log('🔐 Email a usar:', email);
        console.log('🎯 URL destino:', targetUrl || 'No especificada');
    }
    
    // Si hay credenciales en URL params, auto-login siempre está activado
    const autoLoginFromUrl = !!(urlEmail && urlPassword);
    const autoLoginFromFlag = sessionStorage.getItem('cayacoa_auto_login') === 'true' || 
                             localStorage.getItem('cayacoa_auto_login') === 'true';
    
    if (autoLoginFromUrl || autoLoginFromFlag) {
        console.log('✅ Auto-login activado' + (autoLoginFromUrl ? ' desde URL params' : ' desde Magic Link'));
    }
    
    /**
     * Obtener datos de sesión desde el servidor usando el token
     */
    async function fetchSessionFromToken(token) {
        console.log('🌐 Consultando servidor para validar token...');
        
        try {
            const response = await fetch(`${API_SERVER}/api/validate-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token })
            });
            
            if (!response.ok) {
                console.error('❌ Token inválido o expirado');
                showNotification('❌ Link expirado o inválido', 'error');
                return;
            }
            
            const result = await response.json();
            
            if (result.success && result.valid) {
                sessionData = result.data;
                targetUrl = sessionData.url;
                
                // Obtener credenciales si están disponibles
                if (sessionData.credentials) {
                    email = sessionData.credentials.username;
                    password = sessionData.credentials.password;
                }
                
                console.log('✅ Sesión validada correctamente');
                console.log('🎯 URL destino:', targetUrl);
                console.log('🔐 Credenciales obtenidas del servidor');
                
                // Guardar en sessionStorage para uso posterior
                sessionStorage.setItem('cayacoa_email', email);
                sessionStorage.setItem('cayacoa_password', password);
                sessionStorage.setItem('cayacoa_target', targetUrl);
                
                // Establecer cookies si el servidor las devuelve
                if (sessionData.cookies && sessionData.cookies.length > 0) {
                    console.log('🍪 Estableciendo cookies...', sessionData.cookies.length);
                    setCookiesInBrowser(sessionData.cookies);
                }
                
                // Mostrar notificación de éxito
                showNotification('✅ Magic Link activado - Iniciando sesión...', 'success');
                
                // Si no estamos en la página de login, redirigir
                if (!window.location.pathname.includes('/login')) {
                    console.log('🔄 Redirigiendo al login...');
                    setTimeout(() => {
                        window.location.href = 'https://app.cayacoagolf.com/front-end/login';
                    }, 1000);
                }
                
            } else {
                console.error('❌ Token no válido');
                showNotification('❌ Link inválido', 'error');
            }
        } catch (error) {
            console.error('❌ Error al validar token:', error);
            showNotification('❌ Error de conexión con el servidor', 'error');
        }
    }
    
    /**
     * Establecer cookies en el navegador
     */
    function setCookiesInBrowser(cookies) {
        for (const cookie of cookies) {
            const cookieString = `${cookie.name}=${cookie.value}; domain=${cookie.domain}; path=${cookie.path || '/'}; ${cookie.secure ? 'secure;' : ''} ${cookie.sameSite ? 'SameSite=' + cookie.sameSite : ''}`;
            document.cookie = cookieString;
            console.log('🍪 Cookie establecida:', cookie.name);
        }
    }
    
    /**
     * Mostrar notificación visual al usuario
     */
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
    
    // Función para auto-completar el formulario
    function autoFillLogin() {
        console.log('🔍 Buscando campos de login...');
        
        // ============================================
        // SELECTORES EXACTOS de Cayacoa Golf Club
        // Basados en la estructura real de la página
        // ============================================
        
        // Buscar campos de email/username
        const emailSelectors = [
            'input[name="username"]',         // ← Selector PRINCIPAL de Cayacoa
            'input[type="email"]',
            'input[name="email"]',
            'input[id*="email"]',
            'input[id*="username"]',
            'input[placeholder*="mail"]',
            'input[placeholder*="Email"]'
        ];
        
        // Buscar campos de password
        const passwordSelectors = [
            'input[name="password"]',         // ← Selector PRINCIPAL de Cayacoa
            'input[type="password"]',
            'input[id*="password"]',
            'input[placeholder*="contraseña"]',
            'input[placeholder*="Contraseña"]'
        ];
        
        // Buscar botón de login
        const submitSelectors = [
            'button.btn-primary',             // ← Selector PRINCIPAL de Cayacoa
            'button[type="submit"]',
            'input[type="submit"]',
            'button:contains("Acceder")',
            'button:contains("Login")',
            'button:contains("Entrar")',
            '[class*="login-button"]',
            '[class*="submit-button"]'
        ];
        
        let emailField = null;
        let passwordField = null;
        let submitButton = null;
        
        // Buscar campo de email
        for (const selector of emailSelectors) {
            emailField = document.querySelector(selector);
            if (emailField) {
                console.log('✅ Campo de email encontrado:', selector);
                break;
            }
        }
        
        // Buscar campo de password
        for (const selector of passwordSelectors) {
            passwordField = document.querySelector(selector);
            if (passwordField) {
                console.log('✅ Campo de password encontrado:', selector);
                break;
            }
        }
        
        // Buscar botón de submit
        for (const selector of submitSelectors) {
            submitButton = document.querySelector(selector);
            if (submitButton) {
                console.log('✅ Botón de acceder encontrado:', selector);
                break;
            }
        }
        
        // Si no encontramos el botón con los selectores, buscar todos los botones
        if (!submitButton) {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent.toLowerCase().includes('acceder') || 
                    btn.textContent.toLowerCase().includes('login') ||
                    btn.textContent.toLowerCase().includes('entrar')) {
                    submitButton = btn;
                    console.log('✅ Botón encontrado por texto:', btn.textContent);
                    break;
                }
            }
        }
        
        // Auto-completar si encontramos los campos
        if (emailField && passwordField) {
            console.log('🔐 Auto-completando credenciales...');
            
            // Limpiar campos primero
            emailField.value = '';
            passwordField.value = '';
            
            // Simular entrada de usuario para activar validaciones
            emailField.focus();
            emailField.value = email;
            emailField.dispatchEvent(new Event('input', { bubbles: true }));
            emailField.dispatchEvent(new Event('change', { bubbles: true }));
            
            setTimeout(() => {
                passwordField.focus();
                passwordField.value = password;
                passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                passwordField.dispatchEvent(new Event('change', { bubbles: true }));
                
                console.log('✅ Credenciales ingresadas');
                
                // Verificar si auto-login está activado
                const autoLoginEnabled = sessionStorage.getItem('cayacoa_auto_login') === 'true' ||
                                       localStorage.getItem('cayacoa_auto_login') === 'true';
                
                // Auto-submit después de 1 segundo (más rápido)
                if (submitButton) {
                    const delay = autoLoginEnabled ? 800 : 1500; // Más rápido si viene de Magic Link
                    setTimeout(() => {
                        console.log('🚀 Enviando formulario automáticamente...');
                        submitButton.click();
                        
                        // Limpiar flag de auto-login después de usar
                        sessionStorage.removeItem('cayacoa_auto_login');
                        localStorage.removeItem('cayacoa_auto_login');
                        
                        // Si hay URL de destino, redirigir después del login
                        if (targetUrl) {
                            setTimeout(() => {
                                console.log('🎯 Redirigiendo a:', targetUrl);
                                window.location.href = targetUrl;
                            }, 2500);
                        }
                    }, delay);
                } else {
                    console.log('⚠️ No se encontró el botón de acceder - presiona Enter o haz clic manualmente');
                }
            }, 300);
            
            return true;
        } else {
            console.log('❌ No se encontraron los campos de login');
            if (!emailField) console.log('  ❌ Campo de email no encontrado');
            if (!passwordField) console.log('  ❌ Campo de password no encontrado');
            return false;
        }
    }
    
    // Intentar auto-completar después de que la página cargue
    function tryAutoFill() {
        console.log('🏌️ Intentando auto-login...');
        
        // Si viene de Magic Link o de URL params, ser más agresivo
        const autoLoginEnabled = autoLoginFromUrl || 
                               autoLoginFromFlag ||
                               sessionStorage.getItem('cayacoa_auto_login') === 'true' ||
                               localStorage.getItem('cayacoa_auto_login') === 'true';
        
        const initialDelay = autoLoginEnabled ? 200 : 500; // Más rápido si viene de Magic Link o URL
        
        // Esperar un poco para asegurar que el DOM está listo
        setTimeout(() => {
            const success = autoFillLogin();
            
            if (!success) {
                // Si no funcionó, intentar de nuevo después de 1 segundo
                console.log('⏳ Reintentando en 1 segundo...');
                setTimeout(autoFillLogin, 1000);
            }
        }, initialDelay);
    }
    
    // Ejecutar cuando el DOM esté listo
    function initAutoFill() {
        // Si estamos en la página de login, ejecutar auto-fill
        if (window.location.pathname.includes('/login')) {
            console.log('🔍 Página de login detectada');
            tryAutoFill();
        } else if (targetUrl && magicToken) {
            // Si hay URL de destino y magic token, ya estamos logueados
            // Esperar un poco y redirigir
            console.log('🎯 Ya logueado, redirigiendo a:', targetUrl);
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 2000);
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAutoFill);
    } else {
        // Dar tiempo para que fetchSessionFromToken complete si hay magic token
        if (magicToken) {
            setTimeout(initAutoFill, 1500);
        } else {
            initAutoFill();
        }
    }
    
    // También intentar si la página cambia dinámicamente
    const observer = new MutationObserver((mutations) => {
        const hasNewInputs = mutations.some(mutation => 
            Array.from(mutation.addedNodes).some(node => 
                node.nodeName === 'INPUT' || 
                (node.querySelectorAll && node.querySelectorAll('input').length > 0)
            )
        );
        
        if (hasNewInputs && window.location.pathname.includes('/login')) {
            console.log('🔄 Nuevos campos detectados, reintentando...');
            autoFillLogin();
        }
    });
    
    // Esperar a que body exista
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
    
    // Exponer configuración global para debugging
    window.cayacoaAutoLogin = {
        setApiServer: (url) => {
            localStorage.setItem('cayacoa_api_server', url);
            console.log('✅ API Server configurado:', url);
        },
        getConfig: () => ({
            apiServer: API_SERVER,
            hasMagicToken: !!magicToken,
            email,
            targetUrl
        })
    };
    
    console.log('💡 Tip: Usa cayacoaAutoLogin.setApiServer("https://tu-servidor.ngrok-free.app") para configurar tu servidor');
    
})();
