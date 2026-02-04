import { Page, Locator } from 'playwright';
import { OptimizedElement } from './optimized-snapshot.js';

export interface ResolveResult {
    found: boolean;
    locator: Locator | null;
    method: string;
    confidence: number;
}

export class ElementResolver {

    /**
     * Encuentra un elemento usando múltiples estrategias
     */
    async resolve(
        page: Page,
        element: OptimizedElement,
        snapshot: { elements: OptimizedElement[] }
    ): Promise<ResolveResult> {
        const strategies = [
            () => this.byTestId(page, element),
            () => this.byExactText(page, element),
            () => this.byRole(page, element),
            () => this.byPlaceholder(page, element),
            () => this.byPosition(page, element),
            () => this.byIndex(page, element, snapshot)
        ];

        for (const strategy of strategies) {
            const result = await strategy();
            if (result.found) {
                return result;
            }
        }

        return { found: false, locator: null, method: 'none', confidence: 0 };
    }

    private async byTestId(page: Page, el: OptimizedElement): Promise<ResolveResult> {
        if (!el.testId) return { found: false, locator: null, method: 'testId', confidence: 0 };

        const locator = page.getByTestId(el.testId);
        const count = await locator.count();

        return {
            found: count === 1,
            locator: count === 1 ? locator : null,
            method: 'testId',
            confidence: 100
        };
    }

    private async byExactText(page: Page, el: OptimizedElement): Promise<ResolveResult> {
        if (!el.text || el.text.length < 2) return { found: false, locator: null, method: 'text', confidence: 0 };

        // Intentar texto exacto primero
        let locator = page.getByText(el.text, { exact: true });
        let count = await locator.count();

        if (count === 1) {
            return { found: true, locator, method: 'exactText', confidence: 95 };
        }

        // Intentar texto parcial
        if (el.text.length > 10) {
            locator = page.getByText(el.text.slice(0, 20));
            count = await locator.count();

            if (count === 1) {
                return { found: true, locator, method: 'partialText', confidence: 80 };
            }
        }

        return { found: false, locator: null, method: 'text', confidence: 0 };
    }

    private async byRole(page: Page, el: OptimizedElement): Promise<ResolveResult> {
        const roleMap: Record<string, string> = {
            'button': 'button',
            'a': 'link',
            'input': 'textbox',
            'select': 'combobox'
        };

        const role = el.role || roleMap[el.tag];
        if (!role) return { found: false, locator: null, method: 'role', confidence: 0 };

        const options: any = {};
        if (el.text) options.name = el.text;
        if (el.ariaLabel) options.name = el.ariaLabel;

        try {
            const locator = page.getByRole(role as any, options);
            const count = await locator.count();

            if (count === 1) {
                return { found: true, locator, method: 'role', confidence: 90 };
            }
        } catch {
            // Role inválido
        }

        return { found: false, locator: null, method: 'role', confidence: 0 };
    }

    private async byPlaceholder(page: Page, el: OptimizedElement): Promise<ResolveResult> {
        if (!el.placeholder) return { found: false, locator: null, method: 'placeholder', confidence: 0 };

        const locator = page.getByPlaceholder(el.placeholder);
        const count = await locator.count();

        return {
            found: count === 1,
            locator: count === 1 ? locator : null,
            method: 'placeholder',
            confidence: 85
        };
    }

    private async byPosition(page: Page, el: OptimizedElement): Promise<ResolveResult> {
        if (!el.rect) return { found: false, locator: null, method: 'position', confidence: 0 };

        // Construir selector CSS basado en tag y posición aproximada
        const selector = el.tag;
        const locator = page.locator(selector);

        // Filtrar por posición
        const filtered = locator.filter({
            has: page.locator('visible=true')
        });

        const elements = await filtered.all();

        for (const element of elements) {
            const box = await element.boundingBox();
            if (box) {
                const distance = Math.sqrt(
                    Math.pow(box.x - el.rect.x, 2) + Math.pow(box.y - el.rect.y, 2)
                );

                // Si está muy cerca de la posición esperada
                if (distance < 30) {
                    return { found: true, locator: element, method: 'position', confidence: 70 };
                }
            }
        }

        return { found: false, locator: null, method: 'position', confidence: 0 };
    }

    private async byIndex(
        page: Page,
        el: OptimizedElement,
        snapshot: { elements: OptimizedElement[] }
    ): Promise<ResolveResult> {
        // Usar el índice del ref como último recurso
        const index = parseInt(el.ref.replace('e', '')) - 1;

        const selector = `${el.tag}:visible`;
        const locator = page.locator(selector).nth(index);

        try {
            const count = await locator.count();
            if (count === 1) {
                // Verificar que el texto coincide
                const text = await locator.textContent();
                const textMatches = text?.includes(el.text?.slice(0, 10) || '');

                return {
                    found: true,
                    locator,
                    method: 'index',
                    confidence: textMatches ? 60 : 40
                };
            }
        } catch {
            // Índice fuera de rango
        }

        return { found: false, locator: null, method: 'index', confidence: 0 };
    }
}
