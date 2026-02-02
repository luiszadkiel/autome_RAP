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
    const seenElements = new Set(); // Avoid duplicates
    let refCounter = 1;

    function getUniqueSelector(el) {
        if (el.id) return '#' + el.id;
        
        const name = el.getAttribute('name');
        if (name) return '[name="' + name + '"]';
        
        const dataTestId = el.getAttribute('data-testid');
        if (dataTestId) return '[data-testid="' + dataTestId + '"]';
        
        const dataId = el.getAttribute('data-id');
        if (dataId) return '[data-id="' + dataId + '"]';
        
        const path = [];
        let current = el;
        
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let selector = current.tagName.toLowerCase();
            
            if (current.id) {
                selector = '#' + current.id;
                path.unshift(selector);
                break;
            }
            
            let sibling = current.previousElementSibling;
            let index = 1;
            while (sibling) {
                if (sibling.tagName === current.tagName) index++;
                sibling = sibling.previousElementSibling;
            }
            
            if (index > 1) {
                selector += ':nth-of-type(' + index + ')';
            }
            
            path.unshift(selector);
            current = current.parentElement;
        }
        return path.join(' > ');
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

    function getElementDescription(el) {
        // Try multiple ways to get a meaningful name
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel;
        
        const title = el.getAttribute('title');
        if (title) return title;
        
        // For INPUT elements, try to find associated label first
        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
            // Try to find label by 'for' attribute
            const id = el.getAttribute('id');
            if (id) {
                const label = document.querySelector('label[for="' + id + '"]');
                if (label && label.textContent) {
                    return label.textContent.trim().slice(0, 50);
                }
            }
            
            // Try to find label as sibling or parent
            const parent = el.parentElement;
            if (parent) {
                const siblingLabel = parent.querySelector('label');
                if (siblingLabel && siblingLabel.textContent) {
                    return siblingLabel.textContent.trim().slice(0, 50);
                }
                // Check parent's parent
                const grandparent = parent.parentElement;
                if (grandparent) {
                    const nearbyLabel = grandparent.querySelector('label');
                    if (nearbyLabel && nearbyLabel.textContent) {
                        return nearbyLabel.textContent.trim().slice(0, 50);
                    }
                }
            }
            
            // Try placeholder
            const placeholder = el.getAttribute('placeholder');
            if (placeholder) return placeholder;
            
            // Try name attribute
            const name = el.getAttribute('name');
            if (name) return name;
        }
        
        const text = el.textContent?.trim().slice(0, 50);
        if (text && text.length > 0 && text.length < 100) return text;
        
        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return placeholder;
        
        const name = el.getAttribute('name');
        if (name) return name;
        
        const value = el.getAttribute('value');
        if (value) return 'value: ' + value;
        
        const dataValue = el.getAttribute('data-value');
        if (dataValue) return 'data: ' + dataValue;
        
        const className = el.className;
        if (className && typeof className === 'string') {
            // Extract meaningful class names
            const meaningful = className.split(' ').find(c => 
                c.includes('btn') || c.includes('button') || c.includes('link') || 
                c.includes('nav') || c.includes('menu') || c.includes('date') ||
                c.includes('time') || c.includes('slot') || c.includes('option') ||
                c.includes('fecha') || c.includes('calendar') || c.includes('picker')
            );
            if (meaningful) return '[' + meaningful + ']';
        }
        
        // Fallback: describe by tag and type
        const type = el.getAttribute('type');
        if (type) return tag + '[type=' + type + ']';
        
        const role = el.getAttribute('role');
        if (role) return role + ' element';
        
        return tag + ' element';
    }

    function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        
        // Allow elements slightly off-screen (might be in scroll view)
        if (rect.bottom < -100 || rect.top > window.innerHeight + 100) return false;
        
        return true;
    }

    function addElement(el, customRole) {
        if (seenElements.has(el)) return;
        if (!isVisible(el)) return;
        
        // Skip container elements that shouldn't be clicked directly
        const tag = el.tagName.toLowerCase();
        const skipTags = ['nav', 'header', 'footer', 'main', 'section', 'article', 'aside', 'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'form', 'fieldset'];
        if (skipTags.includes(tag) && !el.getAttribute('onclick') && !el.getAttribute('role')) {
            return; // Skip containers unless they have click handler or role
        }
        
        // Skip li elements unless they have a specific role
        if (tag === 'li' && !el.getAttribute('role') && !el.getAttribute('onclick')) {
            return;
        }
        
        // Skip div elements that are just containers (no meaningful name)
        if (tag === 'div') {
            const name = getElementDescription(el);
            // If the div's text is too long or matches child text, it's probably a container
            if (name.length > 50 || el.querySelectorAll('a, button, input').length > 0) {
                return; // Skip container divs
            }
        }
        
        seenElements.add(el);
        
        const rect = el.getBoundingClientRect();
        const role = customRole || el.getAttribute('role') || tag;
        const name = getElementDescription(el);
        
        results.push({
            ref: 'e' + refCounter++,
            role: role,
            name: name,
            selector: getUniqueSelector(el),
            xpath: getXPath(el),
            attributes: {
                type: el.getAttribute('type') || '',
                placeholder: el.getAttribute('placeholder') || '',
                href: el.getAttribute('href') || '',
                value: el.getAttribute('value') || '',
            },
            isInteractive: true,
            position: {
                top: Math.round(rect.top),
                left: Math.round(rect.left),
            }
        });
    }

    // Extended list of interactive selectors
    const interactiveSelectors = [
        // ============================================
        // FORM ELEMENTS
        // ============================================
        'input:not([type="hidden"])',
        'textarea',
        'select',
        'button',
        'label',
        'fieldset',
        
        // ============================================
        // LINKS
        // ============================================
        'a[href]',
        'a',
        
        // ============================================
        // ARIA ROLES
        // ============================================
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="slider"]',
        '[role="spinbutton"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="gridcell"]',
        '[role="cell"]',
        '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]',
        '[role="treeitem"]',
        
        // ============================================
        // CLICKABLE ELEMENTS
        // ============================================
        '[onclick]',
        '[ng-click]',
        '[v-on:click]',
        '[@click]',
        '[data-action]',
        '[data-click]',
        '[data-toggle]',
        '[data-target]',
        '[data-dismiss]',
        '[tabindex="0"]',
        '[tabindex]:not([tabindex="-1"])',
        
        // ============================================
        // BUTTONS - ALL POSSIBLE FORMATS
        // ============================================
        
        // HTML native
        'button',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="reset"]',
        'input[type="image"]',
        
        // Generic button classes
        '[class*="btn"]',
        '[class*="Btn"]',
        '[class*="button"]',
        '[class*="Button"]',
        '.btn',
        '.button',
        
        // Bootstrap buttons
        '.btn-primary',
        '.btn-secondary',
        '.btn-success',
        '.btn-danger',
        '.btn-warning',
        '.btn-info',
        '.btn-light',
        '.btn-dark',
        '.btn-link',
        '.btn-outline-primary',
        '.btn-lg',
        '.btn-sm',
        '.btn-block',
        
        // Material UI buttons
        '.MuiButton-root',
        '.MuiIconButton-root',
        '.MuiFab-root',
        '[class*="MuiButton"]',
        
        // Angular Material buttons
        'mat-button',
        'mat-raised-button',
        'mat-flat-button',
        'mat-stroked-button',
        'mat-icon-button',
        'mat-fab',
        'mat-mini-fab',
        '[mat-button]',
        '[mat-raised-button]',
        '[mat-flat-button]',
        '[mat-icon-button]',
        '.mat-button',
        '.mat-raised-button',
        
        // Ionic buttons
        'ion-button',
        'ion-back-button',
        'ion-menu-button',
        'ion-fab-button',
        '.ion-button',
        
        // Tailwind CSS buttons (common patterns)
        '[class*="bg-blue"]',
        '[class*="bg-green"]',
        '[class*="bg-red"]',
        '[class*="rounded"][class*="px-"]',
        
        // Ant Design buttons
        '.ant-btn',
        '.ant-btn-primary',
        '.ant-btn-default',
        '.ant-btn-dashed',
        '.ant-btn-link',
        '.ant-btn-text',
        '[class*="ant-btn"]',
        
        // Chakra UI buttons
        '.chakra-button',
        '[class*="chakra-button"]',
        
        // Semantic UI buttons
        '.ui.button',
        '.ui.primary.button',
        '.ui.secondary.button',
        
        // Foundation buttons
        '.button.primary',
        '.button.secondary',
        '.button.success',
        
        // Bulma buttons
        '.button.is-primary',
        '.button.is-link',
        '.button.is-info',
        '.button.is-success',
        '.button.is-warning',
        '.button.is-danger',
        
        // PrimeNG/PrimeReact buttons
        '.p-button',
        '.p-button-primary',
        'p-button',
        '[class*="p-button"]',
        
        // Vuetify buttons
        '.v-btn',
        '.v-btn--elevated',
        '.v-btn--flat',
        '[class*="v-btn"]',
        
        // Element UI/Plus buttons
        '.el-button',
        '.el-button--primary',
        '[class*="el-button"]',
        
        // Quasar buttons
        '.q-btn',
        '[class*="q-btn"]',
        
        // Custom button patterns
        '[class*="submit"]',
        '[class*="Submit"]',
        '[class*="action"]',
        '[class*="Action"]',
        '[class*="cta"]',
        '[class*="CTA"]',
        '[class*="next"]',
        '[class*="Next"]',
        '[class*="prev"]',
        '[class*="Prev"]',
        '[class*="confirm"]',
        '[class*="Confirm"]',
        '[class*="cancel"]',
        '[class*="Cancel"]',
        '[class*="save"]',
        '[class*="Save"]',
        '[class*="delete"]',
        '[class*="Delete"]',
        '[class*="edit"]',
        '[class*="Edit"]',
        '[class*="add"]',
        '[class*="Add"]',
        '[class*="remove"]',
        '[class*="Remove"]',
        '[class*="close"]',
        '[class*="Close"]',
        '[class*="open"]',
        '[class*="Open"]',
        '[class*="toggle"]',
        '[class*="Toggle"]',
        '[class*="expand"]',
        '[class*="collapse"]',
        
        // Icon buttons
        '[class*="icon-btn"]',
        '[class*="icon-button"]',
        '[class*="btn-icon"]',
        '.icon-button',
        
        // FAB (Floating Action Button)
        '[class*="fab"]',
        '[class*="FAB"]',
        '.fab',
        '.floating-action-button',
        
        // Social buttons
        '[class*="btn-facebook"]',
        '[class*="btn-google"]',
        '[class*="btn-twitter"]',
        '[class*="btn-linkedin"]',
        '[class*="social-btn"]',
        
        // Divs/spans that look like buttons
        'div[class*="btn"]',
        'span[class*="btn"]',
        'div[class*="button"]',
        'span[class*="button"]',
        'div[role="button"]',
        'span[role="button"]',
        'a[class*="btn"]',
        'a[class*="button"]',
        
        // ============================================
        // CALENDAR DETECTION - ALL POSSIBLE FORMATS
        // ============================================
        
        // HTML5 native date inputs
        'input[type="date"]',
        'input[type="datetime-local"]',
        'input[type="time"]',
        'input[type="month"]',
        'input[type="week"]',
        
        // Generic calendar/datepicker classes
        '[class*="datepicker"]',
        '[class*="date-picker"]',
        '[class*="timepicker"]',
        '[class*="time-slot"]',
        '[class*="calendar"]',
        '[class*="Calendar"]',
        
        // Data attributes for dates
        '[data-date]',
        '[data-time]',
        '[data-day]',
        '[data-month]',
        '[data-year]',
        '[data-value]',
        
        // Calendar table cells
        'table td',
        'table th',
        '.calendar td',
        '.calendar th',
        '[class*="day"]',
        '[class*="Day"]',
        
        // jQuery UI Datepicker
        '.ui-datepicker',
        '.ui-datepicker td',
        '.ui-datepicker-calendar td',
        '.ui-state-default',
        
        // Flatpickr
        '.flatpickr-calendar',
        '.flatpickr-day',
        '.flatpickr-days span',
        
        // Pikaday
        '.pika-single',
        '.pika-table td',
        '.pika-day',
        '.pika-button',
        
        // Air Datepicker
        '.datepicker--cell',
        '.datepicker--days',
        
        // Bootstrap Datepicker
        '.datepicker-dropdown',
        '.datepicker-days td',
        '.datepicker-days .day',
        '.datepicker-switch',
        
        // Material UI (React)
        '.MuiPickersCalendar-root',
        '.MuiPickersDay-root',
        '.MuiPickersDay-day',
        '[class*="MuiPickers"]',
        
        // Angular Material
        'mat-calendar',
        'mat-month-view',
        'mat-datepicker',
        '[mat-calendar-body-cell]',
        '.mat-calendar-body-cell',
        '.mat-calendar-body-cell-content',
        
        // Ionic
        'ion-button',
        'ion-item',
        'ion-card',
        'ion-datetime',
        'ion-select',
        'ion-input',
        'ion-picker',
        'ion-picker-column',
        'ion-picker-column-option',
        
        // PrimeNG/PrimeReact
        '.p-datepicker',
        '.p-datepicker-calendar td',
        '.p-datepicker-day',
        'p-calendar',
        
        // React Datepicker
        '.react-datepicker',
        '.react-datepicker__day',
        '.react-datepicker__month-container',
        
        // React Calendar
        '.react-calendar',
        '.react-calendar__tile',
        '.react-calendar__month-view__days__day',
        
        // Vuetify
        '.v-date-picker',
        '.v-date-picker-table',
        '.v-date-picker-table__day',
        '.v-btn--active',
        
        // Vue2-datepicker
        '.mx-datepicker',
        '.mx-calendar',
        '.mx-table-date-cell',
        
        // FullCalendar
        '.fc-daygrid',
        '.fc-daygrid-day',
        '.fc-day',
        '.fc-event',
        
        // ARIA roles for calendars
        '[role="grid"]',
        '[role="gridcell"]',
        '[role="row"]',
        
        // Generic day/date elements
        '[class*="-day"]',
        '[class*="_day"]',
        '[class*="date-"]',
        '[class*="_date"]',
        '[class*="cell"]',
        '[class*="Cell"]',
        
        // Form group date selectors (common Bootstrap pattern)
        '.form-group input[type="text"]',
        '.form-group input[type="date"]',
        '.form-control',
        '[class*="form-group"] input',
        '[class*="fecha"]',
        '[class*="Fecha"]',
        
        // Time slots (CRITICAL for booking sites)
        '[class*="slot"]',
        '[class*="Slot"]',
        '[class*="hour"]',
        '[class*="Hour"]',
        '[class*="horario"]',
        '[class*="Horario"]',
        '[class*="tee"]',
        '[class*="Tee"]',
        '[class*="turno"]',
        '[class*="Turno"]',
        '[class*="disponible"]',
        '[class*="available"]',
        '[class*="time-"]',
        '[class*="-time"]',
        '[class*="Time"]',
        '[data-time]',
        '[data-hour]',
        '[data-slot]',
        '[class*="Hour"]',
        '[class*="minute"]',
        '[class*="Minute"]',
        
        // Modal/Dialog content (calendars often in modals)
        '.modal-content button',
        '.modal-content a',
        '.modal-content td',
        '.modal-body button',
        '.modal-body a',
        '.modal-body td',
        '[class*="modal"] button',
        '[class*="modal"] a',
        '[class*="modal"] td',
        '[class*="dialog"] button',
        '[class*="dialog"] td',
        '[class*="popup"] button',
        '[class*="popup"] td',
        '.overlay button',
        '.overlay a',
        '.overlay td',
        
        // Common booking/reservation elements
        '[class*="available"]',
        '[class*="selectable"]',
        '[class*="clickable"]',
        '[class*="enabled"]',
        
        // Navigation elements
        '[class*="nav-"] a',
        '[class*="menu-"] a',
        '.nav a',
        '.menu a',
        
        // Cards and clickable containers (common in booking sites)
        '[class*="card"]',
        '[class*="slot"]',
        '[class*="tee-time"]',
        '[class*="booking"]',
        '[class*="reserve"]',
        '[class*="available"]',
        '[class*="hora"]',
        '[class*="time"]',
        
        // Divs and spans that might be clickable
        'div[class*="btn"]',
        'span[class*="btn"]',
        'div[class*="click"]',
        'li[class*="item"]',
    ];

    // Increased limit per selector
    const MAX_PER_SELECTOR = 50;
    const MAX_TOTAL = 150;

    for (const selector of interactiveSelectors) {
        if (results.length >= MAX_TOTAL) break;
        
        try {
            const nodeList = document.querySelectorAll(selector);
            for (let i = 0; i < Math.min(nodeList.length, MAX_PER_SELECTOR); i++) {
                if (results.length >= MAX_TOTAL) break;
                addElement(nodeList[i]);
            }
        } catch (e) {
            // Invalid selector, skip
        }
    }

    // ADDITIONAL: Find elements containing time patterns (10:00, 7:30 AM, etc.)
    const timePattern = /\b\d{1,2}:\d{2}\s*(am|pm|AM|PM)?\b/;
    const allTextElements = document.querySelectorAll('div, span, a, button, td, li, p');
    for (const el of allTextElements) {
        if (results.length >= MAX_TOTAL) break;
        const text = el.textContent?.trim();
        if (text && text.length < 20 && timePattern.test(text)) {
            // This element contains a time - add it if clickable
            const style = window.getComputedStyle(el);
            const isClickable = style.cursor === 'pointer' || 
                               el.onclick || 
                               el.getAttribute('onclick') ||
                               el.classList.contains('clickable') ||
                               el.closest('button, a') ||
                               el.getAttribute('role') === 'button';
            if (isClickable || el.tagName.toLowerCase() === 'a' || el.tagName.toLowerCase() === 'button') {
                addElement(el, 'time-slot');
            }
        }
    }

    // Note: cursor:pointer scanning removed for performance

    // Sort by position (top to bottom, left to right) for logical ordering
    results.sort((a, b) => {
        if (!a.position || !b.position) return 0;
        const topDiff = a.position.top - b.position.top;
        if (Math.abs(topDiff) > 20) return topDiff;
        return a.position.left - b.position.left;
    });

    // Re-number refs after sorting
    results.forEach((el, i) => {
        el.ref = 'e' + (i + 1);
        delete el.position; // Clean up internal data
    });
    
    return results;
})()
`;

// Type for time slot click results
export interface TimeSlotResult {
    available: boolean;
    slotName: string;
    reason: string;
    nearbyAvailable: string[];
}

export class BrowserClient {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private config: BrowserConfig;
    private downloadsDir: string;
    private fastFinder = new FastElementFinder();
    private enhancedSnapshot = new EnhancedSnapshot();

    // Store last time slot click result for agent to check
    public lastTimeSlotResult: TimeSlotResult | null = null;

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
     * Reload the current page
     */
    async reload(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        await this.page.reload({ waitUntil: 'domcontentloaded' });
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
     * Get all cookies from the browser context for session persistence
     */
    async getCookies(): Promise<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'Lax' | 'Strict' | 'None';
    }[]> {
        if (!this.context) throw new Error('Browser not launched');
        return await this.context.cookies();
    }

    /**
     * Set cookies in the browser context to restore a session
     */
    async setCookies(cookies: {
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: 'Lax' | 'Strict' | 'None';
    }[]): Promise<void> {
        if (!this.context) throw new Error('Browser not launched');
        await this.context.addCookies(cookies);
    }

    /**
     * Take a snapshot of the page for AI analysis
     */
    async takeSnapshot(): Promise<PageSnapshot> {
        if (!this.page) throw new Error('Browser not launched');

        const url = this.page.url();
        const title = await this.page.title().catch(() => 'Unknown');
        const timestamp = new Date().toISOString();

        // Get elements from main frame with timeout
        let elements: SnapshotElement[] = [];
        try {
            elements = await Promise.race([
                this.page.evaluate(SNAPSHOT_SCRIPT) as Promise<SnapshotElement[]>,
                new Promise<SnapshotElement[]>((_, reject) =>
                    setTimeout(() => reject(new Error('Snapshot timeout')), 5000)
                )
            ]);
        } catch (e) {
            console.log(`   ⚠️ Snapshot error: ${e}`);
            elements = [];
        }

        // Skip iframe scanning for speed (can be re-enabled if needed)
        // Iframes are often cross-origin and cause delays

        const textRepresentation = this.buildTextRepresentation(elements, url, title);

        return { url, title, timestamp, elements, textRepresentation };
    }

    /**
     * Check if the user appears to be logged in based on multiple indicators
     */
    async isLoggedIn(): Promise<boolean> {
        if (!this.page) return false;
        try {
            // 1. Check URL for common authenticated paths
            const url = this.page.url();
            const authenticatedUrlPatterns = [
                'dashboard', 'account', 'admin', 'profile',
                'my-', 'member', 'portal', 'home', 'reserv', 'welcome',
                'main', 'app', 'user', 'panel'
            ];

            // Also check if NOT on login page
            const loginUrlPatterns = ['login', 'signin', 'sign-in', 'acceder', 'auth'];
            const isOnLoginPage = loginUrlPatterns.some(p => url.toLowerCase().includes(p));

            if (!isOnLoginPage && authenticatedUrlPatterns.some(p => url.toLowerCase().includes(p))) {
                return true;
            }

            // 2. Check for logout/sign-out indicators (means user IS logged in)
            const logoutIndicators = [
                'a:has-text("Logout")',
                'a:has-text("Log out")',
                'a:has-text("Sign out")',
                'a:has-text("Cerrar sesión")',
                'a:has-text("Salir")',
                'button:has-text("Logout")',
                'button:has-text("Sign out")',
                'button:has-text("Cerrar sesión")',
                '[aria-label*="logout" i]',
                '[aria-label*="sign out" i]',
                '[aria-label*="cerrar" i]',
                'a[href*="logout"]',
                'a[href*="signout"]',
                'a[href*="sign-out"]',
            ];

            for (const selector of logoutIndicators) {
                try {
                    const locator = this.page.locator(selector);
                    if (await locator.count() > 0 && await locator.first().isVisible({ timeout: 500 })) {
                        return true;
                    }
                } catch { /* continue */ }
            }

            // 3. Check if login form is NOT visible (no password field = likely logged in)
            const hasPasswordField = await this.page.locator('input[type="password"]').isVisible({ timeout: 500 }).catch(() => false);
            const hasLoginButton = await this.page.locator('button:has-text("Login"), button:has-text("Sign in"), button:has-text("Iniciar"), button[type="submit"]:has-text("Acceder")').isVisible({ timeout: 500 }).catch(() => false);

            // If there's NO password field and NO login button, likely logged in
            if (!hasPasswordField && !hasLoginButton) {
                // Additional check: see if there's any user menu or profile indicator
                const profileIndicators = [
                    '[class*="user-menu"]',
                    '[class*="profile"]',
                    '[class*="avatar"]',
                    '[aria-label*="profile" i]',
                    '[aria-label*="account" i]',
                    '[aria-label*="user" i]',
                ];
                for (const selector of profileIndicators) {
                    try {
                        const locator = this.page.locator(selector);
                        if (await locator.count() > 0) {
                            return true;
                        }
                    } catch { /* continue */ }
                }
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Check if a login form is currently visible on the page
     */
    async hasLoginForm(): Promise<boolean> {
        if (!this.page) return false;
        try {
            const hasPasswordField = await this.page.locator('input[type="password"]').isVisible({ timeout: 500 }).catch(() => false);
            const hasEmailField = await this.page.locator('input[type="email"], input[name="email"], input[name="username"]').isVisible({ timeout: 500 }).catch(() => false);

            return hasPasswordField && hasEmailField;
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
            `Elements found: ${elements.length}`,
            '',
            'Interactive Elements:',
        ];

        // Group elements by type for better organization
        const inputs = elements.filter(e => e.role === 'input' || e.attributes.type);
        const buttons = elements.filter(e => e.role === 'button' || e.role === 'link' || e.role === 'a');
        const others = elements.filter(e => !inputs.includes(e) && !buttons.includes(e));

        if (inputs.length > 0) {
            lines.push('');
            lines.push('📝 Input Fields:');
            for (const el of inputs) {
                let line = `  [${el.ref}] ${el.role}`;
                if (el.name) line += `: "${el.name}"`;
                if (el.attributes.type) line += ` (type: ${el.attributes.type})`;
                if (el.attributes.placeholder) line += ` [placeholder: ${el.attributes.placeholder}]`;
                lines.push(line);
            }
        }

        if (buttons.length > 0) {
            lines.push('');
            lines.push('🔘 Buttons & Links:');
            for (const el of buttons) {
                let line = `  [${el.ref}] ${el.role}`;
                if (el.name) line += `: "${el.name}"`;
                if (el.attributes.href) {
                    // Show simplified href
                    const href = el.attributes.href;
                    const shortHref = href.length > 40 ? href.substring(0, 40) + '...' : href;
                    line += ` → ${shortHref}`;
                }
                lines.push(line);
            }
        }

        if (others.length > 0) {
            lines.push('');
            lines.push('📦 Other Interactive Elements:');
            for (const el of others) {
                let line = `  [${el.ref}] ${el.role}`;
                if (el.name) line += `: "${el.name}"`;
                if (el.attributes.value) line += ` [value: ${el.attributes.value}]`;
                lines.push(line);
            }
        }

        if (elements.length === 0) {
            lines.push('');
            lines.push('⚠️ No interactive elements found on this page.');
            lines.push('   Try scrolling down or waiting for the page to load.');
        }

        return lines.join('\n');
    }

    /**
     * Dismiss common overlays/modals (cookie banners, etc.)
     */
    async dismissOverlays(): Promise<void> {
        if (!this.page) return;

        const commonSelectors = [
            // Cookie banners
            '#onetrust-accept-btn-handler',
            '#onetrust-reject-all-handler',
            '.cc-btn',
            '[aria-label="Accept cookies"]',
            'button:has-text("Accept all")',
            'button:has-text("Agree")',
            'button:has-text("I agree")',
            'button:has-text("Aceptar")',
            'button:has-text("Acepto")',

            // Close buttons
            '[aria-label="Close"]',
            '[aria-label="Cerrar"]',
            'button.close',
            '.modal-close',
            '.popup-close',
            '.btn-close',
            '[class*="close-btn"]',
            '[class*="close-button"]',
            'button:has-text("Close")',
            'button:has-text("Cerrar")',
            'button:has-text("X")',

            // Modal dismiss
            '.modal-backdrop',
            '[class*="overlay"]',
            '[class*="modal"] button[class*="close"]',

            // Loading spinners (click to dismiss if clickable)
            '.loading-overlay',
        ];

        for (const selector of commonSelectors) {
            try {
                const locator = this.page.locator(selector);
                if (await locator.count() > 0 && await locator.first().isVisible()) {
                    await locator.first().click({ timeout: 500 }).catch(() => { });
                    console.log('   🚫 Dismissed overlay/popup');
                    await this.page.waitForTimeout(300);
                }
            } catch { /* ignore */ }
        }

        // Also try pressing Escape to close any modal
        try {
            await this.page.keyboard.press('Escape');
        } catch { /* ignore */ }
    }

    /**
     * Check if text looks like a time slot (e.g., "10:00am", "2:30 PM")
     */
    private isTimeSlotText(text: string): boolean {
        if (!text) return false;
        const timePattern = /^\d{1,2}:\d{2}\s*(am|pm|AM|PM)?$/;
        return timePattern.test(text.trim());
    }

    /**
     * Find nearby available time slots
     */
    private async findNearbyAvailableSlots(targetTime: string): Promise<string[]> {
        if (!this.page) return [];

        try {
            const availableSlots = await this.page.evaluate(() => {
                const slots: { time: string; available: boolean }[] = [];

                // Find all potential time slot containers
                const allElements = Array.from(document.querySelectorAll('[data-tt], .bookit, [class*="slot"], [class*="time"]'));

                for (let i = 0; i < allElements.length; i++) {
                    const el = allElements[i];
                    const dataTt = el.getAttribute('data-tt');
                    const classes = (el.className || '').toLowerCase();

                    // Check if this is an available slot
                    const isAvailable = el.classList.contains('bookit') ||
                        el.hasAttribute('data-tt') ||
                        classes.includes('empty') ||
                        classes.includes('available') ||
                        classes.includes('free');

                    const isUnavailable = classes.includes('filled') ||
                        classes.includes('booked') ||
                        classes.includes('reserved') ||
                        classes.includes('unavailable');

                    if (dataTt && isAvailable && !isUnavailable) {
                        slots.push({ time: dataTt, available: true });
                    } else {
                        // Also check for time text in children
                        const timeSpan = el.querySelector('.thetime, [class*="time"]');
                        if (timeSpan && timeSpan.textContent) {
                            const timeText = timeSpan.textContent.trim();
                            if (/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(timeText) && isAvailable && !isUnavailable) {
                                slots.push({ time: timeText, available: true });
                            }
                        }
                    }
                }

                // Remove duplicates
                const uniqueTimes = [...new Set(slots.map(s => s.time))];
                return uniqueTimes.slice(0, 5); // Return max 5 nearby slots
            });

            return availableSlots;
        } catch (e) {
            return [];
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

        // Check if this is a time slot element
        const isTimeSlot = this.isTimeSlotText(element.name);

        if (isTimeSlot) {
            console.log(`   🕐 Detected time slot: "${element.name}" - using specialized click...`);
            const result = await this.clickTimeSlot(element, locator);

            // Store the result for the agent to check
            this.lastTimeSlotResult = result;

            if (!result.available) {
                // Throw a special error that can be caught by the agent
                const error = new Error(`TIME_SLOT_UNAVAILABLE:${element.name}`);
                (error as any).timeSlotResult = result;
                throw error;
            }
            return;
        }

        const urlBefore = this.page.url();

        const [newPage] = await Promise.all([
            this.context.waitForEvent('page', { timeout: 2000 }).catch(() => null),
            locator.click({ timeout: 5000 }),
        ]);

        if (newPage) {
            console.log('   📄 New tab detected, switching to it...');
            await newPage.waitForLoadState('domcontentloaded').catch(() => { });
            this.page = newPage;
            return;
        }

        // Wait briefly for potential navigation
        await this.page.waitForTimeout(300);
        const urlAfter = this.page.url();

        // If URL didn't change and element is a span/i/small, try clicking parent
        if (urlBefore === urlAfter && element.selector) {
            const tag = element.role?.toLowerCase() || '';
            const isSmallElement = ['span', 'i', 'small', 'em', 'strong', 'b', 'label'].includes(tag);

            if (isSmallElement) {
                // Try multiple click strategies
                let clickWorked = false;

                // Strategy 1: Click parent element
                try {
                    const parentLocator = this.page.locator(`xpath=${element.xpath}/..`);
                    if (await parentLocator.count() > 0) {
                        console.log('   🔄 Trying parent element click...');
                        await parentLocator.first().click({ timeout: 3000, force: true });
                        await this.page.waitForTimeout(500);
                        if (this.page.url() !== urlBefore) {
                            clickWorked = true;
                        }
                    }
                } catch {
                    // Parent click failed
                }

                // Strategy 2: Full mouse event simulation
                if (!clickWorked) {
                    try {
                        console.log('   🔄 Trying full mouse event simulation...');
                        await this.page.evaluate((selector) => {
                            const el = document.querySelector(selector) as HTMLElement;
                            if (el) {
                                // Get element center coordinates
                                const rect = el.getBoundingClientRect();
                                const x = rect.left + rect.width / 2;
                                const y = rect.top + rect.height / 2;

                                // Simulate full mouse interaction sequence
                                const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
                                events.forEach(eventType => {
                                    const event = new MouseEvent(eventType, {
                                        view: window,
                                        bubbles: true,
                                        cancelable: true,
                                        clientX: x,
                                        clientY: y
                                    });
                                    el.dispatchEvent(event);
                                });

                                // Also try focusing and pressing enter
                                el.focus();
                                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                                el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                            }
                        }, element.selector);
                        await this.page.waitForTimeout(500);
                        if (this.page.url() !== urlBefore) {
                            clickWorked = true;
                        }
                    } catch {
                        // Mouse simulation failed
                    }
                }

                // Strategy 3: Click grandparent (for deeply nested elements)
                if (!clickWorked) {
                    try {
                        const grandparentLocator = this.page.locator(`xpath=${element.xpath}/../..`);
                        if (await grandparentLocator.count() > 0) {
                            console.log('   🔄 Trying grandparent element click...');
                            await grandparentLocator.first().click({ timeout: 3000, force: true }).catch(() => { });
                            await this.page.waitForTimeout(500);
                        }
                    } catch {
                        // Grandparent click failed
                    }
                }

                // Strategy 4: Find and click closest anchor or button ancestor
                if (!clickWorked) {
                    try {
                        console.log('   🔄 Trying to find clickable ancestor (a, button, div[onclick])...');
                        const clickableAncestor = await this.page.evaluate((selector) => {
                            const el = document.querySelector(selector);
                            if (!el) return null;

                            let current = el.parentElement;
                            while (current && current !== document.body) {
                                const tag = current.tagName.toLowerCase();
                                if (tag === 'a' || tag === 'button' ||
                                    current.hasAttribute('onclick') ||
                                    current.hasAttribute('ng-click') ||
                                    current.hasAttribute('@click') ||
                                    current.classList.contains('clickable') ||
                                    window.getComputedStyle(current).cursor === 'pointer') {
                                    // Found clickable ancestor, click it
                                    (current as HTMLElement).click();
                                    return true;
                                }
                                current = current.parentElement;
                            }
                            return false;
                        }, element.selector);

                        if (clickableAncestor) {
                            await this.page.waitForTimeout(500);
                        }
                    } catch {
                        // Ancestor search failed
                    }
                }
            }
        }
    }

    /**
     * Specialized click handler for time slots
     * Time slots don't navigate - they just change selection state
     * Supports Angular, Vue, React and other frameworks
     */
    private async clickTimeSlot(element: SnapshotElement, locator: any): Promise<TimeSlotResult> {
        if (!this.page) throw new Error('Browser not launched');

        const selector = element.selector || '';
        const name = element.name || '';

        // First, check if the slot is available or already booked/filled
        const slotStatus = await this.page.evaluate((timeName: string) => {
            const normalized = timeName.trim().toLowerCase();
            const allElements = Array.from(document.querySelectorAll('span, div'));

            for (let i = 0; i < allElements.length; i++) {
                const el = allElements[i];
                if (el.textContent?.trim().toLowerCase() === normalized) {
                    // Walk up to check parent classes for availability indicators
                    let parent = el.parentElement;
                    for (let j = 0; j < 8 && parent; j++) {
                        const classes = (parent.className || '').toLowerCase();

                        // Check for "not available" indicators
                        if (classes.includes('filled') || classes.includes('booked') ||
                            classes.includes('reserved') || classes.includes('unavailable') ||
                            classes.includes('disabled') || classes.includes('taken') ||
                            classes.includes('occupied') || classes.includes('sold')) {
                            return { available: false, reason: `slot has class indicating unavailable: "${parent.className}"` };
                        }

                        // Check for "available" indicators
                        if (classes.includes('empty') || classes.includes('available') ||
                            classes.includes('free') || classes.includes('open') ||
                            parent.hasAttribute('data-tt') || parent.classList.contains('bookit')) {
                            return { available: true, reason: `slot has class indicating available: "${parent.className}"` };
                        }

                        parent = parent.parentElement;
                    }
                }
            }
            return { available: null, reason: 'could not determine availability' };
        }, name);

        if (slotStatus.available === false) {
            console.log(`   ❌ TIME SLOT NOT AVAILABLE: ${name}`);
            console.log(`   📋 Reason: ${slotStatus.reason}`);
            console.log(`   💡 This time is already booked. Looking for nearby available slots...`);

            // Find nearby available slots
            const nearbySlots = await this.findNearbyAvailableSlots(name);
            if (nearbySlots.length > 0) {
                console.log(`   🕐 Available slots nearby:`);
                nearbySlots.forEach((slot, idx) => {
                    console.log(`      ${idx + 1}. ${slot}`);
                });
            }

            // Return result indicating slot is not available
            return {
                available: false,
                slotName: name,
                reason: slotStatus.reason,
                nearbyAvailable: nearbySlots
            };
        } else if (slotStatus.available === true) {
            console.log(`   ✅ Time slot appears available: ${slotStatus.reason}`);
        }

        // Define success result to return when click works
        const successResult: TimeSlotResult = {
            available: true,
            slotName: name,
            reason: 'slot clicked successfully',
            nearbyAvailable: []
        };

        // Get initial state to detect changes (including CSS classes for selection)
        const initialState = await this.page.evaluate((timeName: string) => {
            const htmlLen = document.body.innerHTML.length;
            // Also check if any element with this time has a selected/active class
            const timeSpans = Array.from(document.querySelectorAll('span, div')).filter(
                el => el.textContent?.trim() === timeName.trim()
            );
            const selectedClasses = timeSpans.map(el => {
                let classes = el.className || '';
                let parent = el.parentElement;
                for (let i = 0; i < 5 && parent; i++) {
                    classes += ' ' + (parent.className || '');
                    parent = parent.parentElement;
                }
                return classes;
            }).join(' ');
            return { htmlLen, selectedClasses };
        }, name).catch(() => ({ htmlLen: 0, selectedClasses: '' }));

        // Strategy 1: Try direct Playwright click with force
        try {
            await locator.click({ timeout: 3000, force: true });
            console.log(`   ✓ Direct click executed`);
            await this.page.waitForTimeout(300);
        } catch (e) {
            console.log(`   ⚠️ Direct click failed, trying alternatives...`);
        }

        // Check if page changed (HTML size or CSS classes)
        const checkStateChanged = async (actionName: string): Promise<boolean> => {
            const currentState = await this.page!.evaluate((timeName: string) => {
                const htmlLen = document.body.innerHTML.length;
                const timeSpans = Array.from(document.querySelectorAll('span, div')).filter(
                    el => el.textContent?.trim() === timeName.trim()
                );
                const selectedClasses = timeSpans.map(el => {
                    let classes = el.className || '';
                    let parent = el.parentElement;
                    for (let i = 0; i < 5 && parent; i++) {
                        classes += ' ' + (parent.className || '');
                        parent = parent.parentElement;
                    }
                    return classes;
                }).join(' ');
                return { htmlLen, selectedClasses };
            }, name).catch(() => ({ htmlLen: 0, selectedClasses: '' }));

            const htmlChanged = Math.abs(currentState.htmlLen - initialState.htmlLen) > 50;
            const classesChanged = currentState.selectedClasses !== initialState.selectedClasses;

            if (htmlChanged || classesChanged) {
                if (classesChanged) {
                    console.log(`   ✓ CSS classes changed after ${actionName} (selection state likely changed)`);
                } else {
                    console.log(`   ✓ Page content changed after ${actionName}`);
                }
                return true;
            }
            return false;
        };

        if (await checkStateChanged('direct click')) {
            return successResult;
        }

        // Strategy 1.5: Find element with data-* attribute containing the time value
        // Generic pattern: <div class="slot" data-time="10:00am"> or data-value, data-slot, etc.
        try {
            // Normalize time format for matching
            const normalizedTime = name.trim().toLowerCase().replace(/\s+/g, '');
            const timeFormats = [
                normalizedTime,
                normalizedTime.replace('am', ' am').replace('pm', ' pm'),
                name.trim(),
            ];

            // Common data attribute patterns for time slots
            const dataAttributes = ['data-time', 'data-value', 'data-slot', 'data-hour', 'data-tt', 'data-id'];

            for (const attr of dataAttributes) {
                for (const timeFormat of timeFormats) {
                    const selector = `[${attr}="${timeFormat}"]`;
                    const element = this.page.locator(selector);

                    if (await element.count() > 0) {
                        console.log(`   🎯 Found element with ${attr}="${timeFormat}"`);
                        await element.first().click({ timeout: 3000, force: true });
                        console.log(`   ✓ Clicked data-attribute element`);
                        await this.page.waitForTimeout(500);

                        if (await checkStateChanged('data-attribute click')) {
                            return successResult;
                        }
                    }
                }
            }

            // Find any element with a data-* attribute containing the time value
            const dataAttrElement = await this.page.evaluate((timeVal: string) => {
                const normalized = timeVal.trim().toLowerCase().replace(/\s+/g, '');
                const allElements = Array.from(document.querySelectorAll('*'));

                for (let i = 0; i < allElements.length; i++) {
                    const el = allElements[i];
                    const attrs = el.getAttributeNames();
                    for (let j = 0; j < attrs.length; j++) {
                        const attr = attrs[j];
                        if (attr.startsWith('data-')) {
                            const value = el.getAttribute(attr)?.toLowerCase().replace(/\s+/g, '');
                            if (value === normalized || value?.includes(normalized)) {
                                (el as HTMLElement).click();
                                return `${attr}="${el.getAttribute(attr)}"`;
                            }
                        }
                    }
                }
                return null;
            }, name);

            if (dataAttrElement) {
                console.log(`   🎯 Found and clicked element with ${dataAttrElement}`);
                await this.page.waitForTimeout(500);

                if (await checkStateChanged('generic data-attr click')) {
                    return successResult;
                }
            }
        } catch (e) {
            // Data attribute strategy failed
        }

        // Strategy 1.6: Find clickable container with booking/slot/time related classes
        try {
            // Common class patterns for time slot containers
            const slotClassPatterns = [
                'slot', 'time-slot', 'timeslot', 'booking', 'book', 'reserve',
                'available', 'tee', 'hour', 'schedule', 'appointment', 'option'
            ];

            for (const pattern of slotClassPatterns) {
                const selector = `[class*="${pattern}"]`;
                const elements = this.page.locator(selector).filter({ hasText: name.trim() });

                if (await elements.count() > 0) {
                    console.log(`   🎯 Found element with class containing "${pattern}"`);
                    await elements.first().click({ timeout: 3000, force: true });
                    await this.page.waitForTimeout(500);

                    if (await checkStateChanged(`${pattern}-class click`)) {
                        return successResult;
                    }
                }
            }
        } catch (e) {
            // Class pattern strategy failed
        }

        // Strategy 2: Double click (some UIs require it)
        try {
            await locator.dblclick({ timeout: 2000, force: true });
            console.log(`   ✓ Double click executed`);
            await this.page.waitForTimeout(300);

            if (await checkStateChanged('double click')) {
                return successResult;
            }
        } catch (e) {
            // Double click failed
        }

        // Strategy 3: Click via coordinates with full mouse simulation
        try {
            const boundingBox = await locator.boundingBox();
            if (boundingBox) {
                const x = boundingBox.x + boundingBox.width / 2;
                const y = boundingBox.y + boundingBox.height / 2;

                // Full mouse sequence
                await this.page.mouse.move(x, y);
                await this.page.waitForTimeout(50);
                await this.page.mouse.down();
                await this.page.waitForTimeout(50);
                await this.page.mouse.up();
                await this.page.waitForTimeout(50);
                await this.page.mouse.click(x, y);

                console.log(`   ✓ Coordinate click at (${Math.round(x)}, ${Math.round(y)})`);
                await this.page.waitForTimeout(300);
            }
        } catch (e) {
            // Coordinate click failed
        }

        // Strategy 4: JavaScript click on element and all ancestors
        try {
            await this.page.evaluate(({ sel, nm }: { sel: string; nm: string }) => {
                let el: Element | null = null;

                if (sel) {
                    el = document.querySelector(sel);
                }

                if (!el && nm) {
                    const all = document.querySelectorAll('span, div, button, a, li, td, p');
                    for (let i = 0; i < all.length; i++) {
                        if (all[i].textContent?.trim() === nm.trim()) {
                            el = all[i];
                            break;
                        }
                    }
                }

                if (!el) return false;

                // Try clicking the element itself
                (el as HTMLElement).click();

                // Walk up and click each parent that might be the actual handler
                let current: Element | null = el;
                for (let i = 0; i < 8 && current; i++) {
                    const parentEl: HTMLElement | null = current.parentElement;
                    if (!parentEl || parentEl === document.body) break;

                    // Check for Angular/Vue/React bindings
                    const hasHandler = parentEl.hasAttribute('onclick') ||
                        parentEl.hasAttribute('ng-click') ||
                        parentEl.hasAttribute('@click') ||
                        parentEl.hasAttribute('v-on:click') ||
                        (parentEl as any).__ngContext__ ||
                        (parentEl as any).__reactFiber$ ||
                        (parentEl as any)._vnode ||
                        parentEl.getAttribute('role') === 'button' ||
                        parentEl.tagName === 'BUTTON' ||
                        parentEl.tagName === 'A' ||
                        window.getComputedStyle(parentEl).cursor === 'pointer';

                    if (hasHandler) {
                        (parentEl as HTMLElement).click();

                        // Also dispatch proper events for frameworks
                        const rect = parentEl.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;

                        ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'].forEach(evtType => {
                            parentEl.dispatchEvent(new PointerEvent(evtType, {
                                view: window,
                                bubbles: true,
                                cancelable: true,
                                clientX: x,
                                clientY: y,
                                button: 0,
                                pointerId: 1,
                                pointerType: 'mouse'
                            }));
                        });
                    }
                    current = parentEl;
                }

                return true;
            }, { sel: selector, nm: name });
            console.log(`   ✓ JavaScript ancestor click executed`);
            await this.page.waitForTimeout(400);
        } catch (e) {
            // JS click failed
        }

        // Strategy 5: Touch events (for mobile-first sites)
        try {
            const boundingBox = await locator.boundingBox();
            if (boundingBox) {
                const touchX = boundingBox.x + boundingBox.width / 2;
                const touchY = boundingBox.y + boundingBox.height / 2;

                await this.page.evaluate(({ clientX, clientY }: { clientX: number; clientY: number }) => {
                    const el = document.elementFromPoint(clientX, clientY);
                    if (!el) return;

                    const touch = new Touch({
                        identifier: Date.now(),
                        target: el,
                        clientX,
                        clientY,
                        pageX: clientX + window.scrollX,
                        pageY: clientY + window.scrollY,
                        radiusX: 1,
                        radiusY: 1,
                        rotationAngle: 0,
                        force: 1
                    });

                    el.dispatchEvent(new TouchEvent('touchstart', {
                        bubbles: true,
                        cancelable: true,
                        touches: [touch],
                        targetTouches: [touch],
                        changedTouches: [touch]
                    }));

                    el.dispatchEvent(new TouchEvent('touchend', {
                        bubbles: true,
                        cancelable: true,
                        touches: [],
                        targetTouches: [],
                        changedTouches: [touch]
                    }));
                }, { clientX: touchX, clientY: touchY });

                console.log(`   ✓ Touch events dispatched`);
                await this.page.waitForTimeout(300);
            }
        } catch (e) {
            // Touch events failed (not supported in all contexts)
        }

        // Strategy 6: Focus + Enter key (accessibility fallback)
        try {
            await locator.focus();
            await this.page.keyboard.press('Enter');
            console.log(`   ✓ Focus + Enter executed`);
            await this.page.waitForTimeout(300);
        } catch (e) {
            // Focus + Enter failed
        }

        // Strategy 6.5: Find ancestor with data-* attribute or clickable class from the time element
        try {
            const ancestorClicked = await this.page.evaluate((nm: string) => {
                const normalized = nm.trim().toLowerCase();

                // Find elements containing the time text
                const allElements = Array.from(document.querySelectorAll('span, div, td, li, p, label'));
                for (let idx = 0; idx < allElements.length; idx++) {
                    const el = allElements[idx];
                    const text = el.textContent?.trim().toLowerCase();
                    if (text === normalized || text === nm.trim()) {
                        // Walk up to find clickable ancestor
                        let parent = el.parentElement;
                        for (let i = 0; i < 10 && parent; i++) {
                            // Check for any data-* attribute related to time/value
                            const attrs = parent.getAttributeNames();
                            let hasDataAttr = false;
                            let hasEventAttr = false;
                            const dataAttrsList: string[] = [];

                            for (let ai = 0; ai < attrs.length; ai++) {
                                const a = attrs[ai];
                                if (a.startsWith('data-')) {
                                    hasDataAttr = true;
                                    dataAttrsList.push(`${a}="${parent.getAttribute(a)}"`);
                                }
                                if (a.includes('click') || a.startsWith('ng-') || a.startsWith('_ng') ||
                                    a.startsWith('@') || a.startsWith('v-on') || a === 'onclick') {
                                    hasEventAttr = true;
                                }
                            }

                            // Check for clickable indicators
                            const classes = (parent.className || '').toLowerCase();
                            const clickablePatterns = ['slot', 'book', 'time', 'hour', 'option',
                                'select', 'item', 'card', 'cell', 'row', 'available'];
                            let hasClickableClass = false;
                            for (let ci = 0; ci < clickablePatterns.length; ci++) {
                                if (classes.includes(clickablePatterns[ci])) {
                                    hasClickableClass = true;
                                    break;
                                }
                            }

                            // Check for cursor pointer
                            const hasPointer = window.getComputedStyle(parent).cursor === 'pointer';

                            if (hasDataAttr || hasClickableClass || hasEventAttr || hasPointer) {
                                (parent as HTMLElement).click();

                                // Dispatch full mouse event sequence
                                const rect = parent.getBoundingClientRect();
                                const x = rect.left + rect.width / 2;
                                const y = rect.top + rect.height / 2;

                                const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
                                for (let ei = 0; ei < events.length; ei++) {
                                    parent.dispatchEvent(new MouseEvent(events[ei], {
                                        view: window,
                                        bubbles: true,
                                        cancelable: true,
                                        clientX: x,
                                        clientY: y,
                                        button: 0
                                    }));
                                }

                                return `${parent.tagName} class="${parent.className}" ${dataAttrsList.join(' ')}`;
                            }
                            parent = parent.parentElement;
                        }
                    }
                }
                return null;
            }, name);

            if (ancestorClicked) {
                console.log(`   🎯 Found clickable ancestor: ${ancestorClicked}`);
                await this.page.waitForTimeout(500);

                if (await checkStateChanged('clickable ancestor click')) {
                    return successResult;
                }
            }
        } catch (e) {
            // Clickable ancestor strategy failed
        }

        // Strategy 7: Find Angular-specific slot container and trigger
        try {
            const clicked = await this.page.evaluate((nm: string) => {
                // Find all elements that contain the time text
                const allElements = document.querySelectorAll('*');
                for (let i = 0; i < allElements.length; i++) {
                    const el = allElements[i] as HTMLElement;
                    if (el.textContent?.trim() === nm.trim() && el.children.length === 0) {
                        // This is likely the time label, find the clickable row/slot container
                        let container = el.parentElement;
                        for (let j = 0; j < 10 && container; j++) {
                            const classes = container.className.toLowerCase();
                            const tag = container.tagName.toLowerCase();

                            // Look for common slot container patterns
                            if (classes.includes('slot') || classes.includes('time') ||
                                classes.includes('row') || classes.includes('item') ||
                                classes.includes('card') || classes.includes('option') ||
                                classes.includes('available') || classes.includes('tee') ||
                                tag === 'tr' || tag === 'li' ||
                                container.getAttribute('role') === 'option' ||
                                container.getAttribute('role') === 'listitem' ||
                                container.getAttribute('role') === 'row') {

                                // Found potential container, trigger click
                                container.click();

                                // Also try triggering Angular zone
                                if ((window as any).ng) {
                                    try {
                                        const zone = (window as any).ng.probe(container)?.injector?.get?.('NgZone');
                                        if (zone) {
                                            zone.run(() => container!.click());
                                        }
                                    } catch { }
                                }

                                return true;
                            }
                            container = container.parentElement;
                        }
                    }
                }
                return false;
            }, name);
            if (clicked) {
                console.log(`   ✓ Angular slot container click attempted`);
            }
        } catch (e) {
            // Angular specific click failed
        }

        // Strategy 8: Click sibling icon element (common pattern in booking systems)
        try {
            const siblingClicked = await this.page.evaluate((nm: string) => {
                // Find the time span
                const allSpans = document.querySelectorAll('span');
                for (let i = 0; i < allSpans.length; i++) {
                    const span = allSpans[i] as HTMLElement;
                    if (span.textContent?.trim() === nm.trim()) {
                        const parent = span.parentElement;
                        if (!parent) continue;

                        // Strategy 8a: Find sibling <i> element (icon) and click parent
                        const siblings = parent.children;
                        for (let j = 0; j < siblings.length; j++) {
                            const sibling = siblings[j] as HTMLElement;
                            if (sibling.tagName === 'I' || sibling.classList.contains('icon') ||
                                sibling.classList.contains('fa') || sibling.classList.contains('material-icons')) {
                                // Click the icon's parent container
                                parent.click();
                                sibling.click();
                                return 'sibling-icon';
                            }
                        }

                        // Strategy 8b: The parent div/li might be the clickable element
                        // Check if parent has any Angular/event attributes
                        const attrs = parent.getAttributeNames();
                        for (const attr of attrs) {
                            if (attr.startsWith('ng-') || attr.startsWith('_ng') ||
                                attr.startsWith('(') || attr.includes('click')) {
                                parent.click();
                                return 'parent-angular';
                            }
                        }

                        // Strategy 8c: Grandparent might be the row
                        const grandparent = parent.parentElement;
                        if (grandparent) {
                            const gpAttrs = grandparent.getAttributeNames();
                            for (const attr of gpAttrs) {
                                if (attr.startsWith('ng-') || attr.startsWith('_ng') ||
                                    attr.startsWith('(') || attr.includes('click')) {
                                    grandparent.click();
                                    return 'grandparent-angular';
                                }
                            }
                            // Also try clicking grandparent anyway
                            grandparent.click();
                        }

                        return 'tried-parents';
                    }
                }
                return null;
            }, name);
            if (siblingClicked) {
                console.log(`   ✓ Sibling/parent click strategy: ${siblingClicked}`);
                await this.page.waitForTimeout(500);
            }
        } catch (e) {
            // Sibling click failed
        }

        // Strategy 9: Use Playwright's locator with text and click the containing row
        try {
            // Find by exact text and get all ancestors
            const textLocator = this.page.getByText(name, { exact: true });
            const count = await textLocator.count();

            if (count > 0) {
                // Try clicking the first match's parent elements
                const element = textLocator.first();

                // Get the bounding box and click slightly above (where the row header might be)
                const box = await element.boundingBox();
                if (box) {
                    // Click to the left of the text (where a checkbox/radio might be)
                    await this.page.mouse.click(box.x - 20, box.y + box.height / 2);
                    console.log(`   ✓ Clicked left of time slot`);
                    await this.page.waitForTimeout(300);

                    // Also try clicking the row area above
                    await this.page.mouse.click(box.x + box.width / 2, box.y - 10);
                    console.log(`   ✓ Clicked above time slot`);
                    await this.page.waitForTimeout(300);
                }
            }
        } catch (e) {
            // Text locator click failed
        }

        // Wait for any state updates
        await this.page.waitForTimeout(600);

        // Final check if anything changed
        const stateChanged = await checkStateChanged('all strategies');
        if (!stateChanged) {
            console.log(`   ⚠️ Page content unchanged - click may not have worked`);

            // Last resort: try to find what the actual clickable element structure is
            try {
                const debugInfo = await this.page.evaluate((timeName: string) => {
                    const spans = Array.from(document.querySelectorAll('span')).filter(
                        el => el.textContent?.trim() === timeName.trim()
                    );
                    if (spans.length === 0) return 'Time slot not found';

                    const span = spans[0] as HTMLElement;
                    const info: string[] = [];

                    // Walk up and describe each ancestor
                    let current: HTMLElement | null = span;
                    for (let i = 0; i < 6 && current; i++) {
                        const tag = current.tagName.toLowerCase();
                        const classes = current.className || 'no-class';
                        const attrs = current.getAttributeNames().filter(a =>
                            a.includes('click') || a.startsWith('ng') || a.startsWith('_ng') ||
                            a.startsWith('(') || a.startsWith('@')
                        );
                        info.push(`${i}: <${tag} class="${classes}"${attrs.length ? ' attrs=' + attrs.join(',') : ''}>`);
                        current = current.parentElement;
                    }
                    return info.join(' → ');
                }, name);
                console.log(`   🔍 DOM structure: ${debugInfo}`);
            } catch { }
        }

        // Return success result (we tried all strategies)
        return {
            available: true,
            slotName: name,
            reason: stateChanged ? 'slot clicked successfully' : 'click attempted but page unchanged',
            nearbyAvailable: []
        };
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
     * Wait for page to stabilize (no pending network requests, DOM settled)
     */
    async waitForPageStable(): Promise<void> {
        if (!this.page) return;

        try {
            // Quick wait for DOM content (short timeout)
            await this.page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => { });

            // Try network idle but don't wait too long
            await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });

            // Brief wait for dynamic content
            await this.page.waitForTimeout(300);

        } catch {
            // If waiting fails, continue anyway
        }
    }

    /**
     * Extended wait for page navigation (only used after detected URL change)
     */
    async waitForNavigation(): Promise<void> {
        if (!this.page) return;

        try {
            await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => { });
            await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => { });
            await this.page.waitForTimeout(500);
        } catch {
            // Continue anyway
        }
    }

    /**
     * Switch to iframe if present and return to main frame
     */
    async getIframeContent(): Promise<string[]> {
        if (!this.page) return [];

        const iframeUrls: string[] = [];
        try {
            const frames = this.page.frames();
            for (const frame of frames) {
                if (frame !== this.page.mainFrame()) {
                    iframeUrls.push(frame.url());
                }
            }
        } catch {
            // Ignore iframe errors
        }
        return iframeUrls;
    }

    /**
     * Buscar y hacer clic en contenido dentro de iframes
     * Útil cuando el contenido de reservas está en un iframe externo
     */
    async findAndClickInIframes(textToFind: string): Promise<boolean> {
        if (!this.page) return false;

        try {
            const frames = this.page.frames();
            for (const frame of frames) {
                try {
                    // Buscar elemento con el texto en este frame
                    const locator = frame.getByText(textToFind, { exact: false });
                    if (await locator.count() > 0 && await locator.first().isVisible({ timeout: 1000 })) {
                        console.log(`   🖼️ Found "${textToFind}" in iframe: ${frame.url()}`);
                        await locator.first().click({ timeout: 3000 });
                        return true;
                    }
                } catch {
                    // Continue to next frame
                }
            }
        } catch {
            // Ignore iframe errors
        }
        return false;
    }

    /**
     * Detectar si hay un modal/popup visible después de un clic
     */
    async detectPopupOrModal(): Promise<boolean> {
        if (!this.page) return false;

        const modalSelectors = [
            '.modal.show',
            '.modal.in',
            '[role="dialog"]',
            '.popup:visible',
            '.overlay:visible',
            '[class*="modal"][class*="open"]',
            '[class*="modal"][class*="show"]',
            '[class*="dialog"][class*="open"]',
            '[class*="popup"][class*="visible"]',
            '.fancybox-container',
            '.lightbox',
            '[class*="booking"][class*="modal"]',
            '[class*="reservation"][class*="popup"]',
        ];

        for (const selector of modalSelectors) {
            try {
                const locator = this.page.locator(selector);
                if (await locator.count() > 0 && await locator.first().isVisible({ timeout: 500 })) {
                    console.log(`   🔲 Modal/popup detectado: ${selector}`);
                    return true;
                }
            } catch {
                // Continue
            }
        }
        return false;
    }

    /**
     * Obtener todas las URLs de enlaces en la página actual
     * Útil para encontrar la URL correcta de reservas
     */
    async getAllLinks(): Promise<{ text: string; href: string }[]> {
        if (!this.page) return [];

        try {
            return await this.page.evaluate(() => {
                const links: { text: string; href: string }[] = [];
                const anchors = document.querySelectorAll('a[href]');
                anchors.forEach(a => {
                    const href = a.getAttribute('href');
                    const text = a.textContent?.trim() || '';
                    if (href && text && href !== '#' && !href.startsWith('javascript:')) {
                        links.push({ text: text.substring(0, 50), href });
                    }
                });
                return links;
            });
        } catch {
            return [];
        }
    }

    /**
     * Find and click a time slot directly by its time value (e.g., "10:00am")
     * Uses JavaScript to scroll to the element and click it efficiently
     * Returns TimeSlotResult with availability info
     */
    async findAndClickTimeSlot(targetTime: string): Promise<TimeSlotResult> {
        if (!this.page) throw new Error('Browser not launched');

        console.log(`   🎯 Direct time slot search for: "${targetTime}"`);

        // Normalize the target time for matching (handle various formats)
        const normalizedTarget = targetTime.toLowerCase().replace(/\s+/g, '').trim();

        // Helper to normalize time strings for comparison
        const normalizeTimeStr = (str: string) => str.toLowerCase().replace(/\s+/g, '').trim();

        // Use JavaScript to find, scroll to, and click the time slot
        const result = await this.page.evaluate((target: string) => {
            const normalizeTime = (str: string) => str.toLowerCase().replace(/\s+/g, '').trim();

            // ========== STRATEGY 1: Search [data-tt] attributes FIRST (fastest) ==========
            const bookitSlots = Array.from(document.querySelectorAll('[data-tt]'));
            console.log(`🔍 Found ${bookitSlots.length} elements with data-tt attribute`);

            for (const slot of bookitSlots) {
                const dataTT = slot.getAttribute('data-tt') || '';
                const normalizedDataTT = normalizeTime(dataTT);

                // Match: "10:10am" === "10:10am" or "1010am" === "1010am"
                const targetNoColon = target.replace(':', '');
                const dataTTNoColon = normalizedDataTT.replace(':', '');

                if (normalizedDataTT === target || dataTTNoColon === targetNoColon) {
                    // Check if available (not filled/booked)
                    const classes = (slot.className || '').toLowerCase();
                    const isUnavailable = classes.includes('filled') ||
                        classes.includes('booked') ||
                        classes.includes('reserved') ||
                        classes.includes('unavailable') ||
                        classes.includes('disabled');

                    // Scroll into view
                    (slot as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'center' });

                    if (!isUnavailable) {
                        (slot as HTMLElement).click();
                        return {
                            found: true,
                            available: true,
                            clicked: true,
                            classes: classes,
                            method: 'data-tt-direct'
                        };
                    } else {
                        return {
                            found: true,
                            available: false,
                            clicked: false,
                            classes: classes,
                            method: 'data-tt-unavailable'
                        };
                    }
                }
            }

            // ========== STRATEGY 2: Search .thetime spans (Cayaco specific) ==========
            const theTimeSpans = Array.from(document.querySelectorAll('.thetime'));
            for (const span of theTimeSpans) {
                const text = normalizeTime(span.textContent || '');
                const targetNoColon = target.replace(':', '');
                const textNoColon = text.replace(':', '');

                if (text === target || textNoColon === targetNoColon) {
                    // Find the parent .bookit container
                    let bookitParent = span.parentElement;
                    for (let i = 0; i < 5 && bookitParent; i++) {
                        if (bookitParent.classList.contains('bookit') || bookitParent.hasAttribute('data-tt')) {
                            break;
                        }
                        bookitParent = bookitParent.parentElement;
                    }

                    const clickTarget = bookitParent || span;
                    const classes = (clickTarget.className || '').toLowerCase();
                    const isUnavailable = classes.includes('filled') || classes.includes('booked');

                    (clickTarget as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'center' });

                    if (!isUnavailable) {
                        (clickTarget as HTMLElement).click();
                        return { found: true, available: true, clicked: true, classes, method: 'thetime-span' };
                    }
                    return { found: true, available: false, clicked: false, classes, method: 'thetime-unavailable' };
                }
            }

            // ========== STRATEGY 3: Generic text search (fallback) ==========
            const allElements = Array.from(document.querySelectorAll('span, div, td, a, button'));

            for (const el of allElements) {
                const text = (el.textContent || '').toLowerCase().replace(/\s+/g, '').trim();
                if (text === target || text === target.replace('am', '') || text === target.replace('pm', '')) {
                    let parent = el.parentElement;
                    let isAvailable = true;
                    let containerClasses = '';

                    for (let i = 0; i < 8 && parent; i++) {
                        const classes = (parent.className || '').toLowerCase();
                        containerClasses += ' ' + classes;

                        if (classes.includes('filled') || classes.includes('booked') ||
                            classes.includes('reserved') || classes.includes('unavailable') ||
                            classes.includes('disabled') || classes.includes('taken')) {
                            isAvailable = false;
                            break;
                        }
                        parent = parent.parentElement;
                    }

                    (el as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'center' });

                    if (isAvailable) {
                        let clickTarget: HTMLElement | null = el as HTMLElement;
                        let current = el.parentElement;

                        for (let i = 0; i < 5 && current; i++) {
                            if (current.hasAttribute('data-tt') ||
                                current.classList.contains('bookit') ||
                                current.hasAttribute('onclick') ||
                                current.tagName === 'A' ||
                                current.tagName === 'BUTTON' ||
                                window.getComputedStyle(current).cursor === 'pointer') {
                                clickTarget = current as HTMLElement;
                                break;
                            }
                            current = current.parentElement;
                        }

                        if (clickTarget) {
                            clickTarget.click();
                            return { found: true, available: true, clicked: true, classes: containerClasses, method: 'fallback' };
                        }
                    }

                    return { found: true, available: false, clicked: false, classes: containerClasses, method: 'fallback-unavailable' };
                }
            }

            return { found: false, available: false, clicked: false, classes: '', method: 'not-found' };
        }, normalizedTarget);

        if (!result.found) {
            console.log(`   ❌ Time slot "${targetTime}" not found on page`);

            // Try scrolling down to find more time slots
            const scrollResult = await this.scrollToFindTimeSlot(normalizedTarget);
            if (scrollResult) {
                return scrollResult;
            }

            return {
                available: false,
                slotName: targetTime,
                reason: 'time slot not found on page',
                nearbyAvailable: await this.findNearbyAvailableSlots(targetTime)
            };
        }

        if (!result.available) {
            console.log(`   ❌ Time slot "${targetTime}" is NOT available`);
            console.log(`   📋 Container classes: ${result.classes.trim()}`);

            const nearbySlots = await this.findNearbyAvailableSlots(targetTime);
            if (nearbySlots.length > 0) {
                console.log(`   🕐 Nearby available slots: ${nearbySlots.join(', ')}`);
            }

            return {
                available: false,
                slotName: targetTime,
                reason: `slot has class indicating unavailable: ${result.classes.trim()}`,
                nearbyAvailable: nearbySlots
            };
        }

        console.log(`   ✅ Found and clicked time slot "${targetTime}"`);
        this.lastTimeSlotResult = {
            available: true,
            slotName: targetTime,
            reason: 'slot clicked successfully via direct search',
            nearbyAvailable: []
        };

        return this.lastTimeSlotResult;
    }

    /**
     * Scroll through the page to find a specific time slot
     * Returns TimeSlotResult if found, null if not found after scrolling
     */
    private async scrollToFindTimeSlot(targetTime: string): Promise<TimeSlotResult | null> {
        if (!this.page) return null;

        const maxScrollAttempts = 10;
        let lastHeight = 0;

        for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
            // Scroll down
            await this.page.evaluate(() => {
                window.scrollBy(0, 400);
            });
            await this.page.waitForTimeout(200);

            // Check if we found the time slot now
            const found = await this.page.evaluate((target: string) => {
                const allElements = Array.from(document.querySelectorAll('span, div, td'));
                for (const el of allElements) {
                    const text = (el.textContent || '').toLowerCase().replace(/\s+/g, '').trim();
                    if (text === target) {
                        // Check availability
                        let parent = el.parentElement;
                        let isAvailable = true;

                        for (let i = 0; i < 8 && parent; i++) {
                            const classes = (parent.className || '').toLowerCase();
                            if (classes.includes('filled') || classes.includes('booked') ||
                                classes.includes('reserved') || classes.includes('unavailable')) {
                                isAvailable = false;
                                break;
                            }
                            parent = parent.parentElement;
                        }

                        // Scroll into view and click if available
                        (el as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'center' });

                        if (isAvailable) {
                            // Find clickable parent
                            let clickTarget: HTMLElement | null = el as HTMLElement;
                            let current = el.parentElement;
                            for (let i = 0; i < 5 && current; i++) {
                                if (current.hasAttribute('data-tt') ||
                                    current.classList.contains('bookit') ||
                                    current.hasAttribute('onclick')) {
                                    clickTarget = current as HTMLElement;
                                    break;
                                }
                                current = current.parentElement;
                            }
                            if (clickTarget) clickTarget.click();
                        }

                        return { found: true, available: isAvailable };
                    }
                }
                return { found: false, available: false };
            }, targetTime);

            if (found.found) {
                console.log(`   🔍 Found "${targetTime}" after ${attempt + 1} scroll(s)`);
                return {
                    available: found.available,
                    slotName: targetTime,
                    reason: found.available ? 'found after scrolling' : 'slot unavailable',
                    nearbyAvailable: found.available ? [] : await this.findNearbyAvailableSlots(targetTime)
                };
            }

            // Check if we've hit the bottom
            const newHeight = await this.page.evaluate(() => document.body.scrollHeight);
            if (newHeight === lastHeight) {
                console.log(`   ⚠️ Reached end of scroll area without finding "${targetTime}"`);
                break;
            }
            lastHeight = newHeight;
        }

        return null;
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