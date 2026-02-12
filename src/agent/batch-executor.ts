
import { Page, BrowserContext } from 'playwright';
import { ActionDecision, BatchDecision } from './optimized-openai-client.js';
import { ActionVerifier, VerificationResult } from './action-verifier.js';
import { ElementResolver } from '../browser/element-resolver.js';
import { OptimizedSnapshot } from '../browser/optimized-snapshot.js';
import { SiteAdapter } from '../browser/site-adapters/base-adapter.js';
import { waitForPageReady, progressiveScroll } from '../browser/page-waits.js';

export interface BatchExecutionResult {
    totalActions: number;
    successfulActions: number;
    results: Array<{
        action: ActionDecision;
        success: boolean;
        verification?: VerificationResult;
        error?: string;
    }>;
    stoppedEarly: boolean;
    newPage?: Page; // Si se abrió una nueva pestaña, devolver la referencia
}

export class BatchActionExecutor {
    private verifier: ActionVerifier;
    private elementResolver: ElementResolver;

    constructor(verifier: ActionVerifier, elementResolver: ElementResolver) {
        this.verifier = verifier;
        this.elementResolver = elementResolver;
    }

    async executeBatch(
        page: Page,
        batch: BatchDecision,
        snapshot: OptimizedSnapshot,
        siteAdapter: SiteAdapter | null,
        context?: BrowserContext,
        credentials?: { email?: string; password?: string }
    ): Promise<BatchExecutionResult> {
        const results: BatchExecutionResult['results'] = [];
        let stop = false;
        let currentPage = page;
        let newPageOpened: Page | undefined;
        let consecutiveFailures = 0;

        console.log(`📦 Ejecutando batch de ${batch.actions.length} acciones...`);

        // Pre-check: Si hay modal activo, intentar cerrarlo primero
        if (snapshot.pageState.hasModal) {
            await this.tryCloseModal(currentPage);
        }

        for (const action of batch.actions) {
            if (stop) break;

            console.log(`   ▶️ ${action.action}${action.ref ? `[${action.ref}]` : ''} - ${action.why}`);

            try {
                // 1. Capturar estado previo
                const preState = await this.verifier.capturePreActionState(currentPage, {
                    targetRef: action.ref,
                    action: action.action
                });

                // 2. Ejecutar acción (con detección de nueva pestaña para clicks)
                if (action.action === 'click' && context) {
                    const result = await this.executeClickWithTabDetection(
                        currentPage, action, snapshot, siteAdapter, context, credentials
                    );
                    if (result.newPage) {
                        console.log(`   📑 Nueva pestaña detectada, cambiando contexto...`);
                        currentPage = result.newPage;
                        newPageOpened = result.newPage;
                    }
                } else {
                    await this.executeSingleAction(currentPage, action, snapshot, siteAdapter, credentials);
                }

                // 3. Espera inteligente
                await this.smartWait(currentPage, action);

                // 4. Verificar resultado (si no es 'wait' ni 'scroll')
                let success = true;
                let verification: VerificationResult | undefined;

                if (!['wait', 'scroll', 'done', 'back'].includes(action.action)) {
                    verification = await this.verifier.verifyAction(
                        currentPage,
                        { targetRef: action.ref, action: action.action },
                        preState
                    );
                    success = verification.success;
                }

                results.push({ action, success, verification });

                // Detener si falló una acción crítica
                if (!success) {
                    console.log(`   ⛔ Acción falló: ${verification?.reason || 'Unknown'}`);
                    stop = true;
                } else {
                    console.log(`   ✅ Completado`);
                }

            } catch (error) {
                console.error(`   ❌ Error ejecutando acción:`, error);
                results.push({ action, success: false, error: (error as Error).message });
                stop = true;
            }
        }

        return {
            totalActions: batch.actions.length,
            successfulActions: results.filter(r => r.success).length,
            results,
            stoppedEarly: stop,
            newPage: newPageOpened
        };
    }

    /**
     * Ejecuta un click detectando si se abre una nueva pestaña
     */
    private async executeClickWithTabDetection(
        page: Page,
        action: ActionDecision,
        snapshot: OptimizedSnapshot,
        siteAdapter: SiteAdapter | null,
        context: BrowserContext,
        credentials?: { email?: string; password?: string }
    ): Promise<{ newPage?: Page }> {
        // Escuchar evento de nueva página ANTES de hacer click
        const newPagePromise = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);

        // Ejecutar el click normal
        await this.executeSingleAction(page, action, snapshot, siteAdapter, credentials);

        // Verificar si se abrió nueva pestaña
        const newPage = await newPagePromise;

        if (newPage) {
            // Esperar a que la nueva página cargue
            await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
            console.log(`   🌐 Nueva pestaña abierta: ${newPage.url()}`);
            return { newPage };
        }

        return {};
    }

    private async executeSingleAction(
        page: Page,
        action: ActionDecision,
        snapshot: OptimizedSnapshot,
        siteAdapter: SiteAdapter | null,
        credentials?: { email?: string; password?: string }
    ): Promise<void> {

        // Acciones que no requieren elemento: saltar resolución si ref es inválido
        const actionsWithoutElement = ['wait', 'scroll', 'done', 'back'];
        const skipElementResolution = actionsWithoutElement.includes(action.action) && 
                                     (action.ref === 'page' || !snapshot.elements.find(e => e.ref === action.ref));

        // Resolver elemento si aplica
        let locator;
        if (action.ref && !skipElementResolution) {
            let element = snapshot.elements.find(e => e.ref === action.ref);

            // Si el elemento no existe en el snapshot, intentar recuperación
            if (!element) {
                console.log(`   ⚠️ Elemento ${action.ref} no está en snapshot, buscando alternativa...`);
                element = await this.findAlternativeElement(page, action, snapshot);
                if (element) {
                    console.log(`   ✅ Encontrado elemento alternativo: ${element.ref}`);
                }
            }

            if (element) {
                const resolved = await this.elementResolver.resolve(page, element, snapshot);
                if (resolved.found && resolved.locator) {
                    locator = resolved.locator;
                } else {
                    // Fallback a coordenadas si no hay locator
                    if (['click'].includes(action.action)) {
                        await page.mouse.click(
                            element.rect.x + element.rect.w / 2,
                            element.rect.y + element.rect.h / 2
                        );
                        return;
                    }
                    throw new Error(`Elemento ${action.ref} no encontrado en DOM`);
                }
            } else {
                // Último intento: buscar directamente en el DOM por selectores comunes
                locator = await this.findElementByAction(page, action);
                if (!locator) {
                    throw new Error(`Elemento ${action.ref} no encontrado - ni en snapshot ni en DOM`);
                }
                console.log(`   ✅ Encontrado elemento por selector directo`);
            }
        }

        switch (action.action) {
            case 'click':
                if (!locator) throw new Error('Click requiere referencia válida');
                try {
                    await locator.click({ timeout: 5000, noWaitAfter: true });
                } catch (clickError) {
                    const errorMsg = (clickError as Error).message;
                    // Detectar si hay un elemento interceptando (modal, overlay, popup)
                    if (errorMsg.includes('intercepts pointer events')) {
                        console.log('   🔄 Overlay detectado, intentando cerrar...');

                        // Estrategia 1: Presionar Escape
                        await page.keyboard.press('Escape');
                        await page.waitForTimeout(300);

                        // Estrategia 2: Buscar y clickear botones de aceptar cookies/GDPR primero
                        const gdprAcceptSelectors = [
                            '#consent_prompt_submit',  // Accept All
                            '#onetrust-accept-btn-handler',
                            'button:has-text("Accept all")',
                            'button:has-text("Accept All")',
                            'div[role="button"]:has-text("Accept All")',
                            'button:has-text("Aceptar todas")',
                            'button:has-text("Aceptar")',
                        ];

                        let gdprDismissed = false;
                        for (const selector of gdprAcceptSelectors) {
                            try {
                                const btn = page.locator(selector).first();
                                if (await btn.isVisible({ timeout: 500 })) {
                                    await btn.click({ timeout: 1000 });
                                    console.log('   🍪 Banner de cookies aceptado');
                                    await page.waitForTimeout(500);
                                    gdprDismissed = true;
                                    break;
                                }
                            } catch { /* continuar con siguiente selector */ }
                        }

                        // Estrategia 3: Buscar y clickear botón de cerrar si existe (solo si no se aceptó GDPR)
                        if (!gdprDismissed) {
                            const closeSelectors = [
                                '.close_btn_thick',  // GDPR close button
                                'button[aria-label="cerrar"]',
                                'button[aria-label="close"]',
                                'button[title="cerrar"]',
                                'button[title="close"]',
                                '[data-testid="close-button"]',
                                '.close-button',
                                '.modal-close',
                                '.gdprActive .close_btn_thick',
                                '.privacy_prompt .close_btn_thick'
                            ];

                            for (const selector of closeSelectors) {
                                try {
                                    const closeBtn = page.locator(selector).first();
                                    if (await closeBtn.isVisible({ timeout: 500 })) {
                                        await closeBtn.click({ timeout: 1000 });
                                        await page.waitForTimeout(300);
                                        break;
                                    }
                                } catch { /* continuar con siguiente selector */ }
                            }
                        }

                        // Reintentar click obligando force: true (fallback robusto)
                        console.log('   💪 Forzando click (fallback)...');
                        await page.waitForTimeout(500);
                        await locator.click({ timeout: 5000, force: true, noWaitAfter: true });
                    } else if (
                        errorMsg.includes('element is not enabled') ||
                        errorMsg.includes('not enabled') ||
                        (errorMsg.includes('Timeout') && (clickError as Error).toString().includes('not enabled'))
                    ) {
                        // Elemento deshabilitado (p. ej. día de calendario con aria-disabled) o timeout por no enabled
                        console.log('   🔄 Elemento deshabilitado o no clickeable, intentando click forzado...');
                        await locator.click({ timeout: 5000, force: true, noWaitAfter: true });
                    } else if (errorMsg.includes('outside of the viewport')) {
                        console.log('   🔄 Elemento fuera del viewport, intentando scroll...');
                        try {
                            // Intentar hacer scroll al elemento
                            await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
                            await page.waitForTimeout(500);
                            // Reintentar click después del scroll
                            await locator.click({ timeout: 5000, noWaitAfter: true });
                            console.log('   ✅ Click exitoso después de scroll');
                        } catch (scrollError) {
                            // Intentar cerrar posible modal con Escape primero
                            console.log('   ⌨️ Intentando cerrar modal con Escape...');
                            await page.keyboard.press('Escape');
                            await page.waitForTimeout(500);

                            try {
                                // Reintentar después de Escape
                                await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                                await locator.click({ timeout: 5000, noWaitAfter: true });
                                console.log('   ✅ Click exitoso después de cerrar modal');
                            } catch {
                                // Si el scroll falló, intentar con force: true como último recurso
                                console.log('   💪 Forzando click como último recurso...');
                                try {
                                    await locator.click({ timeout: 5000, force: true, noWaitAfter: true });
                                } catch {
                                    // Último recurso: click vía JavaScript (ignora viewport/overlay)
                                    try {
                                        await locator.first().evaluate((el: HTMLElement) => el.click());
                                        console.log('   ✅ Click exitoso vía JavaScript');
                                    } catch {
                                        throw new Error('Elemento no accesible incluso después de scroll y Escape');
                                    }
                                }
                            }
                        }
                    } else {
                        throw clickError;
                    }
                }
                break;

            case 'type':
                if (!locator) throw new Error('Type requiere referencia válida');

                // Determinar el valor real a escribir
                let valueToType = action.value || '';
                const targetElement = snapshot.elements.find(e => e.ref === action.ref);

                // Detectar si estamos en una página de login
                const isLoginPage = /\/(login|signin|auth|iniciar|acceder|front-end\/login|consumer\/login)/i.test(page.url());

                if (isLoginPage && targetElement && credentials) {
                    // Inyectar credenciales reales en campos de login
                    if (targetElement.type === 'password' && credentials.password) {
                        valueToType = credentials.password;
                        console.log('   🔐 Inyectando contraseña real en campo password');
                    } else if (
                        (targetElement.type === 'email' || targetElement.type === 'text' || !targetElement.type) &&
                        targetElement.isInput &&
                        credentials.email &&
                        // Heurística: el campo parece ser de email/usuario
                        (targetElement.placeholder?.toLowerCase().includes('email') ||
                            targetElement.placeholder?.toLowerCase().includes('correo') ||
                            targetElement.placeholder?.toLowerCase().includes('usuario') ||
                            targetElement.placeholder?.toLowerCase().includes('user') ||
                            targetElement.name?.toLowerCase().includes('email') ||
                            targetElement.name?.toLowerCase().includes('user') ||
                            targetElement.label?.toLowerCase().includes('email') ||
                            targetElement.label?.toLowerCase().includes('correo') ||
                            targetElement.label?.toLowerCase().includes('usuario') ||
                            targetElement.id?.toLowerCase().includes('email') ||
                            targetElement.id?.toLowerCase().includes('user') ||
                            targetElement.type === 'email')
                    ) {
                        valueToType = credentials.email;
                        console.log('   📧 Inyectando email real en campo de usuario');
                    }
                }

                if (isLoginPage) {
                    // En login: usar click + pressSequentially para máxima compatibilidad con SPAs
                    // fill() no dispara keydown/keyup/input events que Angular/React necesitan
                    try {
                        await locator.click({ timeout: 3000 }).catch(() => { });
                        await locator.clear().catch(() => { });
                        await locator.pressSequentially(valueToType, { delay: 30 });
                        console.log('   ⌨️ Login: escrito con pressSequentially (SPA compatible)');

                        // Si es campo password, presionar Enter para enviar el formulario
                        // Muchos SPAs no reaccionan al click del botón pero sí a Enter
                        if (targetElement?.type === 'password') {
                            await page.waitForTimeout(200);
                            await page.keyboard.press('Enter');
                            console.log('   ⏎ Login: Enter presionado después de contraseña');
                        }
                    } catch (loginTypeError: any) {
                        // Fallback a fill() si pressSequentially falla
                        console.log('   🔄 pressSequentially falló en login, intentando fill()...');
                        await locator.clear().catch(() => { });
                        await locator.fill(valueToType);
                        if (targetElement?.type === 'password') {
                            await page.waitForTimeout(200);
                            await page.keyboard.press('Enter');
                        }
                    }
                } else {
                    // Fuera de login: usar fill() (más rápido) con fallback a pressSequentially
                    await locator.clear().catch(() => { }); // Ignorar si no se puede limpiar

                    try {
                        await locator.fill(valueToType);
                    } catch (fillError: any) {
                        if (fillError.message.includes('Element is not an <input>')) {
                            console.log('   ⚠️ Elemento no es input, intentando escribir en elemento activo...');
                            await page.keyboard.type(valueToType);
                        } else {
                            // Fallback: pressSequentially para frameworks SPA
                            console.log('   🔄 fill() falló, intentando pressSequentially...');
                            try {
                                await locator.clear().catch(() => { });
                                await locator.pressSequentially(valueToType, { delay: 30 });
                            } catch {
                                throw fillError;
                            }
                        }
                    }
                }
                break;

            case 'select':
                if (!locator) throw new Error('Select requiere referencia válida');
                await locator.selectOption({ label: action.value });
                break;

            case 'scroll':
                await progressiveScroll(page, {
                    direction: action.value === 'up' ? 'up' : 'down',
                    stepPx: 400,
                    waitBetweenMs: 350,
                    maxSteps: action.value === 'up' ? 4 : 12,
                    stopWhenNoNewContent: true
                });
                break;

            case 'wait':
                // Si el ref es "page" o inválido, simplemente esperar sin buscar elemento
                if (action.ref === 'page' || skipElementResolution) {
                    console.log(`   ⏳ Esperando ${action.value ? parseInt(action.value) : 2000}ms...`);
                }
                const ms = action.value ? parseInt(action.value) : 2000;
                await page.waitForTimeout(ms);
                break;

            case 'selectTimeSlot':
                const targetTime = action.value || '';
                if (siteAdapter?.getTimeSlotStrategy) {
                    const strategy = siteAdapter.getTimeSlotStrategy();
                    if (strategy) {
                        const slots = await page.$$(strategy.slotSelector);
                        let clicked = false;
                        for (const slot of slots) {
                            const text = await slot.textContent();
                            if (text?.includes(targetTime)) {
                                await slot.click();
                                clicked = true;
                                break;
                            }
                        }
                        if (!clicked) throw new Error(`Slot ${targetTime} no encontrado`);
                    }
                } else {
                    await page.click(`text="${targetTime}"`);
                }
                break;

            case 'done':
                // No-op
                break;

            case 'back':
                // Navegar hacia atrás en el historial del navegador
                console.log('   🔙 Navegando hacia atrás...');
                await page.goBack({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {
                    console.log('   ⚠️ goBack falló, esperando...');
                });
                await waitForPageReady(page, { timeout: 5000 });
                break;

            default:
                console.warn(`Acción desconocida: ${action.action}`);
        }
    }

    private async smartWait(page: Page, action: ActionDecision): Promise<void> {
        // Tiempos base
        const baseWait = 300;

        // Si hay formulario de búsqueda tipo modal: dar tiempo a que se abra tras un click
        if (action.action === 'click') {
            const hasSearchModal = await page.evaluate(() => !!document.querySelector(
                '.elementor-search-form, [class*="search-form__container"], .search-form.fullscreen, [class*="search"] [class*="modal"]'
            )).catch(() => false);
            if (hasSearchModal) {
                await this.safeWait(page, 500);
            }
        }

        // Espera inteligente: página lista (readyState + sin loaders) en lugar de timeout fijo
        if (action.action === 'type' || action.action === 'click') {
            try {
                await waitForPageReady(page, { timeout: 4000 });
            } catch {
                await this.safeWait(page, 400);
            }
        } else {
            await this.safeWait(page, baseWait);
        }

        if (action.action === 'click') {
            const isLogin = /\/(login|signin|auth|iniciar|acceder|front-end\/login|consumer\/login)/i.test(page.url());
            try {
                const networkTimeout = isLogin ? 5000 : 2000;
                await page.waitForLoadState('networkidle', { timeout: networkTimeout }).catch(() => { });
            } catch { }
            // En login: esperar posible navegación a página post-login
            if (isLogin) {
                try {
                    await page.waitForURL(
                        url => !/\/(login|signin|auth|iniciar|acceder|front-end\/login|consumer\/login)/i.test(url.toString()),
                        { timeout: 5000 }
                    );
                } catch { /* aún en login, ok; loginVerifier se encarga */ }
            }
        }
    }

    /** Espera sin lanzar si la página/contexto/browser ya fue cerrado (ej. ejecución paralela). */
    private async safeWait(page: Page, ms: number): Promise<void> {
        try {
            await page.waitForTimeout(ms);
        } catch (e: any) {
            if (e?.message?.includes('has been closed')) return;
            throw e;
        }
    }

    /**
     * Busca un elemento alternativo cuando el ref original no existe en el snapshot
     */
    private async findAlternativeElement(
        page: Page,
        action: ActionDecision,
        snapshot: OptimizedSnapshot
    ): Promise<any | null> {
        // Si la acción tiene un valor (ej: type "tacos"), buscar input visible
        if (action.action === 'type') {
            // Buscar inputs de búsqueda en el snapshot
            const searchInputs = snapshot.elements.filter(e =>
                e.isInput &&
                !e.isDisabled &&
                (e.testId?.includes('search') ||
                    e.testId?.includes('autocomplete') ||
                    e.placeholder?.toLowerCase().includes('buscar') ||
                    e.placeholder?.toLowerCase().includes('search') ||
                    e.placeholder?.toLowerCase().includes('ubicación') ||
                    e.ariaLabel?.toLowerCase().includes('buscar') ||
                    e.id?.includes('autocomplete'))
            );
            if (searchInputs.length > 0) {
                return searchInputs[0];
            }

            // Cualquier input de texto visible
            const anyInput = snapshot.elements.find(e =>
                e.isInput && !e.isDisabled && e.tag === 'input'
            );
            if (anyInput) return anyInput;
        }

        // Si es click y el valor indica algo, buscar por texto
        if (action.action === 'click' && action.value) {
            const byText = snapshot.elements.find(e =>
                e.text?.toLowerCase().includes(action.value!.toLowerCase()) ||
                e.ariaLabel?.toLowerCase().includes(action.value!.toLowerCase())
            );
            if (byText) return byText;
        }

        // Buscar botones de acción comunes
        if (action.action === 'click') {
            const why = action.why?.toLowerCase() || '';

            if (why.includes('buscar') || why.includes('search')) {
                const searchBtn = snapshot.elements.find(e =>
                    (e.isButton || e.role === 'button') &&
                    (e.text?.toLowerCase().includes('buscar') ||
                        e.text?.toLowerCase().includes('vamos') ||
                        e.ariaLabel?.toLowerCase().includes('buscar') ||
                        e.ariaLabel?.toLowerCase().includes('vamos') ||
                        e.testId?.includes('search'))
                );
                if (searchBtn) return searchBtn;
            }
        }

        return null;
    }

    /**
     * Busca directamente en el DOM cuando no hay elemento en snapshot
     */
    private async findElementByAction(page: Page, action: ActionDecision): Promise<any | null> {
        try {
            if (action.action === 'type') {
                // Buscar inputs de búsqueda comunes
                const selectors = [
                    'input[data-test*="search"]',
                    'input[data-test*="autocomplete"]',
                    'input[id*="autocomplete"]',
                    'input[placeholder*="buscar" i]',
                    'input[placeholder*="search" i]',
                    'input[placeholder*="ubicación" i]',
                    'input[aria-label*="buscar" i]',
                    'input:visible:not([type="hidden"])'
                ];

                for (const selector of selectors) {
                    try {
                        const loc = page.locator(selector).first();
                        if (await loc.isVisible({ timeout: 500 })) {
                            return loc;
                        }
                    } catch { }
                }
            }

            if (action.action === 'click') {
                const why = action.why?.toLowerCase() || '';

                if (why.includes('buscar') || why.includes('search')) {
                    const selectors = [
                        'button[aria-label*="Vamos" i]',
                        'button[aria-label*="buscar" i]',
                        'button:has-text("Vamos")',
                        'button:has-text("Buscar")'
                    ];

                    for (const selector of selectors) {
                        try {
                            const loc = page.locator(selector).first();
                            if (await loc.isVisible({ timeout: 500 })) {
                                return loc;
                            }
                        } catch { }
                    }
                }
            }
        } catch (e) {
            // Silenciar errores de búsqueda
        }

        return null;
    }

    /**
     * Intenta cerrar modales que puedan estar bloqueando la interacción
     */
    private async tryCloseModal(page: Page): Promise<boolean> {
        console.log('   🔄 Intentando cerrar modal automáticamente...');

        // Estrategia 1: Buscar botón de cerrar común
        const closeSelectors = [
            'button[aria-label*="close" i]',
            'button[aria-label*="cerrar" i]',
            'button[aria-label*="dismiss" i]',
            '[data-testid="close-button"]',
            '[data-testid="modal-close"]',
            '.modal-close',
            '.close-button',
            '.btn-close',
            'button:has-text("×")',
            'button:has-text("X")',
            '[role="dialog"] button:first-child'
        ];

        for (const selector of closeSelectors) {
            try {
                const closeBtn = page.locator(selector).first();
                if (await closeBtn.isVisible({ timeout: 500 })) {
                    await closeBtn.click({ timeout: 2000 });
                    await page.waitForTimeout(500);
                    console.log('   ✅ Modal cerrado con botón');
                    return true;
                }
            } catch { /* continuar */ }
        }

        // Estrategia 2: Presionar Escape
        try {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            console.log('   ⌨️ Escape enviado');
            return true;
        } catch { /* continuar */ }

        // Estrategia 3: Click fuera del modal (en el backdrop)
        try {
            const backdrop = page.locator('[class*="backdrop"], [class*="overlay"], .modal-backdrop').first();
            if (await backdrop.isVisible({ timeout: 500 })) {
                await backdrop.click({ position: { x: 10, y: 10 }, force: true });
                await page.waitForTimeout(500);
                console.log('   🖱️ Click en backdrop');
                return true;
            }
        } catch { /* continuar */ }

        return false;
    }
}
