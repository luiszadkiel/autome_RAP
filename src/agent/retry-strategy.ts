import { Page } from 'playwright';
import { ActionVerifier, VerificationResult, ActionContext } from './action-verifier.js';

export interface RetryConfig {
    maxRetries: number;
    delayBetweenRetries: number;
    strategies: RecoveryStrategy[];
}

export type RecoveryStrategy =
    | 'wait_longer'
    | 'scroll_to_element'
    | 'close_modal'
    | 'click_away'
    | 'refresh_page'
    | 'try_alternate_selector';

export class RetryManager {
    private verifier: ActionVerifier;

    constructor(verifier: ActionVerifier) {
        this.verifier = verifier;
    }

    async executeWithRetry(
        page: Page,
        action: () => Promise<void>,
        context: ActionContext,
        config: RetryConfig = this.getDefaultConfig()
    ): Promise<{ success: boolean; attempts: number; finalResult: VerificationResult }> {

        let lastResult: VerificationResult | null = null;

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            // Capturar estado pre-acción
            let preState;
            try {
                preState = await this.verifier.capturePreActionState(page, context);
            } catch (e) {
                // If capture fails (e.g. navigation race), we proceed carefully
                console.warn('Could not capture pre-action state:', e);
                preState = { url: page.url(), fingerprint: { url: page.url(), title: '', elementCount: 0, visibleElementsHash: '', hasModal: false, activeFormInputs: 0, bodyLength: 0 }, targetState: null, timestamp: Date.now() };
            }

            try {
                // Ejecutar la acción
                await action();

                // Verificar resultado
                lastResult = await this.verifier.verifyAction(page, context, preState);

                if (lastResult.success) {
                    return { success: true, attempts: attempt + 1, finalResult: lastResult };
                }

                // Si falló, intentar estrategia de recuperación
                if (attempt < config.maxRetries) {
                    const strategy = this.selectRecoveryStrategy(lastResult, attempt);
                    console.log(`🔄 Intento ${attempt + 1} falló. Aplicando estrategia: ${strategy}`);

                    await this.applyRecoveryStrategy(page, strategy, context);
                    await page.waitForTimeout(config.delayBetweenRetries);
                }

            } catch (error) {
                console.error(`❌ Error en intento ${attempt + 1}:`, error);

                if (attempt < config.maxRetries) {
                    await this.applyRecoveryStrategy(page, 'wait_longer', context);
                }
            }
        }

        return {
            success: false,
            attempts: config.maxRetries + 1,
            finalResult: lastResult || {
                success: false,
                confidence: 0,
                reason: 'Todos los intentos fallaron',
                shouldRetry: false,
                evidence: {} as any,
                suggestedAction: (lastResult as any)?.suggestedAction,
            }
        };
    }

    private selectRecoveryStrategy(
        result: VerificationResult,
        attemptNumber: number
    ): RecoveryStrategy {
        // Estrategia basada en el problema detectado

        if (!result.evidence.loadingComplete) {
            return 'wait_longer';
        }

        if (result.evidence.errorsDetected.length > 0) {
            return 'click_away'; // Cerrar mensaje de error
        }

        if (!result.evidence.domChanged && attemptNumber === 0) {
            return 'scroll_to_element';
        }

        if (attemptNumber === 1) {
            return 'close_modal';
        }

        if (attemptNumber >= 2) {
            return 'refresh_page';
        }

        return 'wait_longer';
    }

    private async applyRecoveryStrategy(
        page: Page,
        strategy: RecoveryStrategy,
        context: ActionContext
    ): Promise<void> {
        switch (strategy) {
            case 'wait_longer':
                await page.waitForTimeout(2000);
                try {
                    await page.waitForLoadState('networkidle', { timeout: 5000 });
                } catch { /* timeout ok */ }
                break;

            case 'scroll_to_element':
                if (context.targetRef) {
                    const ref = context.targetRef;
                    await page.evaluate((ref) => {
                        let el: HTMLElement | null = null;
                        if (ref.startsWith('e') && !isNaN(parseInt(ref.slice(1)))) {
                            const index = parseInt(ref.replace('e', '')) - 1;
                            const elements = document.querySelectorAll('button, input, select, a');
                            if (index >= 0 && index < elements.length) {
                                el = elements[index] as HTMLElement;
                            }
                        }
                        if (!el) {
                            el = document.querySelector(`[data-ref="${ref}"]`) as HTMLElement;
                        }

                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, ref);
                    await page.waitForTimeout(500);
                }
                break;

            case 'close_modal':
                // Intentar cerrar cualquier modal abierto
                const closeSelectors = [
                    '[aria-label="close"]', '[aria-label="cerrar"]',
                    '.modal .close', '.modal-close', 'button.close',
                    '[data-dismiss="modal"]', '.popup-close'
                ];

                for (const selector of closeSelectors) {
                    try {
                        const closeBtn = page.locator(selector).first();
                        if (await closeBtn.isVisible({ timeout: 500 })) {
                            await closeBtn.click();
                            await page.waitForTimeout(300);
                            break;
                        }
                    } catch { /* no existe */ }
                }

                // También intentar presionar Escape
                await page.keyboard.press('Escape');
                break;

            case 'click_away':
                // Click en área vacía para cerrar popups
                await page.click('body', { position: { x: 10, y: 10 } });
                await page.waitForTimeout(300);
                break;

            case 'refresh_page':
                await page.reload({ waitUntil: 'networkidle' });
                break;

            case 'try_alternate_selector':
                // Esta estrategia se maneja en el action executor
                break;
        }
    }

    private getDefaultConfig(): RetryConfig {
        return {
            maxRetries: 2,
            delayBetweenRetries: 1000,
            strategies: ['wait_longer', 'scroll_to_element', 'close_modal']
        };
    }
}
