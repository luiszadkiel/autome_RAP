/**
 * Playwright Browser Adapter - Implements BrowserAdapter for domain
 */

import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import { BrowserAdapter } from '../../domain/services/FlowExecutionService.js';
import { progressiveScroll } from '../../browser/page-waits.js';


export interface PlaywrightConfig {
    headless: boolean;
    timeout: number;
    viewport?: { width: number; height: number };
}

export class PlaywrightBrowserAdapter implements BrowserAdapter {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private config: PlaywrightConfig;

    constructor(config: PlaywrightConfig) {
        this.config = config;
    }

    /**
     * Launch browser
     */
    async launch(): Promise<void> {
        this.browser = await chromium.launch({
            headless: this.config.headless,
        });

        this.context = await this.browser.newContext({
            viewport: this.config.viewport || { width: 1280, height: 720 },
            acceptDownloads: true,
        });

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(this.config.timeout);
    }

    /**
     * Close browser
     */
    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
        }
    }

    async goto(url: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle').catch(() => { });
    }

    async click(selector: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.click(selector, { timeout: 10000 });
        await this.page.waitForLoadState('networkidle').catch(() => { });
    }

    async type(selector: string, value: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.fill(selector, value, { timeout: 10000 });
    }

    async select(selector: string, value: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.selectOption(selector, value, { timeout: 10000 });
    }

    async wait(options: { text?: string; selector?: string; timeout?: number }): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        const timeout = options.timeout || 10000;

        if (options.text) {
            await this.page.getByText(options.text).waitFor({ timeout });
        } else if (options.selector) {
            await this.page.waitForSelector(options.selector, { timeout });
        } else {
            await this.page.waitForLoadState('networkidle', { timeout });
        }
    }

    async scroll(direction: 'up' | 'down'): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await progressiveScroll(this.page, {
            direction,
            stepPx: 500,
            waitBetweenMs: 300,
            maxSteps: direction === 'down' ? 10 : 3,
            stopWhenNoNewContent: true
        });
    }

    async screenshot(path: string): Promise<string> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.screenshot({ path, fullPage: false });
        return path;
    }

    getUrl(): string {
        if (!this.page) throw new Error('Browser not launched');
        return this.page.url();
    }

    async getHtml(selector?: string): Promise<string> {
        if (!this.page) throw new Error('Browser not launched');
        if (selector) {
            const element = await this.page.$(selector);
            if (!element) return '';
            return element.innerHTML();
        }
        return this.page.content();
    }

    async findElement(selectors: string[]): Promise<string | null> {
        if (!this.page) throw new Error('Browser not launched');

        for (const selector of selectors) {
            try {
                const element = await this.page.$(selector);
                if (element) {
                    const isVisible = await element.isVisible();
                    if (isVisible) return selector;
                }
            } catch {
                // Try next selector
            }
        }
        return null;
    }

    /**
     * Get interactive elements on page
     */
    async getInteractiveElements(): Promise<Array<{
        ref: string;
        role: string;
        name: string;
        selector: string;
    }>> {
        if (!this.page) throw new Error('Browser not launched');

        const elements: Array<{ ref: string; role: string; name: string; selector: string }> = [];
        let refCounter = 1;

        const selectors = [
            'button',
            'a[href]',
            'input',
            'textarea',
            'select',
            '[role="button"]',
            '[role="link"]',
        ];

        for (const selector of selectors) {
            try {
                const locators = await this.page.locator(selector).all();
                for (const locator of locators.slice(0, 30)) {
                    try {
                        const isVisible = await locator.isVisible();
                        if (!isVisible) continue;

                        const tagName = await locator.evaluate(el => el.tagName.toLowerCase());
                        const name = await this.getElementName(locator);
                        if (!name) continue;

                        elements.push({
                            ref: `e${refCounter++}`,
                            role: this.getRole(tagName),
                            name,
                            selector,
                        });
                    } catch {
                        // Skip
                    }
                }
            } catch {
                // Skip
            }
        }

        return elements;
    }

    private getRole(tagName: string): string {
        const map: Record<string, string> = {
            button: 'button',
            a: 'link',
            input: 'textbox',
            textarea: 'textbox',
            select: 'combobox',
        };
        return map[tagName] || 'generic';
    }

    private async getElementName(locator: Locator): Promise<string> {
        try {
            const ariaLabel = await locator.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;

            const text = await locator.innerText().catch(() => '');
            if (text && text.length < 100) return text.trim();

            const placeholder = await locator.getAttribute('placeholder');
            if (placeholder) return placeholder;

            const title = await locator.getAttribute('title');
            if (title) return title;

            return '';
        } catch {
            return '';
        }
    }
}
