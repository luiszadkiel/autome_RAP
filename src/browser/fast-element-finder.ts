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
                    return await page.$(strategy.value);

                case 'xpath':
                    if (!strategy.value) return null;
                    // Check if it already starts with xpath= or //
                    const xpath = strategy.value.startsWith('//') || strategy.value.startsWith('xpath=')
                        ? strategy.value
                        : `xpath=${strategy.value}`;
                    return await page.$(xpath);

                case 'text':
                    if (!strategy.value) return null;
                    return await page.getByText(strategy.value).elementHandle();

                case 'role':
                    if (!strategy.role) return null;
                    return await page.getByRole(strategy.role as any, {
                        name: strategy.name
                    }).elementHandle();

                default:
                    return null;
            }
        } catch (e) {
            return null;
        }
    }
}
