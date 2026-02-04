import type { SiteAdapter } from './base-adapter.js';
import { GenericAdapter } from './base-adapter.js';
import { BookingAdapter } from './booking-adapter.js';
import { EcommerceAdapter } from './ecommerce-adapter.js';

export { SiteAdapter, GenericAdapter, BookingAdapter, EcommerceAdapter };

// === FÁBRICA DE ADAPTADORES ===
export class AdapterFactory {
    private static adapters: SiteAdapter[] = [
        new BookingAdapter(),
        new EcommerceAdapter(),
        new GenericAdapter() // Siempre último (fallback)
    ];

    static getAdapter(url: string): SiteAdapter {
        return this.adapters.find(a => a.matches(url)) || new GenericAdapter();
    }

    // Permite agregar adaptadores personalizados
    static registerAdapter(adapter: SiteAdapter): void {
        // Insertar antes del genérico
        this.adapters.splice(this.adapters.length - 1, 0, adapter);
    }
}
