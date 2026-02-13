import { SiteAdapter, LoginStrategy, CalendarStrategy, TimeSlotStrategy, PaymentDetector, SiteSelectors } from './base-adapter.js';

export class OutlookAdapter implements SiteAdapter {
    name = 'outlook';

    matches(url: string): boolean {
        return url.includes('outlook.office365.com') || url.includes('outlook.live.com') || url.includes('bookings');
    }

    getLoginStrategy(): LoginStrategy | null {
        return {
            emailSelector: 'input[type="email"], input[name="loginfmt"]',
            passwordSelector: 'input[type="password"], input[name="passwd"]',
            submitSelector: 'input[type="submit"], button[type="submit"], button:has-text("Next"), button:has-text("Siguiente"), button:has-text("Sign in")',
            successIndicator: '[id="O365_MainLink_Me"], [id="O365_MainLink_Settings"]',
            errorIndicator: '[id="usernameError"], [id="passwordError"], .alert-error'
        };
    }

    getCalendarStrategy(): CalendarStrategy | null {
        return {
            calendarContainerSelector: '#app [class*="calendar"], #app [role="application"], .ms-DatePicker-picker, [class*="calendar"], [role="application"]',
            daySelector: '#app button:not([disabled]), #app [role="gridcell"]:not([disabled]), button[class*="day"]:not([disabled]), [role="gridcell"]:not([disabled])',
            nextMonthSelector: '#app button[aria-label*="Next"], #app button[title*="Next"], button[title="Next month"], button[aria-label="Next month"], [class*="nextMonth"]',
            prevMonthSelector: '#app button[aria-label*="Previous"], #app button[title*="Previous"], button[title="Previous month"], button[aria-label="Previous month"], [class*="prevMonth"]',
            selectedDayClass: 'ms-DatePicker-day--selected',
            disabledDayClass: 'ms-DatePicker-day--disabled',
            getDayNumber(element: Element): number {
                // Para Outlook Bookings, los días pueden estar en botones con números
                const text = element.textContent?.trim() || '0';
                const number = parseInt(text, 10);
                // Si el texto contiene solo números (1-31), retornarlo
                if (!isNaN(number) && number >= 1 && number <= 31) {
                    return number;
                }
                // Intentar encontrar el número en atributos data-*
                const dataDate = element.getAttribute('data-date');
                if (dataDate) {
                    const dateMatch = dataDate.match(/\d{4}-\d{2}-(\d{2})/);
                    if (dateMatch) {
                        return parseInt(dateMatch[1], 10);
                    }
                }
                return 0;
            }
        };
    }

    getTimeSlotStrategy(): TimeSlotStrategy | null {
        return {
            containerSelector: '#app [class*="time"], #app [class*="slot"], #app [class*="schedule"], [class*="time"], [class*="slot"], [class*="schedule"]',
            slotSelector: '#app button:not([disabled]), #app [role="button"]:not([disabled]), [class*="slot"]:not([class*="disabled"]), button[data-time], [role="option"]:not([disabled])',
            selectedClass: 'selected',
            disabledClass: 'disabled unavailable',
            getSlotTime(element: Element): string {
                // Intentar obtener el tiempo del texto del elemento
                const text = element.textContent?.trim() || '';
                // Buscar patrones de tiempo (HH:MM, HH:MM AM/PM, etc.)
                const timeMatch = text.match(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/i);
                if (timeMatch) {
                    return timeMatch[0];
                }
                // Intentar obtener de atributos data-*
                const dataTime = element.getAttribute('data-time') || element.getAttribute('data-slot-time');
                if (dataTime) {
                    return dataTime;
                }
                // Retornar el texto completo si no hay patrón de tiempo claro
                return text;
            }
        };
    }

    getPaymentDetector(): PaymentDetector {
        return {
            indicators: [],
            urlPatterns: []
        };
    }

    getSelectors(): SiteSelectors {
        return {
            // Formularios: incluir elementos dentro de #app cuando está cargado
            forms: '#app form, form, #app [class*="form"]',
            // Botones: incluir botones dentro de #app, servicios seleccionables, botón de reserva
            buttons: '#app button, #app [role="button"], button, [role="button"], .ms-Button, [class*="ms-Button"], #app [class*="service"], #app [class*="Reservar"]',
            // Inputs: incluir campos de texto, notas, detalles dentro de #app
            inputs: '#app input, #app select, #app textarea, input, select, textarea, [data-automation-id*="input"], #app [class*="input"], #app [class*="field"]',
            // Modales: diálogos de Microsoft y modales dentro de #app
            modals: '#app [role="dialog"], [role="dialog"], .ms-Modal, [class*="Modal"]',
            // Errores: mensajes de error de Microsoft y dentro de #app
            errors: '#app [class*="error"], #app [id*="Error"], [class*="error"], [id*="Error"], .ms-MessageBar--error',
            // Loading: pantalla de carga inicial y spinners dentro de #app
            loading: '#loadingScreen, #loadingSpinner, #app [class*="spinner"], #app [class*="loading"], [class*="spinner"], [role="progressbar"], .ms-Spinner, [class*="Spinner"], [data-automation-id*="loading"]'
        };
    }
}
