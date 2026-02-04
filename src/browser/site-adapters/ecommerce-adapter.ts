import { GenericAdapter, PaymentDetector } from './base-adapter.js';

// === ADAPTADOR ESPECÍFICO: E-commerce ===
export class EcommerceAdapter extends GenericAdapter {
    name = 'ecommerce';

    matches(url: string): boolean {
        const ecommercePatterns = [
            /amazon/i, /ebay/i, /shopify/i, /mercadolibre/i,
            /shop/i, /store/i, /cart/i, /producto/i
        ];
        return ecommercePatterns.some(p => p.test(url));
    }

    getPaymentDetector(): PaymentDetector {
        return {
            ...super.getPaymentDetector(),
            indicators: [
                ...super.getPaymentDetector().indicators,
                '[class*="cart"]', '#cart', '.basket',
                'button:has-text("comprar")', 'button:has-text("add to cart")'
            ]
        };
    }
}
