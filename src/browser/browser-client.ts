/**
 * Browser Client - Controls Chromium browser via Playwright
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { join } from 'path';
import type { BrowserConfig, PageSnapshot, SnapshotElement, VisionSnapshot } from '../core/types.js';
import { FastElementFinder, type SelectorStrategy } from './fast-element-finder.js';
import { EnhancedSnapshot } from './enhanced-snapshot.js';

// Script envuelto en IIFE para evitar "Illegal return statement"
const SNAPSHOT_SCRIPT = `
(() => {
    const results = [];
    let refCounter = 1;

    function getUniqueSelector(el) {
        if (el.id) return '#' + el.id;
        
        const name = el.getAttribute('name');
        if (name) return '[name="' + name + '"]';
        
        const dataTestId = el.getAttribute('data-testid');
        if (dataTestId) return '[data-testid="' + dataTestId + '"]';
        
        const tag = el.tagName.toLowerCase();
        const parent = el.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
            if (siblings.length > 1) {
                const index = siblings.indexOf(el) + 1;
                return tag + ':nth-of-type(' + index + ')';
            }
        }
        return tag;
    }

    function getXPath(el) {
        const parts = [];
        let current = el;
        
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === current.tagName) index++;
                sibling = sibling.previousElementSibling;
            }
            parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
            current = current.parentElement;
        }
        return '/' + parts.join('/');
    }

    const interactiveSelectors = [
        'button', 'a[href]', 'input', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[onclick]'
    ];

    for (const selector of interactiveSelectors) {
        const nodeList = document.querySelectorAll(selector);
        for (let i = 0; i < Math.min(nodeList.length, 30); i++) {
            const el = nodeList[i];
            const rect = el.getBoundingClientRect();
            
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.top > window.innerHeight || rect.bottom < 0) continue;

            const text = el.textContent?.trim().slice(0, 50) || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const elName = ariaLabel || text || placeholder || el.getAttribute('name') || '';

            if (!elName) continue;

            results.push({
                ref: 'e' + refCounter++,
                role: el.getAttribute('role') || el.tagName.toLowerCase(),
                name: elName,
                selector: getUniqueSelector(el),
                xpath: getXPath(el),
                attributes: {
                    type: el.getAttribute('type') || '',
                    placeholder: placeholder,
                },
                isInteractive: true,
            });
        }
    }
    
    return results;
})()
`;

export class BrowserClient {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private config: BrowserConfig;
    private downloadsDir: string;
    private fastFinder = new FastElementFinder();
    private enhancedSnapshot = new EnhancedSnapshot();

    constructor(config: BrowserConfig, downloadsDir: string) {
        this.config = config;
        this.downloadsDir = downloadsDir;
    }

    /**
     * Launch browser and create new page
     */
    async launch(): Promise<void> {
        this.browser = await chromium.launch({
            headless: this.config.headless,
        });

        this.context = await this.browser.newContext({
            viewport: this.config.viewport || { width: 1280, height: 720 },
            userAgent: this.config.userAgent,
            acceptDownloads: true,
        });

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(this.config.timeout);
    }

    /**
     * Navigate to URL
     */
    async goto(url: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle').catch(() => { });
    }

    /**
     * Get current URL
     */
    getUrl(): string {
        if (!this.page) throw new Error('Browser not launched');
        return this.page.url();
    }

    /**
     * Get page title
     */
    async getTitle(): Promise<string> {
        if (!this.page) throw new Error('Browser not launched');
        return this.page.title();
    }

    /**
     * Take a snapshot of the page for AI analysis
     */
    async takeSnapshot(): Promise<PageSnapshot> {
        if (!this.page) throw new Error('Browser not launched');

        const url = this.page.url();
        const title = await this.page.title();
        const timestamp = new Date().toISOString();

        // Get elements with UNIQUE selectors using IIFE script
        const elements: SnapshotElement[] = await this.page.evaluate(SNAPSHOT_SCRIPT) as SnapshotElement[];

        const textRepresentation = this.buildTextRepresentation(elements, url, title);

        return { url, title, timestamp, elements, textRepresentation };
    }

    /**
     * Check if the user appears to be logged in based on URL
     */
    async isLoggedIn(): Promise<boolean> {
        if (!this.page) return false;
        try {
            const url = this.page.url();
            return url.includes('dashboard') ||
                url.includes('account') ||
                url.includes('admin') ||
                url.includes('profile');
        } catch {
            return false;
        }
    }

    /**
     * Take a vision-optimized snapshot
     */
    async takeVisionSnapshot(): Promise<VisionSnapshot> {
        if (!this.page) throw new Error('Browser not launched');
        const snapshot = await this.takeSnapshot();
        return this.enhancedSnapshot.takeVisionSnapshot(this.page, snapshot.elements);
    }

    /**
     * Get default role based on tag name
     */
    private getDefaultRole(tagName: string, _selector: string): string {
        const roleMap: Record<string, string> = {
            'button': 'button',
            'a': 'link',
            'input': 'textbox',
            'textarea': 'textbox',
            'select': 'combobox',
        };
        return roleMap[tagName] || 'generic';
    }

    /**
     * Get element name from various attributes
     */
    private async getElementName(locator: any): Promise<string> {
        try {
            const ariaLabel = await locator.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;

            const titleAttr = await locator.getAttribute('title');
            if (titleAttr) return titleAttr;

            const text = await locator.innerText().catch(() => '');
            if (text && text.length < 100) return text.trim();

            const placeholder = await locator.getAttribute('placeholder');
            if (placeholder) return placeholder;

            const nameAttr = await locator.getAttribute('name');
            if (nameAttr) return nameAttr;

            const id = await locator.getAttribute('id');
            if (id) return id;

            return '';
        } catch {
            return '';
        }
    }

    /**
     * Build text representation of page for AI
     */
    private buildTextRepresentation(elements: SnapshotElement[], url: string, title: string): string {
        const lines: string[] = [
            `URL: ${url}`,
            `Title: ${title}`,
            '',
            'Interactive Elements:',
        ];

        for (const el of elements) {
            if (el.isInteractive) {
                let line = `[${el.ref}] ${el.role}`;
                if (el.name) line += `: "${el.name}"`;
                if (el.attributes.type) line += ` (type: ${el.attributes.type})`;
                lines.push(line);
            }
        }

        return lines.join('\n');
    }

    /**
     * Dismiss common overlays/modals (cookie banners, etc.)
     */
    async dismissOverlays(): Promise<void> {
        if (!this.page) return;

        const commonSelectors = [
            '#onetrust-accept-btn-handler',
            '#onetrust-reject-all-handler',
            '.cc-btn',
            '[aria-label="Accept cookies"]',
            'button:has-text("Accept all")',
            'button:has-text("Agree")',
            'button:has-text("I agree")',
            'button:has-text("Aceptar")',
            '[aria-label="Close"]',
            'button.close',
            '.modal-close',
            '.popup-close',
        ];

        for (const selector of commonSelectors) {
            try {
                const locator = this.page.locator(selector);
                if (await locator.count() > 0 && await locator.first().isVisible()) {
                    await locator.first().click({ timeout: 1000 }).catch(() => { });
                    console.log('   🚫 Dismissed overlay/popup');
                }
            } catch { /* ignore */ }
        }
    }

    /**
     * Click an element by ref
     */
    async click(ref: string, elementData?: SnapshotElement): Promise<void> {
        if (!this.page || !this.context) throw new Error('Browser not launched');

        let element = elementData;

        if (!element) {
            const snapshot = await this.takeSnapshot();
            element = snapshot.elements.find(e => e.ref === ref);
        }

        if (!element) {
            throw new Error(`Element with ref "${ref}" not found`);
        }

        const strategies: SelectorStrategy[] = [];

        if (element.selector) strategies.push({ type: 'css', value: element.selector, priority: 1 });
        if (element.xpath) strategies.push({ type: 'xpath', value: element.xpath, priority: 2 });
        strategies.push({ type: 'role', role: element.role, name: element.name, priority: 3 });
        if (element.name) strategies.push({ type: 'text', value: element.name, priority: 4 });

        const locator = await this.fastFinder.findElement(this.page, strategies);

        if (!locator) {
            throw new Error(`Element with ref "${ref}" not found with any strategy`);
        }

        const [newPage] = await Promise.all([
            this.context.waitForEvent('page', { timeout: 2000 }).catch(() => null),
            locator.click({ timeout: 5000 }),
        ]);

        if (newPage) {
            console.log('   📄 New tab detected, switching to it...');
            await newPage.waitForLoadState('domcontentloaded').catch(() => { });
            this.page = newPage;
        }
    }

    /**
     * Type text into an element by ref
     */
    async type(ref: string, text: string, elementData?: SnapshotElement): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        let element = elementData;

        if (!element) {
            const snapshot = await this.takeSnapshot();
            element = snapshot.elements.find(e => e.ref === ref);
        }

        if (!element) {
            throw new Error(`Element with ref "${ref}" not found`);
        }

        const strategies: SelectorStrategy[] = [];

        if (element.selector) strategies.push({ type: 'css', value: element.selector, priority: 1 });
        strategies.push({ type: 'role', role: element.role, name: element.name, priority: 2 });
        if (element.attributes.placeholder) {
            strategies.push({ type: 'css', value: `[placeholder="${element.attributes.placeholder}"]`, priority: 3 });
        }

        const inputType = element.attributes.type || 'text';
        if (inputType === 'email' || inputType === 'password' || inputType === 'text') {
            strategies.push({ type: 'css', value: `input[type="${inputType}"]`, priority: 4 });
        }

        const locator = await this.fastFinder.findElement(this.page, strategies);

        if (locator) {
            await locator.fill(text, { timeout: 5000 });
            return;
        }

        throw new Error(`Could not fill element "${ref}" with any strategy`);
    }

    /**
     * Press a key
     */
    async press(key: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.keyboard.press(key);
    }

    /**
     * Fill login form directly
     */
    async fillLoginForm(email?: string, username?: string, password?: string): Promise<boolean> {
        if (!this.page) throw new Error('Browser not launched');

        let filledAny = false;

        const userValue = email || username;
        if (userValue) {
            const emailSelectors = [
                'input[type="email"]',
                'input[name="email"]',
                'input[name="username"]',
                'input[name="user"]',
                'input[name="login"]',
                'input[id*="email"]',
                'input[id*="user"]',
                'input[id*="login"]',
                'input[placeholder*="email" i]',
                'input[placeholder*="correo" i]',
                'input[placeholder*="usuario" i]',
                'input[type="text"]:first-of-type',
            ];

            for (const selector of emailSelectors) {
                try {
                    const locator = this.page.locator(selector);
                    if (await locator.count() > 0 && await locator.first().isVisible()) {
                        await locator.first().fill(userValue, { timeout: 3000 });
                        console.log(`   ✉️ Filled email/username with: ${userValue}`);
                        filledAny = true;
                        break;
                    }
                } catch { /* try next */ }
            }
        }

        if (password) {
            const passwordSelectors = [
                'input[type="password"]',
                'input[name="password"]',
                'input[name="pass"]',
                'input[name="pwd"]',
                'input[id*="password"]',
                'input[id*="pass"]',
                'input[placeholder*="password" i]',
                'input[placeholder*="contraseña" i]',
            ];

            for (const selector of passwordSelectors) {
                try {
                    const locator = this.page.locator(selector);
                    if (await locator.count() > 0 && await locator.first().isVisible()) {
                        await locator.first().fill(password, { timeout: 3000 });
                        console.log(`   🔒 Filled password field`);
                        filledAny = true;
                        break;
                    }
                } catch { /* try next */ }
            }
        }

        return filledAny;
    }

    /**
     * Click the login/submit button
     */
    async clickLoginButton(): Promise<boolean> {
        if (!this.page) throw new Error('Browser not launched');

        const buttonSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Login")',
            'button:has-text("Sign in")',
            'button:has-text("Iniciar")',
            'button:has-text("Acceder")',
            'button:has-text("Entrar")',
            'button:has-text("Ingresar")',
            '[role="button"]:has-text("Login")',
            '[role="button"]:has-text("Acceder")',
        ];

        for (const selector of buttonSelectors) {
            try {
                const locator = this.page.locator(selector);
                if (await locator.count() > 0 && await locator.first().isVisible()) {
                    await locator.first().click({ timeout: 5000 });
                    console.log(`   🔘 Clicked login button`);
                    return true;
                }
            } catch { /* try next */ }
        }

        return false;
    }

    /**
     * Select an option from a dropdown
     */
    async select(ref: string, value: string, elementData?: SnapshotElement): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        let element = elementData;

        if (!element) {
            const snapshot = await this.takeSnapshot();
            element = snapshot.elements.find(e => e.ref === ref);
        }

        if (!element) {
            throw new Error(`Element with ref "${ref}" not found`);
        }

        const strategies: SelectorStrategy[] = [];
        if (element.selector) strategies.push({ type: 'css', value: element.selector, priority: 1 });
        strategies.push({ type: 'role', role: element.role, name: element.name, priority: 2 });

        const locator = await this.fastFinder.findElement(this.page, strategies);

        if (!locator) throw new Error(`Select element "${ref}" not found`);

        await locator.selectOption(value, { timeout: 5000 });
    }

    /**
     * Wait for something
     */
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

    /**
     * Scroll the page
     */
    async scroll(direction: 'up' | 'down'): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        const amount = direction === 'down' ? 500 : -500;
        await this.page.mouse.wheel(0, amount);
        await this.page.waitForTimeout(500);
    }

    /**
     * Take a screenshot
     */
    async screenshot(path: string): Promise<string> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.screenshot({ path, fullPage: false });
        return path;
    }

    /**
     * Get page content as text
     */
    async getTextContent(): Promise<string> {
        if (!this.page) throw new Error('Browser not launched');
        return this.page.innerText('body');
    }

    /**
     * Wait for download and return path
     */
    async waitForDownload(): Promise<string> {
        if (!this.page) throw new Error('Browser not launched');

        const download = await this.page.waitForEvent('download', { timeout: 30000 });
        const filename = download.suggestedFilename();
        const savePath = join(this.downloadsDir, filename);
        await download.saveAs(savePath);
        return savePath;
    }

    /**
     * Navigate back in browser history
     */
    async goBack(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => { });
        await this.page.waitForLoadState('networkidle').catch(() => { });
        console.log('   ⬅️ Navigated back');
    }

    /**
     * Navigate forward in browser history
     */
    async goForward(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => { });
        await this.page.waitForLoadState('networkidle').catch(() => { });
        console.log('   ➡️ Navigated forward');
    }

    /**
     * Check if an element is visible immediately (no wait)
     */
    async isElementVisible(selector: string): Promise<boolean> {
        if (!this.page) return false;
        try {
            const locator = this.page.locator(selector).first();
            return await locator.isVisible();
        } catch {
            return false;
        }
    }

    /**
     * Close current tab and switch to main tab
     */
    async closeCurrentTab(): Promise<void> {
        if (!this.page || !this.context) throw new Error('Browser not launched');

        const pages = this.context.pages();
        if (pages.length > 1) {
            await this.page.close();
            this.page = pages[0];
            console.log('   ✕ Closed tab, switched to main page');
        }
    }

    /**
     * Switch to a specific tab by index
     */
    async switchToTab(index: number): Promise<void> {
        if (!this.context) throw new Error('Browser not launched');

        const pages = this.context.pages();
        if (index >= 0 && index < pages.length) {
            this.page = pages[index];
            console.log(`   📑 Switched to tab ${index}`);
        }
    }

    /**
     * Get number of open tabs
     */
    getTabCount(): number {
        return this.context?.pages().length || 0;
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

    /**
     * Check if browser is running
     */
    isRunning(): boolean {
        return this.browser !== null;
    }
}