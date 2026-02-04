
import { Page } from 'playwright';
import { ActionDecision, BatchDecision } from './optimized-openai-client.js';
import { ActionVerifier, VerificationResult } from './action-verifier.js';
import { ElementResolver } from '../browser/element-resolver.js';
import { OptimizedSnapshot } from '../browser/optimized-snapshot.js';
import { SiteAdapter } from '../browser/site-adapters/base-adapter.js';

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
        siteAdapter: SiteAdapter | null
    ): Promise<BatchExecutionResult> {
        const results: BatchExecutionResult['results'] = [];
        let stop = false;

        console.log(`📦 Ejecutando batch de ${batch.actions.length} acciones...`);

        for (const action of batch.actions) {
            if (stop) break;

            console.log(`   ▶️ ${action.action}${action.ref ? `[${action.ref}]` : ''} - ${action.why}`);

            try {
                // 1. Capturar estado previo
                const preState = await this.verifier.capturePreActionState(page, {
                    targetRef: action.ref,
                    action: action.action
                });

                // 2. Ejecutar acción
                await this.executeSingleAction(page, action, snapshot, siteAdapter);

                // 3. Espera inteligente
                await this.smartWait(page, action);

                // 4. Verificar resultado (si no es 'wait' ni 'scroll')
                let success = true;
                let verification: VerificationResult | undefined;

                if (!['wait', 'scroll', 'done'].includes(action.action)) {
                    verification = await this.verifier.verifyAction(
                        page,
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
            stoppedEarly: stop
        };
    }

    private async executeSingleAction(
        page: Page,
        action: ActionDecision,
        snapshot: OptimizedSnapshot,
        siteAdapter: SiteAdapter | null
    ): Promise<void> {

        // Resolver elemento si aplica
        let locator;
        if (action.ref) {
            const element = snapshot.elements.find(e => e.ref === action.ref);
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
            }
        }

        switch (action.action) {
            case 'click':
                if (!locator) throw new Error('Click requiere referencia válida');
                try {
                    await locator.click({ timeout: 5000 });
                } catch (clickError) {
                    const errorMsg = (clickError as Error).message;
                    // Detectar si hay un elemento interceptando (modal, overlay, popup)
                    if (errorMsg.includes('intercepts pointer events')) {
                        console.log('   🔄 Overlay detectado, intentando cerrar...');
                        
                        // Estrategia 1: Presionar Escape
                        await page.keyboard.press('Escape');
                        await page.waitForTimeout(300);
                        
                        // Estrategia 2: Buscar y clickear botón de cerrar si existe
                        const closeSelectors = [
                            'button[aria-label="cerrar"]',
                            'button[aria-label="close"]',
                            'button[title="cerrar"]',
                            'button[title="close"]',
                            '[data-testid="close-button"]',
                            '.close-button',
                            '.modal-close'
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
                        
                        // Reintentar click original
                        await page.waitForTimeout(500);
                        await locator.click({ timeout: 5000 });
                    } else {
                        throw clickError;
                    }
                }
                break;

            case 'type':
                if (!locator) throw new Error('Type requiere referencia válida');
                await locator.fill(action.value || '');
                break;

            case 'select':
                if (!locator) throw new Error('Select requiere referencia válida');
                await locator.selectOption({ label: action.value });
                break;

            case 'scroll':
                const amount = action.value === 'up' ? -400 : 400;
                await page.evaluate((y) => window.scrollBy(0, y), amount);
                break;

            case 'wait':
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

            default:
                console.warn(`Acción desconocida: ${action.action}`);
        }
    }

    private async smartWait(page: Page, action: ActionDecision): Promise<void> {
        // Tiempos base
        const baseWait = 300;

        // Estrategia de espera basada en el tipo de acción
        if (action.action === 'type' || action.action === 'click') {
            try {
                // Esperar a que el DOM se estabilice (silencio de mutaciones)
                await page.evaluate(() => {
                    return new Promise<void>((resolve) => {
                        let timeout: any;
                        const observer = new MutationObserver(() => {
                            clearTimeout(timeout);
                            // Reiniciar temporizador si hubo cambios
                            timeout = setTimeout(() => {
                                observer.disconnect();
                                resolve();
                            }, 500); // 500ms de silencio requerido
                        });

                        observer.observe(document.body, {
                            childList: true,
                            subtree: true,
                            attributes: true,
                            attributeFilter: ['class', 'style', 'aria-expanded', 'hidden']
                        });

                        // Timeout de seguridad máximo por si la página tiene animaciones infinitas
                        setTimeout(() => {
                            observer.disconnect();
                            resolve();
                        }, 2000);
                    });
                });
            } catch (e) {
                // Fallback seguro si falla el observer
                await page.waitForTimeout(1000);
            }
        } else {
            // Para otras acciones (scroll, etc), espera simple
            await page.waitForTimeout(baseWait);
        }

        // Si fue un click, dar un extra por si hay redirección
        if (action.action === 'click') {
            try {
                await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });
            } catch { }
        }
    }
}
