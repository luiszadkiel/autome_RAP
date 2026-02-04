import { OptimizedSnapshot } from '../optimized-snapshot.js';

export interface SiteAdapter {
    name: string;

    // Detecta si este adaptador aplica para el sitio actual
    matches(url: string): boolean;

    // Estrategias específicas del sitio
    getLoginStrategy(): LoginStrategy | null;
    getCalendarStrategy(): CalendarStrategy | null;
    getTimeSlotStrategy(): TimeSlotStrategy | null;
    getPaymentDetector(): PaymentDetector;

    // Selectores específicos del sitio
    getSelectors(): SiteSelectors;
}

export interface LoginStrategy {
    emailSelector: string;
    passwordSelector: string;
    submitSelector: string;
    successIndicator: string;
    errorIndicator: string;
}

export interface CalendarStrategy {
    calendarContainerSelector: string;
    daySelector: string;
    nextMonthSelector: string;
    prevMonthSelector: string;
    selectedDayClass: string;
    disabledDayClass: string;
    getDayNumber(element: Element): number;
}

export interface TimeSlotStrategy {
    containerSelector: string;
    slotSelector: string;
    selectedClass: string;
    disabledClass: string;
    getSlotTime(element: Element): string;
}

export interface PaymentDetector {
    indicators: string[];
    urlPatterns: RegExp[];
}

export interface SiteSelectors {
    forms: string;
    buttons: string;
    inputs: string;
    modals: string;
    errors: string;
    loading: string;
}

// === ADAPTADOR GENÉRICO (funciona en cualquier sitio) ===
export class GenericAdapter implements SiteAdapter {
    name = 'generic';

    matches(url: string): boolean {
        return true; // Siempre aplica como fallback
    }

    getLoginStrategy(): LoginStrategy | null {
        return {
            emailSelector: 'input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="email"]',
            passwordSelector: 'input[type="password"], input[name="password"], input[id*="password"]',
            submitSelector: 'button[type="submit"], input[type="submit"], button:has-text("login"), button:has-text("iniciar"), button:has-text("entrar")',
            successIndicator: '[class*="dashboard"], [class*="welcome"], [class*="profile"], nav [class*="user"]',
            errorIndicator: '.error, .alert-danger, [role="alert"]'
        };
    }

    getCalendarStrategy(): CalendarStrategy | null {
        return {
            calendarContainerSelector: '[class*="calendar"], [class*="datepicker"], [role="grid"]',
            daySelector: '[class*="day"]:not([class*="disabled"]), td[data-date], [role="gridcell"]',
            nextMonthSelector: '[class*="next"], button:has-text(">"), [aria-label*="next"]',
            prevMonthSelector: '[class*="prev"], button:has-text("<"), [aria-label*="prev"]',
            selectedDayClass: 'selected',
            disabledDayClass: 'disabled',
            getDayNumber(element: Element): number {
                return parseInt(element.textContent || '0');
            }
        };
    }

    getTimeSlotStrategy(): TimeSlotStrategy | null {
        return {
            containerSelector: '[class*="time"], [class*="slot"], [class*="schedule"]',
            slotSelector: '[class*="slot"]:not([class*="disabled"]), button[data-time], [role="option"]',
            selectedClass: 'selected',
            disabledClass: 'disabled',
            getSlotTime(element: Element): string {
                return element.textContent?.trim() || '';
            }
        };
    }

    getPaymentDetector(): PaymentDetector {
        return {
            // Indicadores más estrictos - solo formularios de pago reales
            indicators: [
                'input[name="card_number"]', 'input[name="cardnumber"]', 'input[id="card-number"]',
                'input[name="credit_card"]', 'input[autocomplete="cc-number"]',
                'iframe[src*="stripe.com"]', 'iframe[src*="paypal.com"]', 'iframe[src*="braintree"]',
                'form[action*="payment"]', 'form[action*="checkout"]',
                '[data-braintree-id]', '[data-stripe]'
            ],
            // Patrones de URL más específicos (solo rutas de checkout activo)
            urlPatterns: [
                /\/checkout\/payment/i, /\/checkout\/confirm/i,
                /\/payment\/process/i, /\/pago\/confirmar/i
            ]
        };
    }

    getSelectors(): SiteSelectors {
        return {
            forms: 'form',
            buttons: 'button, [role="button"], input[type="submit"], .btn',
            inputs: 'input:not([type="hidden"]), select, textarea',
            modals: '[role="dialog"], .modal, [aria-modal="true"]',
            errors: '.error, .alert-danger, [role="alert"], .invalid-feedback',
            loading: '.loading, .spinner, [class*="loading"], [aria-busy="true"]'
        };
    }
}
