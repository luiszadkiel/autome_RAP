import { Page } from 'playwright';

export interface VerificationResult {
    success: boolean;
    confidence: number; // 0-100
    reason: string;
    shouldRetry: boolean;
    suggestedAction?: string;
    evidence: {
        domChanged: boolean;
        urlChanged: boolean;
        newElementsAppeared: boolean;
        targetElementChanged: boolean;
        errorsDetected: string[];
        loadingComplete: boolean;
        networkIdle: boolean;
    };
}

export interface ActionContext {
    action: string;
    targetRef?: string;
    targetSelector?: string;
    value?: string;
    expectedOutcome?: string;
}

export interface PageFingerprint {
    url: string;
    title: string;
    elementCount: number;
    visibleElementsHash: string;
    hasModal: boolean;
    activeFormInputs: number;
    bodyLength: number;
}

export interface ElementState {
    exists: boolean;
    visible: boolean;
    enabled: boolean;
    text: string;
    value: string;
    checked?: boolean;
    selected?: number;
    position: { x: number; y: number };
    classes: string;
}

export interface PreActionState {
    url: string;
    fingerprint: PageFingerprint;
    targetState: ElementState | null;
    timestamp: number;
}

export class ActionVerifier {
    private previousSnapshot: PageFingerprint | null = null;
    private previousUrl: string = '';
    private stableChecks = 0;
    private loginPageCache: { url: string; isLogin: boolean; timestamp: number } | null = null;
    private configLoginUrl: string | null = null;

    setConfigLoginUrl(loginUrl: string | undefined): void {
        this.configLoginUrl = loginUrl?.toLowerCase() || null;
    }

    /**
     * Captura el estado ANTES de ejecutar una acción
     */
    async capturePreActionState(page: Page, context: ActionContext): Promise<PreActionState> {
        // Verificar si la página está cerrada antes de capturar el estado
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        try {
            const [fingerprint, targetState] = await Promise.all([
                this.getPageFingerprint(page),
                context.targetRef ? this.getElementState(page, context.targetRef) : null
            ]);

            return {
                url: page.url(),
                fingerprint,
                targetState,
                timestamp: Date.now()
            };
        } catch (e: any) {
            const errorMessage = e?.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                throw new Error('Target page, context or browser has been closed');
            }
            throw e;
        }
    }

    /**
     * Verifica el resultado DESPUÉS de ejecutar una acción
     */
    async verifyAction(
        page: Page,
        context: ActionContext,
        preState: PreActionState
    ): Promise<VerificationResult> {
        try {
            // 1. Esperar estabilidad (máximo 3 segundos, 5s en login)
            const isLoginCtx = this.isLoginPage(preState.url);
            await this.waitForStability(page, 3000, isLoginCtx);

            const evidence = {
                domChanged: false,
                urlChanged: false,
                newElementsAppeared: false,
                targetElementChanged: false,
                errorsDetected: [] as string[],
                loadingComplete: true,
                networkIdle: true
            };

            // 2. Verificar cambio de URL
            let currentUrl = preState.url;
            try {
                if (page.isClosed()) {
                    throw new Error('Target page, context or browser has been closed');
                }
                currentUrl = page.url();
            } catch (e: any) {
                const errorMessage = e?.message || '';
                if (errorMessage.includes('Target page, context or browser has been closed') ||
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Browser closed') ||
                    errorMessage.includes('context was destroyed')) {
                    throw new Error('Target page, context or browser has been closed');
                }
                // Si falla obtener la URL por otra razón, mantenemos la anterior
            }
            evidence.urlChanged = currentUrl !== preState.url;

            // 3. Verificar cambios en DOM
            const currentFingerprint = await this.getPageFingerprint(page).catch(() => preState.fingerprint);
            evidence.domChanged = !this.fingerprintsEqual(preState.fingerprint, currentFingerprint);
            evidence.newElementsAppeared = currentFingerprint.elementCount > preState.fingerprint.elementCount;

            // 4. Verificar cambio en elemento objetivo
            if (context.targetRef && preState.targetState) {
                try {
                    const currentTargetState = await this.getElementState(page, context.targetRef);
                    evidence.targetElementChanged = !this.elementStatesEqual(preState.targetState, currentTargetState);
                } catch {
                    // Elemento puede no existir si el contexto está cerrado
                }
            }

            // 5. Detectar errores en la página
            evidence.errorsDetected = await this.detectPageErrors(page).catch(() => []);

            // 6. Verificar loading completado
            evidence.loadingComplete = await this.isLoadingComplete(page).catch(() => true);

            // 7. Verificar network idle
            evidence.networkIdle = await this.isNetworkIdle(page).catch(() => true);

            // 8. Calcular resultado
            return this.calculateVerificationResult(context, evidence, preState);
        } catch (error: any) {
            // Si el contexto está cerrado durante la verificación, retornar resultado de fallo
            const errorMessage = error.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                // Retornar resultado que indica que el contexto está cerrado
                return {
                    success: false,
                    confidence: 0,
                    reason: 'Context closed during verification',
                    shouldRetry: false,
                    evidence: {} as any,
                    suggestedAction: undefined
                };
            }
            // Re-lanzar otros errores
            throw error;
        }
    }

    /**
     * Espera hasta que la página esté estable
     */
    private async waitForStability(page: Page, maxWait: number, isLoginContext?: boolean): Promise<void> {
        const effectiveMaxWait = isLoginContext ? Math.max(maxWait, 5000) : maxWait;
        const startTime = Date.now();
        let lastHtmlLength = 0;
        let stableCount = 0;

        while (Date.now() - startTime < effectiveMaxWait && stableCount < 3) {
            // Verificar si la página está cerrada antes de continuar
            if (page.isClosed()) {
                throw new Error('Target page, context or browser has been closed');
            }

            try {
                // Esperar un poco
                try {
                    await page.waitForTimeout(150);
                } catch (e: any) {
                    const errorMessage = e?.message || '';
                    if (errorMessage.includes('Target page, context or browser has been closed') ||
                        errorMessage.includes('Target closed') ||
                        errorMessage.includes('Browser closed') ||
                        errorMessage.includes('context was destroyed')) {
                        throw new Error('Target page, context or browser has been closed');
                    }
                    // Continuar si es otro tipo de error
                }

                // Verificar si el DOM cambió
                const currentLength = await page.evaluate(() => document.body.innerHTML.length).catch(() => {
                    // Si el contexto está cerrado, lanzar error específico
                    throw new Error('Target page, context or browser has been closed');
                });

                if (Math.abs(currentLength - lastHtmlLength) < 50) {
                    stableCount++;
                } else {
                    stableCount = 0;
                    lastHtmlLength = currentLength;
                }

                // También verificar si hay requests pendientes
                try {
                    await page.waitForLoadState('networkidle', { timeout: 500 });
                    break;
                } catch {
                    // Continuar esperando
                }
            } catch (error: any) {
                // Si el contexto está cerrado, propagar el error
                const errorMessage = error.message || '';
                if (errorMessage.includes('Target page, context or browser has been closed') ||
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Browser closed') ||
                    errorMessage.includes('context was destroyed')) {
                    throw error;
                }
                // Para otros errores, continuar esperando
            }
        }
    }

    /**
     * Obtiene una "huella digital" de la página para comparación rápida
     */
    private async getPageFingerprint(page: Page): Promise<PageFingerprint> {
        // Verificar si la página está cerrada antes de evaluar
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        try {
            return await page.evaluate(() => {
                // Verificar si el contexto está cerrado
                if (!document.body) {
                    throw new Error('Target page, context or browser has been closed');
                }
                const interactiveElements = document.querySelectorAll(
                    'button, input, select, a[href], [role="button"], [onclick]'
                );

                // Crear hash de elementos visibles
                const visibleElements: string[] = [];
                interactiveElements.forEach((el, idx) => {
                    if (el instanceof HTMLElement && el.offsetParent !== null) {
                        visibleElements.push(`${el.tagName}:${el.textContent?.slice(0, 20) || idx}`);
                    }
                });

                // Detectar modales/overlays
                const hasModal = !!document.querySelector(
                    '[role="dialog"], [role="alertdialog"], .modal.show, [aria-modal="true"]'
                );

                // Detectar formularios activos
                const activeFormInputs = document.querySelectorAll('input:focus, select:focus, textarea:focus').length;

                return {
                    url: window.location.href,
                    title: document.title,
                    elementCount: interactiveElements.length,
                    visibleElementsHash: visibleElements.slice(0, 20).join('|'),
                    hasModal,
                    activeFormInputs,
                    bodyLength: document.body.innerHTML.length
                };
            });
        } catch (e: any) {
            const errorMessage = e?.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                // Lanzar el error para que se propague correctamente
                throw new Error('Target page, context or browser has been closed');
            }
            // Si falla por otra razón, retornar fingerprint básico
            return {
                url: '',
                title: '',
                elementCount: 0,
                visibleElementsHash: '',
                hasModal: false,
                activeFormInputs: 0,
                bodyLength: 0
            };
        }
    }

    /**
     * Obtiene el estado de un elemento específico
     */
    private async getElementState(page: Page, ref: string): Promise<ElementState | null> {
        // Verificar si la página está cerrada antes de evaluar
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        try {
            return await page.evaluate((ref) => {
                // Verificar si el contexto está cerrado
                if (!document.body) {
                    throw new Error('Target page, context or browser has been closed');
                }
                // Buscar por data-ref o por índice
                let element: HTMLElement | null = null;

                if (ref.startsWith('e') && !isNaN(parseInt(ref.slice(1)))) {
                    const index = parseInt(ref.replace('e', '')) - 1;
                    const elements = document.querySelectorAll('button, input, select, a');
                    if (index >= 0 && index < elements.length) {
                        element = elements[index] as HTMLElement;
                    }
                }

                if (!element) {
                    element = document.querySelector(`[data-ref="${ref}"]`) as HTMLElement;
                }

                if (!element || !(element instanceof HTMLElement)) return null;

                const rect = element.getBoundingClientRect();

                return {
                    exists: true,
                    visible: element.offsetParent !== null,
                    enabled: !(element as HTMLButtonElement).disabled,
                    text: element.textContent?.slice(0, 50) || '',
                    value: (element as HTMLInputElement).value || '',
                    checked: (element as HTMLInputElement).checked,
                    selected: (element as HTMLSelectElement).selectedIndex,
                    position: { x: rect.x, y: rect.y },
                    classes: element.className
                };
            }, ref);
        } catch (error: any) {
            const errorMessage = error.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Detecta mensajes de error en la página
     */
    private async detectPageErrors(page: Page): Promise<string[]> {
        // Verificar si la página está cerrada antes de evaluar
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        return page.evaluate(() => {
            // Verificar si el contexto está cerrado
            if (!document.body) {
                throw new Error('Target page, context or browser has been closed');
            }
            const errors: string[] = [];

            // Selectores de errores comunes
            const errorSelectors = [
                '.error', '.alert-danger', '.alert-error', '.error-message',
                '[role="alert"]', '.toast-error', '.notification-error',
                '.form-error', '.field-error', '.validation-error',
                '[class*="error"]:not([class*="no-error"])',
                '.invalid-feedback:not(:empty)'
            ];

            for (const selector of errorSelectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (el instanceof HTMLElement && el.offsetParent !== null && el.textContent?.trim()) {
                        errors.push(el.textContent.trim().slice(0, 100));
                    }
                });
            }

            // También verificar inputs inválidos
            const invalidInputs = document.querySelectorAll('input:invalid, [aria-invalid="true"]');
            if (invalidInputs.length > 0) {
                errors.push(`${invalidInputs.length} campo(s) con validación fallida`);
            }

            return [...new Set(errors)]; // Eliminar duplicados
        });
    }

    /**
     * Verifica si la página terminó de cargar
     */
    private async isLoadingComplete(page: Page): Promise<boolean> {
        // Verificar si la página está cerrada antes de evaluar
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        return page.evaluate(() => {
            // Verificar si el contexto está cerrado
            if (!document.body) {
                throw new Error('Target page, context or browser has been closed');
            }
            // Verificar spinners/loaders
            const loadingIndicators = document.querySelectorAll(
                '.loading, .spinner, .loader, [class*="loading"], [class*="spinner"],' +
                '.sk-spinner, .lds-ring, .lds-dual-ring, [aria-busy="true"]'
            );

            for (const indicator of Array.from(loadingIndicators)) {
                if (indicator instanceof HTMLElement && indicator.offsetParent !== null) {
                    return false;
                }
            }

            // Verificar skeleton screens
            const skeletons = document.querySelectorAll('[class*="skeleton"], [class*="placeholder"]');
            for (const skeleton of Array.from(skeletons)) {
                if (skeleton instanceof HTMLElement && skeleton.offsetParent !== null) {
                    return false;
                }
            }

            return document.readyState === 'complete';
        });
    }

    /**
     * Verifica si hay requests de red pendientes
     */
    private async isNetworkIdle(page: Page): Promise<boolean> {
        // Verificar si la página aún existe antes de hacer la verificación
        try {
            await page.url(); // Verificación rápida de que la página existe
        } catch (error: any) {
            const errorMessage = error.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                throw new Error('Target page, context or browser has been closed');
            }
            // Para otros errores, asumir que está idle
            return true;
        }
        try {
            await page.waitForLoadState('networkidle', { timeout: 1000 });
            return true;
        } catch (error: any) {
            // Si el error es de contexto cerrado, propagarlo
            const errorMessage = error.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                throw error;
            }
            // Para otros errores (timeout, etc.), asumir que no está idle
            return false;
        }
    }

    /**
     * Detección híbrida de página de login (solo parte URL aquí; DOM en isLoginPageAsync).
     */
    private isLoginPage(url: string): boolean {
        const u = url.toLowerCase();
        if (this.configLoginUrl && u.includes(this.configLoginUrl)) return true;
        const loginPatterns = /\/(login|signin|sign-in|auth|iniciar-sesion|inicio-sesion|acceso|acceder|entrar|front-end\/login|consumer\/login|portal\/login|sso|oauth|authenticate|welcome\/login)/;
        if (loginPatterns.test(u)) return true;
        if (this.loginPageCache && this.loginPageCache.url === u && Date.now() - this.loginPageCache.timestamp < 5000) {
            return this.loginPageCache.isLogin;
        }
        return false;
    }

    /**
     * Versión async que también chequea el DOM (formulario con password). Usar cuando se necesita certeza.
     */
    async isLoginPageAsync(page: Page, url: string): Promise<boolean> {
        if (this.isLoginPage(url)) return true;
        try {
            const hasPasswordField = await page.locator('input[type="password"]').isVisible({ timeout: 1500 });
            if (!hasPasswordField) {
                this.loginPageCache = { url: url.toLowerCase(), isLogin: false, timestamp: Date.now() };
                return false;
            }
            const hasUserField = await page.locator(
                'input[type="email"], input[type="text"][name*="user"], input[name*="email"], input[name*="login"]'
            ).count() > 0;
            const hasSubmit = await page.locator(
                'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Entrar"), button:has-text("Acceder"), button:has-text("Iniciar")'
            ).count() > 0;
            const isLogin = hasPasswordField && (hasUserField || hasSubmit);
            this.loginPageCache = { url: url.toLowerCase(), isLogin, timestamp: Date.now() };
            return isLogin;
        } catch {
            this.loginPageCache = { url: url.toLowerCase(), isLogin: false, timestamp: Date.now() };
            return false;
        }
    }

    /**
     * Calcula el resultado final de la verificación
     */
    private calculateVerificationResult(
        context: ActionContext,
        evidence: VerificationResult['evidence'],
        preState: PreActionState
    ): VerificationResult {
        let confidence = 50; // Base
        const reasons: string[] = [];
        let shouldRetry = false;
        let suggestedAction: string | undefined;
        const onLoginPage = this.isLoginPage(preState.url) ||
            (!!this.loginPageCache && this.loginPageCache.url === preState.url && this.loginPageCache.isLogin);

        // === Reglas por tipo de acción ===

        switch (context.action) {
            case 'click':
                if (evidence.domChanged) {
                    confidence += 25;
                    reasons.push('DOM cambió después del click');
                }
                if (evidence.urlChanged) {
                    confidence += 25;
                    reasons.push('Navegó a nueva página');
                }
                if (evidence.newElementsAppeared) {
                    confidence += 15;
                    reasons.push('Aparecieron nuevos elementos');
                }
                if (!evidence.domChanged && !evidence.urlChanged) {
                    if (onLoginPage) {
                        // En login: asumir éxito optimista; la verificación real la hace loginVerifier
                        confidence += 10;
                        reasons.push('Login click: asumiendo envío asíncrono exitoso (verificación posterior)');
                    } else {
                        // Click sin cambio visible: puede ser SPA/panel/menú que no cambia URL. No bloquear el batch.
                        confidence -= 15;
                        reasons.push('No hubo cambios visibles (puede ser panel o menú SPA)');
                        if (!evidence.errorsDetected.length) {
                            confidence += 10;
                            reasons.push('Sin errores; se continúa');
                        } else {
                            shouldRetry = true;
                            suggestedAction = 'Intentar doble click o verificar si el elemento es clickeable';
                        }
                    }
                }
                break;

            case 'type':
                if (evidence.targetElementChanged || evidence.newElementsAppeared || evidence.domChanged) {
                    confidence += 35;
                    reasons.push('Input actualizado o cambios en UI detectados');
                } else if (!evidence.errorsDetected.length) {
                    if (onLoginPage) {
                        confidence += 25;
                        reasons.push('Login: texto ingresado sin errores, continuar');
                    } else {
                        confidence += 10;
                        reasons.push('No se detectaron cambios pero tampoco errores (Silent Success?)');
                    }
                } else {
                    confidence -= 25;
                    reasons.push('El texto no parece haberse ingresado');
                    shouldRetry = true;
                }
                break;

            case 'select':
            case 'selectTimeSlot':
                if (evidence.targetElementChanged || evidence.domChanged) {
                    confidence += 30;
                    reasons.push('Selección aplicada');
                }
                if (evidence.newElementsAppeared) {
                    confidence += 15;
                    reasons.push('UI actualizada tras selección');
                }
                break;

            case 'navigate':
                if (evidence.urlChanged) {
                    confidence += 45;
                    reasons.push('Navegación exitosa');
                } else {
                    confidence -= 40;
                    reasons.push('URL no cambió');
                    shouldRetry = true;
                }
                break;

            case 'scroll':
                // Scroll casi siempre funciona
                confidence += 20;
                if (evidence.newElementsAppeared) {
                    confidence += 25;
                    reasons.push('Scroll reveló nuevos elementos');
                }
                break;

            case 'wait':
                if (evidence.loadingComplete) {
                    confidence += 30;
                    reasons.push('Carga completada');
                }
                break;
        }

        // === Penalizaciones globales (suavizadas para sitios lentos/modales) ===

        const onlyValidationError =
            evidence.errorsDetected.length === 1 &&
            evidence.errorsDetected[0].includes('validación fallida');
        const hasPositiveEvidence =
            evidence.domChanged || evidence.urlChanged || evidence.newElementsAppeared || evidence.targetElementChanged;

        if (evidence.errorsDetected.length > 0) {
            if (onlyValidationError && hasPositiveEvidence) {
                confidence -= 10;
                reasons.push(`Nota: ${evidence.errorsDetected[0]} (no bloqueante)`);
            } else {
                confidence -= 35;
                reasons.push(`Errores detectados: ${evidence.errorsDetected[0]}`);
                shouldRetry = true;
            }
        }

        if (!evidence.loadingComplete) {
            if (onLoginPage) {
                confidence -= 0;
                reasons.push('Página de login puede seguir cargando (no bloqueante)');
            } else if (!hasPositiveEvidence) {
                confidence -= 15;
                reasons.push('Página aún cargando');
            } else {
                confidence -= 5;
                reasons.push('Página aún cargando (se ignora por cambios detectados)');
            }
        }

        // === Resultado final ===

        confidence = Math.max(0, Math.min(100, confidence));

        const allowSuccessWithValidation =
            onlyValidationError && hasPositiveEvidence && confidence >= 55;
        const noBlockingErrors =
            evidence.errorsDetected.length === 0 || allowSuccessWithValidation;

        return {
            success: confidence >= 55 && noBlockingErrors,
            confidence,
            reason: reasons.join('. '),
            shouldRetry,
            suggestedAction,
            evidence
        };
    }

    private fingerprintsEqual(a: PageFingerprint, b: PageFingerprint): boolean {
        return a.visibleElementsHash === b.visibleElementsHash &&
            a.hasModal === b.hasModal &&
            Math.abs(a.bodyLength - b.bodyLength) < 100;
    }

    private elementStatesEqual(a: ElementState | null, b: ElementState | null): boolean {
        if (!a || !b) return a === b;
        return a.text === b.text && a.value === b.value &&
            a.checked === b.checked && a.selected === b.selected;
    }
}
