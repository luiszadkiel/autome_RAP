/**
 * Enhanced Snapshot - Takes vision-ready snapshots with annotations
 */

import type { Page } from 'playwright';
import type { VisionSnapshot, SnapshotElement } from '../core/types.js';

export class EnhancedSnapshot {
    // 2MB safe limit for OpenAI
    private readonly MAX_IMAGE_SIZE = 2 * 1024 * 1024;

    /**
     * Take a vision-optimized snapshot
     */
    async takeVisionSnapshot(page: Page, elements: SnapshotElement[]): Promise<VisionSnapshot> {
        // 1. Inject visual badges
        await this.annotateScreenshot(page, elements);

        // 2. Capture with adaptive compression
        let quality = 80;
        let screenshot: Buffer;
        let base64 = '';

        try {
            do {
                screenshot = await page.screenshot({
                    type: 'jpeg', // JPEG compresses better
                    quality: quality,
                    fullPage: false, // Only visible viewport is important for "what to do next"
                });

                if (screenshot.length > this.MAX_IMAGE_SIZE) {
                    quality -= 10;
                    console.warn(`   ⚠️ Image too large (${(screenshot.length / 1024 / 1024).toFixed(2)}MB), reducing quality to ${quality}`);
                }
            } while (screenshot.length > this.MAX_IMAGE_SIZE && quality > 20);

            if (screenshot.length > this.MAX_IMAGE_SIZE) {
                throw new Error('Cannot compress screenshot below size limit');
            }

            base64 = screenshot.toString('base64');

        } finally {
            // 3. Clean up badges (optional, but good for user experience if they are watching)
            // For now we keep them or we could remove them. 
            // In a real agent loop, the next action will likely cause a reload or change anyway.
            await this.cleanupBadges(page);
        }

        return {
            screenshot: base64,
            elements: elements,
            url: page.url(),
            viewport: await page.viewportSize(),
            size: screenshot.length,
            quality: quality
        };
    }

    /**
     * Inject numbered badges into the page
     */
    private async annotateScreenshot(page: Page, elements: SnapshotElement[]): Promise<void> {
        // Elements should match what we found in takeSnapshot
        // We pass them in to avoid re-querying and ensuring Consistency with text ref

        await page.evaluate((elementsData) => {
            // Remove existing badges if any
            document.querySelectorAll('.claw-badge').forEach(el => el.remove());

            elementsData.forEach(elData => {
                let el: Element | null = null;

                // Try to find the element again in DOM
                if (elData.selector) {
                    try {
                        el = document.querySelector(elData.selector);
                    } catch { }
                }

                if (!el && elData.xpath) {
                    try {
                        const result = document.evaluate(elData.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        if (result.singleNodeValue) {
                            el = result.singleNodeValue as Element;
                        }
                    } catch { }
                }

                if (el && el.getBoundingClientRect) {
                    const rect = el.getBoundingClientRect();
                    // Only label if visible in viewport
                    if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0 && rect.top <= window.innerHeight) {
                        const badge = document.createElement('div');
                        badge.className = 'claw-badge';
                        badge.textContent = elData.ref.replace('e', ''); // Just the number
                        badge.style.cssText = `
                            position: fixed;
                            top: ${rect.top}px;
                            left: ${rect.left}px;
                            background: #ff0000;
                            color: white;
                            padding: 2px 5px;
                            border-radius: 3px;
                            font-size: 11px;
                            font-weight: bold;
                            z-index: 2147483647;
                            pointer-events: none;
                            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
                            font-family: sans-serif;
                            border: 1px solid white;
                        `;
                        document.body.appendChild(badge);
                    }
                }
            });
        }, elements);
    }

    private async cleanupBadges(page: Page): Promise<void> {
        await page.evaluate(() => {
            document.querySelectorAll('.claw-badge').forEach(el => el.remove());
        }).catch(() => { });
    }
}
