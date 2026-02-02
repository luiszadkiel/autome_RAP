/**
 * Fast Element Finder - Finds elements using parallel strategies
 */

import type { Page, ElementHandle } from 'playwright';

export interface SelectorStrategy {
    type: 'css' | 'xpath' | 'text' | 'role';
    value?: string;
    role?: string;
    name?: string;
    priority: number;
}

export class FastElementFinder {
    /**
     * Find an element using multiple strategies in parallel
     * Returns the first one that resolves
     */
    async findElement(
        page: Page,
        strategies: SelectorStrategy[]
    ): Promise<ElementHandle | null> {

        // Execute ALL strategies in parallel
        const promises = strategies.map(async (strategy) => {
            try {
                const result = await this.tryStrategy(page, strategy);
                if (result && await result.isVisible()) {
                    return { element: result, strategy };
                }
                return null;
            } catch {
                return null;
            }
        });

        // Use Promise.race logic but properly handled for nulls
        // We want the first *successful* result, not just the first settled promise
        // If all fail, we return null

        // We wrap this because Promise.race returns the first settled, even if null/rejected
        // We want the first NON-NULL result preferably

        return new Promise((resolve) => {
            let pending = promises.length;
            let resolved = false;

            promises.forEach(p => {
                p.then(result => {
                    if (resolved) return;
                    if (result) {
                        resolved = true;
                        resolve(result.element);
                    } else {
                        pending--;
                        if (pending === 0) resolve(null);
                    }
                }).catch(() => {
                    if (resolved) return;
                    pending--;
                    if (pending === 0) resolve(null);
                });
            });
        });
    }

    private async tryStrategy(
        page: Page,
        strategy: SelectorStrategy
    ): Promise<ElementHandle | null> {
        // Short timeout for individual strategies so slow (xpath) ones don't block
        // However, Playwright calls are async and we are racing them

        try {
            switch (strategy.type) {
                case 'css':
                    if (!strategy.value) return null;
                    try {
                        const loc = page.locator(strategy.value);
                        // Filter for visible elements first since snapshot only includes visible ones
                        const visibleLoc = loc.filter({ visible: true });
                        if (await visibleLoc.count() > 0) {
                            return await visibleLoc.first().elementHandle();
                        }
                        return await page.$(strategy.value);
                    } catch (e) {
                        return null;
                    }

                case 'xpath':
                    if (!strategy.value) return null;
                    try {
                        const xpath = strategy.value.startsWith('//') || strategy.value.startsWith('xpath=')
                            ? strategy.value
                            : `xpath=${strategy.value}`;
                        const loc = page.locator(xpath);
                        const visibleLoc = loc.filter({ visible: true });
                        if (await visibleLoc.count() > 0) {
                            return await visibleLoc.first().elementHandle();
                        }
                        return await page.$(xpath);
                    } catch (e) {
                        return null;
                    }

                case 'text':
                    if (!strategy.value) return null;
                    try {
                        const loc = page.getByText(strategy.value);
                        const visibleLoc = loc.filter({ visible: true });
                        if (await visibleLoc.count() > 0) {
                            return await visibleLoc.first().elementHandle();
                        }
                        return await loc.elementHandle();
                    } catch (e) {
                        return null;
                    }

                case 'role':
                    if (!strategy.role) return null;
                    try {
                        const loc = page.getByRole(strategy.role as any, { name: strategy.name });
                        const visibleLoc = loc.filter({ visible: true });
                        if (await visibleLoc.count() > 0) {
                            return await visibleLoc.first().elementHandle();
                        }
                        return await loc.elementHandle();
                    } catch (e) {
                        return null;
                    }

                default:
                    return null;
            }
        } catch (e) {
            return null;
        }
    }
}
