/**
 * Waits inteligentes y scroll progresivo (lazy load, fin de contenido).
 */

import type { Page } from 'playwright';

/** Espera a que document.readyState === 'complete' y no haya indicadores de carga visibles */
export async function waitForPageReady(
    page: Page,
    options?: { timeout?: number; loaderSelectors?: string }
): Promise<void> {
    const timeout = options?.timeout ?? 10000;
    const loaderSelectors = options?.loaderSelectors ?? '.loading, .spinner, .loader, [class*="loading"], [aria-busy="true"]';
    await page.waitForFunction(
        (sel: string) => {
            if (document.readyState !== 'complete') return false;
            const loaders = document.querySelectorAll(sel);
            for (let i = 0; i < loaders.length; i++) {
                const el = loaders[i] as HTMLElement;
                if (el && el.offsetParent !== null) {
                    const style = getComputedStyle(el);
                    if (style.display !== 'none' && style.visibility !== 'hidden') return false;
                }
            }
            return true;
        },
        loaderSelectors,
        { timeout }
    ).catch(() => {});
}

export interface ProgressiveScrollOptions {
    direction?: 'down' | 'up';
    stepPx?: number;
    waitBetweenMs?: number;
    maxSteps?: number;
    /** Dejar de hacer scroll cuando la altura del documento no crece tras un paso */
    stopWhenNoNewContent?: boolean;
}

/**
 * Scroll progresivo: avanza por pasos con espera entre cada uno (útil para lazy load e infinite scroll).
 * Devuelve cuando no hay más contenido nuevo o se alcanza maxSteps.
 */
export async function progressiveScroll(
    page: Page,
    options: ProgressiveScrollOptions = {}
): Promise<void> {
    const {
        direction = 'down',
        stepPx = 400,
        waitBetweenMs = 400,
        maxSteps = 15,
        stopWhenNoNewContent = true
    } = options;
    const delta = direction === 'down' ? stepPx : -stepPx;
    let lastHeight = 0;
    let stableCount = 0;
    for (let step = 0; step < maxSteps; step++) {
        const before = await page.evaluate(() => ({
            scrollHeight: document.documentElement.scrollHeight,
            scrollY: window.scrollY,
            innerHeight: window.innerHeight
        }));
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(waitBetweenMs);
        const after = await page.evaluate(() => ({
            scrollHeight: document.documentElement.scrollHeight,
            scrollY: window.scrollY
        }));
        if (stopWhenNoNewContent) {
            if (after.scrollHeight === lastHeight && after.scrollHeight > 0) {
                stableCount++;
                if (stableCount >= 2) break;
            } else {
                stableCount = 0;
            }
            lastHeight = after.scrollHeight;
            const noMovement = direction === 'down'
                ? after.scrollY <= before.scrollY && after.scrollY + before.innerHeight >= after.scrollHeight - 10
                : after.scrollY >= before.scrollY && after.scrollY <= 10;
            if (noMovement) break;
        }
    }
}
