import { Page } from 'playwright';

export interface LoginVerificationResult {
    isLoggedIn: boolean;
    confidence: number;
    evidence: string[];
    failureReason?: string;
}

export class LoginVerifier {
    /**
     * Verifica si el login fue exitoso después de enviar credenciales.
     * Se ejecuta cuando la URL ya no es de login o al final del presupuesto de login.
     */
    async verify(page: Page, loginUrl: string): Promise<LoginVerificationResult> {
        const evidence: string[] = [];
        let confidence = 0;
        const currentUrl = page.url();

        if (currentUrl !== loginUrl && !this.isLoginRelatedUrl(currentUrl)) {
            // Rechazar about:blank y páginas vacías como login exitoso
            if (/^(about:blank|about:srcdoc|chrome:|data:)/i.test(currentUrl)) {
                confidence -= 30;
                evidence.push(`URL inválida post-login: ${currentUrl}`);
            } else {
                confidence += 40;
                evidence.push(`URL cambió de login a: ${currentUrl}`);
            }
        } else {
            confidence -= 20;
            evidence.push('URL sigue siendo la página de login');
        }

        const sessionIndicators = await this.checkSessionIndicators(page);
        if (sessionIndicators.found) {
            confidence += 30;
            evidence.push(`Indicadores de sesión: ${sessionIndicators.details}`);
        }

        const hasLoginForm = await this.hasVisibleLoginForm(page);
        if (!hasLoginForm) {
            confidence += 20;
            evidence.push('Formulario de login ya no visible');
        } else {
            confidence -= 30;
            evidence.push('⚠️ Formulario de login AÚN visible (posible fallo)');
        }

        const errorMessages = await this.detectErrorMessages(page);
        if (errorMessages.length > 0) {
            confidence -= 40;
            evidence.push(`Errores detectados: ${errorMessages.join(', ')}`);
        }
        
        // Detectar 2FA / OTP / Captcha
        const twoFactorDetected = await this.detectTwoFactorOrCaptcha(page);
        if (twoFactorDetected.found) {
            confidence = 0; // Login no completado si requiere 2FA
            evidence.push(`⚠️ ${twoFactorDetected.type} detectado: ${twoFactorDetected.details}`);
        }

        const cookies = await page.context().cookies();
        const sessionCookies = cookies.filter(c =>
            /session|token|auth|jwt|sid|PHPSESSID/i.test(c.name)
        );
        if (sessionCookies.length > 0) {
            confidence += 15;
            evidence.push(`Cookies de sesión: ${sessionCookies.map(c => c.name).join(', ')}`);
        }

        confidence = Math.max(0, Math.min(100, confidence));

        return {
            isLoggedIn: confidence >= 50,
            confidence,
            evidence,
            failureReason: confidence < 50
                ? `Login probablemente falló (confianza: ${confidence}%). ${evidence.filter(e => e.includes('⚠️')).join('. ')}`
                : undefined
        };
    }

    private isLoginRelatedUrl(url: string): boolean {
        return /\/login|\/signin|\/auth|\/iniciar|front-end\/login/i.test(url);
    }

    private async checkSessionIndicators(page: Page): Promise<{ found: boolean; details: string }> {
        const selectors = [
            { sel: 'a[href*="logout"], a[href*="signout"], a[href*="cerrar"]', desc: 'Enlace logout' },
            { sel: '[class*="user-menu"], [class*="profile"], [class*="avatar"]', desc: 'Menú usuario' },
            { sel: '[aria-label*="profile" i], [aria-label*="account" i]', desc: 'Perfil/cuenta' },
            { sel: '.dashboard, .home-content, [class*="dashboard"]', desc: 'Dashboard' }
        ];
        const found: string[] = [];
        for (const { sel, desc } of selectors) {
            try {
                const count = await page.locator(sel).count();
                if (count > 0) found.push(desc);
            } catch { /* ignorar */ }
        }
        return { found: found.length > 0, details: found.join(', ') || 'ninguno' };
    }

    private async hasVisibleLoginForm(page: Page): Promise<boolean> {
        try {
            return await page.locator('input[type="password"]').isVisible({ timeout: 1000 });
        } catch {
            return false;
        }
    }

    private async detectErrorMessages(page: Page): Promise<string[]> {
        const errors: string[] = [];
        const errorSelectors = [
            '.error', '.alert-danger', '.alert-error', '[class*="error"]',
            '[role="alert"]', '.invalid-feedback', '.form-error',
            '.notification-error', '.toast-error'
        ];
        for (const sel of errorSelectors) {
            try {
                const elements = await page.locator(sel).allTextContents();
                elements
                    .map(t => t.trim())
                    .filter(t => t.length > 0 && t.length < 200)
                    .forEach(t => errors.push(t));
            } catch { /* ignorar */ }
        }
        try {
            const bodyText = await page.textContent('body') || '';
            const errorPatterns = [
                /credenciales? (incorrectas?|inválidas?|errón)/i,
                /invalid (credentials|password|login)/i,
                /incorrect (password|email|username)/i,
                /authentication failed/i,
                /login failed/i,
                /contraseña incorrecta/i,
                /usuario no encontrado/i
            ];
            for (const pattern of errorPatterns) {
                if (pattern.test(bodyText)) {
                    errors.push(`Texto de error en página: ${pattern.source}`);
                }
            }
        } catch { /* ignorar */ }
        return errors;
    }
    
    /**
     * Detecta si la página requiere 2FA, OTP o tiene un captcha
     */
    private async detectTwoFactorOrCaptcha(page: Page): Promise<{ found: boolean; type: string; details: string }> {
        // Detectar campos de 2FA/OTP
        const twoFactorSelectors = [
            'input[name*="otp"]',
            'input[name*="code"]',
            'input[name*="verification"]',
            'input[name*="2fa"]',
            'input[name*="two-factor"]',
            'input[type="tel"][maxlength="6"]', // Códigos OTP suelen ser 6 dígitos
            'input[placeholder*="code" i]',
            'input[placeholder*="otp" i]',
            'input[placeholder*="verification" i]',
            '[id*="otp"]',
            '[id*="verification-code"]',
            '[class*="otp"]',
            '[class*="verification-code"]'
        ];
        
        for (const selector of twoFactorSelectors) {
            try {
                const visible = await page.locator(selector).isVisible({ timeout: 1000 });
                if (visible) {
                    const label = await page.locator(selector).getAttribute('placeholder') || 
                                 await page.locator(selector).getAttribute('name') || 
                                 'campo de verificación';
                    return { found: true, type: '2FA/OTP', details: `Campo de verificación detectado: ${label}` };
                }
            } catch { /* continuar */ }
        }
        
        // Detectar texto relacionado con 2FA
        try {
            const bodyText = await page.textContent('body') || '';
            const twoFactorPatterns = [
                /verification code|verification code sent|enter.*code|two.?factor|2.?factor|otp|authentication code/i,
                /código de verificación|código enviado|ingresa.*código|autenticación.*factor/i
            ];
            
            for (const pattern of twoFactorPatterns) {
                if (pattern.test(bodyText)) {
                    return { found: true, type: '2FA/OTP', details: 'Texto de 2FA detectado en página' };
                }
            }
        } catch { /* ignorar */ }
        
        // Detectar captcha (reCAPTCHA, hCaptcha, etc.)
        const captchaSelectors = [
            '[class*="recaptcha"]',
            '[id*="recaptcha"]',
            '[class*="hcaptcha"]',
            '[id*="hcaptcha"]',
            'iframe[src*="recaptcha"]',
            'iframe[src*="hcaptcha"]',
            '.g-recaptcha',
            '#g-recaptcha',
            '[data-sitekey]' // reCAPTCHA usa data-sitekey
        ];
        
        for (const selector of captchaSelectors) {
            try {
                const count = await page.locator(selector).count();
                if (count > 0) {
                    return { found: true, type: 'Captcha', details: `Captcha detectado (${selector})` };
                }
            } catch { /* continuar */ }
        }
        
        // Detectar texto relacionado con captcha
        try {
            const bodyText = await page.textContent('body') || '';
            if (/captcha|i'm not a robot|no soy un robot/i.test(bodyText)) {
                return { found: true, type: 'Captcha', details: 'Texto de captcha detectado en página' };
            }
        } catch { /* ignorar */ }
        
        return { found: false, type: '', details: '' };
    }
}
