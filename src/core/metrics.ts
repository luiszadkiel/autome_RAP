/**
 * Performance Metrics - Tracks execution speed and costs
 */

export interface SnapshotMetric {
    type: 'vision' | 'text';
    duration: number;
    timestamp: number;
    tokensInput?: number;
    tokensOutput?: number;
    imageSize?: number;
}

export class PerformanceMetrics {
    private snapshots: SnapshotMetric[] = [];
    private startTime: number = Date.now();

    /**
     * Record a snapshot/decision cycle
     */
    recordStep(metric: SnapshotMetric) {
        this.snapshots.push(metric);
    }

    /**
     * Get summary report
     */
    report() {
        const visionSnaps = this.snapshots.filter(s => s.type === 'vision');
        const textSnaps = this.snapshots.filter(s => s.type === 'text');

        const avgVision = visionSnaps.length > 0
            ? visionSnaps.reduce((sum, s) => sum + s.duration, 0) / visionSnaps.length
            : 0;

        const avgText = textSnaps.length > 0
            ? textSnaps.reduce((sum, s) => sum + s.duration, 0) / textSnaps.length
            : 0;

        return {
            totalSteps: this.snapshots.length,
            visionSteps: visionSnaps.length,
            textSteps: textSnaps.length,
            avgVisionTimeMs: Math.round(avgVision),
            avgTextTimeMs: Math.round(avgText),
            totalDuration: Date.now() - this.startTime
        };
    }

    /**
     * Print report to console
     */
    printReport() {
        const r = this.report();
        console.log('\n📊 Performance Report:');
        console.log(`   Total Steps: ${r.totalSteps} (${r.visionSteps} vision, ${r.textSteps} text)`);
        if (r.visionSteps > 0) console.log(`   ⚡ Vision Avg Time: ${(r.avgVisionTimeMs / 1000).toFixed(2)}s`);
        if (r.textSteps > 0) console.log(`   📝 Text Avg Time: ${(r.avgTextTimeMs / 1000).toFixed(2)}s`);

        if (r.visionSteps > 0 && r.textSteps > 0) {
            const speedup = r.avgTextTimeMs / r.avgVisionTimeMs;
            console.log(`   🚀 Speedup Factor: ${speedup.toFixed(1)}x`);
        }
    }
}
