/**
 * Modo extracción de contenido: Readability, tablas, JSON-LD/microdata/OG, precios/fechas/teléfonos.
 * Para cuando el usuario quiere "extraer información" en lugar de solo ejecutar acciones.
 */

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { Page } from 'playwright';

export interface ExtractedContent {
    readability?: { title: string; textContent: string; excerpt?: string; byline?: string };
    tables: { headers?: string[]; rows: string[][] }[];
    structuredData: { jsonLd: unknown[]; og: Record<string, string> };
    prices: string[];
    dates: string[];
    phones: string[];
}

const PRICE_REGEX = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|USD|\$|MXN|COP|ARS)|(?:€|EUR|USD|\$|MXN)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/gi;
const DATE_REGEX = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:lun|mar|mié|jue|vie|sáb|dom|mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+\d{1,2}[\/\-]\d{1,2})\b/gi;
const PHONE_REGEX = /(\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/g;

/**
 * Extrae contenido de la página para modo "extracción" (precios, disponibilidad, listados).
 */
export async function extractContent(page: Page): Promise<ExtractedContent> {
    const html = await page.content();
    const { document } = parseHTML(html);
    const result: ExtractedContent = {
        tables: [],
        structuredData: { jsonLd: [], og: {} },
        prices: [],
        dates: [],
        phones: []
    };

    // Readability (contenido principal)
    try {
        const clone = document.cloneNode(true) as Document;
        const article = new Readability(clone).parse();
        if (article) {
            result.readability = {
                title: article.title ?? '',
                textContent: (article.textContent ?? '').slice(0, 15000),
                excerpt: article.excerpt ?? undefined,
                byline: article.byline ?? undefined
            };
        }
    } catch (_) {}

    // JSON-LD
    try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (let i = 0; i < scripts.length; i++) {
            const text = scripts[i].textContent?.trim();
            if (text) {
                try {
                    result.structuredData.jsonLd.push(JSON.parse(text));
                } catch (_) {}
            }
        }
    } catch (_) {}

    // Open Graph / meta
    try {
        const og: Record<string, string> = {};
        document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach((el: Element) => {
            const p = (el.getAttribute('property') || el.getAttribute('name') || '').replace(/^(og|twitter):/, '');
            const c = el.getAttribute('content');
            if (p && c) og[p] = c;
        });
        result.structuredData.og = og;
    } catch (_) {}

    // Tablas (desde el DOM de la página vía evaluate para tener el estado actual)
    try {
        const tablesFromPage = await page.evaluate(() => {
            const out: { headers?: string[]; rows: string[][] }[] = [];
            document.querySelectorAll('table').forEach(table => {
                const rows: string[][] = [];
                const ths = table.querySelectorAll('thead th');
                const headers = ths.length ? Array.from(ths).map(th => (th.textContent || '').trim().slice(0, 80)) : undefined;
                if (headers) rows.push(headers);
                table.querySelectorAll('tbody tr, tr').forEach(tr => {
                    const cells = tr.querySelectorAll('td, th');
                    if (cells.length) rows.push(Array.from(cells).map(c => (c.textContent || '').trim().slice(0, 80)));
                });
                if (rows.length) out.push({ headers, rows });
            });
            return out;
        });
        result.tables = tablesFromPage;
    } catch (_) {}

    // Precios, fechas, teléfonos (sobre el texto de la página)
    const fullText = result.readability?.textContent ?? (await page.evaluate(() => document.body?.innerText ?? ''));
    const priceMatches = fullText.matchAll(PRICE_REGEX);
    const seenPrices = new Set<string>();
    for (const m of priceMatches) {
        const s = (m[1] || m[2] || '').trim();
        if (s && !seenPrices.has(s)) {
            seenPrices.add(s);
            result.prices.push(s);
        }
    }
    const dateMatches = fullText.matchAll(DATE_REGEX);
    const seenDates = new Set<string>();
    for (const m of dateMatches) {
        if (m[1] && !seenDates.has(m[1])) {
            seenDates.add(m[1]);
            result.dates.push(m[1]);
        }
    }
    const phoneMatches = fullText.matchAll(PHONE_REGEX);
    const seenPhones = new Set<string>();
    for (const m of phoneMatches) {
        if (m[0] && m[0].length >= 8 && !seenPhones.has(m[0])) {
            seenPhones.add(m[0]);
            result.phones.push(m[0]);
        }
    }

    return result;
}
