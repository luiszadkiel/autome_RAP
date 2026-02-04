import { GenericAdapter, CalendarStrategy, TimeSlotStrategy } from './base-adapter.js';

// === ADAPTADOR ESPECÍFICO: Booking/Reservas ===
export class BookingAdapter extends GenericAdapter {
    name = 'booking';

    matches(url: string): boolean {
        const bookingPatterns = [
            /booking\.com/i, /airbnb/i, /expedia/i, /hotels/i,
            /reserv/i, /book/i, /golf/i, /appointment/i, /schedule/i
        ];
        return bookingPatterns.some(p => p.test(url));
    }

    getCalendarStrategy(): CalendarStrategy {
        const base = super.getCalendarStrategy()!;
        return {
            ...base,
            // Selectores más específicos para sitios de reservas
            daySelector: '.calendar-day:not(.unavailable), .day-cell:not(.blocked), [data-date]:not([disabled])',
            disabledDayClass: 'unavailable blocked disabled'
        };
    }

    getTimeSlotStrategy(): TimeSlotStrategy {
        const base = super.getTimeSlotStrategy()!;
        return {
            ...base,
            slotSelector: '.time-slot:not(.booked), .slot-available, [data-available="true"]',
            disabledClass: 'booked unavailable full'
        };
    }
}
