/**
 * Vision Cache - Caches AI decisions to save costs
 */

import { createHash } from 'crypto';
import type { VisionSnapshot, PlannedAction } from '../core/types.js';

interface CachedDecision {
    action: PlannedAction;
    timestamp: number;
    usageCount: number;
}

export class VisionCache {
    private cache = new Map<string, CachedDecision>();
    private readonly TTL = 60 * 1000; // 1 minute TTL 

    /**
     * Generate a cache key based on visual state + context
     */
    getCacheKey(snapshot: VisionSnapshot, instruction: string): string {
        // We use the first 1KB of the screenshot base64 as a quick signature
        // + full URL
        // + current instruction
        // This is a heuristic - exact pixel match + exact URL match

        return createHash('sha256')
            .update(snapshot.screenshot.slice(0, 1024))
            .update(snapshot.url)
            .update(instruction)
            .digest('hex');
    }

    /**
     * Retrieve a cached decision if valid
     */
    async get(snapshot: VisionSnapshot, instruction: string): Promise<PlannedAction | null> {
        const key = this.getCacheKey(snapshot, instruction);
        const cached = this.cache.get(key);

        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < this.TTL) {
                console.log(`\n   💰 Using cached vision decision (hit #${cached.usageCount + 1})`);
                cached.usageCount++;
                return cached.action;
            } else {
                this.cache.delete(key);
            }
        }

        return null;
    }

    /**
     * Store a decision in cache
     */
    set(snapshot: VisionSnapshot, instruction: string, action: PlannedAction): void {
        const key = this.getCacheKey(snapshot, instruction);
        this.cache.set(key, {
            action,
            timestamp: Date.now(),
            usageCount: 0
        });
    }

    /**
     * Clear cache
     */
    clear(): void {
        this.cache.clear();
    }
}
