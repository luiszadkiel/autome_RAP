import { chromium, Browser, BrowserContext } from 'playwright';
import { WebAgent } from './web-agent.js';

export interface ParallelTarget {
    url: string;
    name: string;
    /** URL donde el agente debe ir para iniciar sesión (si difiere de url). Si hay credentials y loginUrl, se navega primero a loginUrl. */
    loginUrl?: string;
    credentials?: {
        email?: string;
        username?: string;
        password?: string;
    };
}

export interface ParallelConfig {
    instruction: string;
    targets: ParallelTarget[];
    maxParallel?: number; // 1-10, default 3
    maxStepsPerAgent?: number;
    headless?: boolean;
}

export interface ParallelTargetResult {
    target: string;
    url: string;
    status: 'success' | 'failed' | 'error';
    extractedInfo: Array<{ type: string; content: string }>;
    summary: string;
    duration: number;
    error?: string;
}

export interface ParallelResult {
    instruction: string;
    totalTargets: number;
    successful: number;
    failed: number;
    results: ParallelTargetResult[];
    comparison: string;
    totalDuration: number;
}

export class ParallelAgent {
    private openaiApiKey: string;
    private maxParallel: number;
    private headless: boolean;
    private maxStepsPerAgent: number;

    constructor(config: {
        openaiApiKey: string;
        maxParallel?: number;
        headless?: boolean;
        maxStepsPerAgent?: number;
    }) {
        this.openaiApiKey = config.openaiApiKey;
        this.maxParallel = Math.min(Math.max(config.maxParallel || 3, 1), 10); // Limitar 1-10
        this.headless = config.headless ?? true;
        this.maxStepsPerAgent = config.maxStepsPerAgent || 20;
    }

    async run(config: ParallelConfig): Promise<ParallelResult> {
        const startTime = Date.now();
        const { instruction, targets } = config;
        const maxParallel = Math.min(Math.max(config.maxParallel || this.maxParallel, 1), 10);

        console.log(`\n🚀 ══════════════════════════════════════════════════════════`);
        console.log(`   EJECUCIÓN PARALELA - ${targets.length} objetivos`);
        console.log(`   📝 Instrucción: ${instruction}`);
        console.log(`   ⚡ Máximo paralelo: ${maxParallel}`);
        console.log(`   🌐 Navegador compartido activado`);
        console.log(`══════════════════════════════════════════════════════════\n`);

        const results: ParallelTargetResult[] = [];
        let browser: Browser | null = null;

        try {
            // Iniciar navegador compartido
            browser = await chromium.launch({ headless: this.headless });

            // Dividir targets en chunks según maxParallel
            const chunks = this.chunkArray(targets, maxParallel);

            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                const chunk = chunks[chunkIndex];
                console.log(`\n📦 Procesando lote ${chunkIndex + 1}/${chunks.length} (${chunk.length} agentes)...`);

                // Ejecutar chunk en paralelo pasando el browser
                const chunkPromises = chunk.map((target, index) =>
                    this.runSingleAgent(target, instruction, chunkIndex * maxParallel + index + 1, browser!)
                );

                const chunkResults = await Promise.allSettled(chunkPromises);
                const contextsToClose: BrowserContext[] = [];

                for (let i = 0; i < chunkResults.length; i++) {
                    const settled = chunkResults[i];
                    const target = chunk[i];

                    if (settled.status === 'fulfilled') {
                        const { result: agentResult, context } = settled.value;
                        results.push(agentResult);
                        if (context) contextsToClose.push(context);
                    } else {
                        results.push({
                            target: target.name,
                            url: target.url,
                            status: 'error',
                            extractedInfo: [],
                            summary: `Error: ${settled.reason?.message || 'Unknown error'}`,
                            duration: 0,
                            error: settled.reason?.message
                        });
                    }
                }

                for (const ctx of contextsToClose) {
                    await ctx.close().catch(() => { });
                }
            }
        } catch (fatalError: any) {
            console.error('❌ Error fatal en ejecución paralela:', fatalError);
        } finally {
            if (browser) {
                await browser.close();
            }
        }

        // ... return results ...
        const totalDuration = Date.now() - startTime;
        const successful = results.filter(r => r.status === 'success').length;
        const failed = results.length - successful;

        // Generar comparación
        const comparison = this.generateComparison(instruction, results);

        console.log(`\n✅ ══════════════════════════════════════════════════════════`);
        console.log(`   EJECUCIÓN COMPLETADA`);
        console.log(`   ✓ Exitosos: ${successful}/${targets.length}`);
        console.log(`   ✗ Fallidos: ${failed}/${targets.length}`);
        console.log(`   ⏱️ Duración total: ${(totalDuration / 1000).toFixed(1)}s`);
        console.log(`══════════════════════════════════════════════════════════`);
        console.log(comparison);

        return {
            instruction,
            totalTargets: targets.length,
            successful,
            failed,
            results,
            comparison,
            totalDuration
        };
    }

    private async runSingleAgent(
        target: ParallelTarget,
        instruction: string,
        agentNumber: number,
        browser: Browser
    ): Promise<{ result: ParallelTargetResult; context?: BrowserContext }> {
        const startTime = Date.now();
        console.log(`   🤖 Agente #${agentNumber} iniciando: ${target.name} (${target.url})`);

        let context: BrowserContext | undefined;

        try {
            context = await browser.newContext();

            const agent = new WebAgent({
                openaiApiKey: this.openaiApiKey,
                headless: this.headless,
                maxSteps: this.maxStepsPerAgent
            });

            const result = await agent.run({
                url: target.url,
                instruction: instruction,
                credentials: target.credentials,
                loginUrl: target.loginUrl,
                context: context
            });

            const duration = Date.now() - startTime;
            const isSuccess = result.success || result.status === 'success';

            console.log(`   ${isSuccess ? '✅' : '❌'} Agente #${agentNumber} terminó: ${target.name} (${(duration / 1000).toFixed(1)}s)`);

            return {
                result: {
                    target: target.name,
                    url: target.url,
                    status: isSuccess ? 'success' : 'failed',
                    extractedInfo: result.data || [],
                    summary: result.extractedSummary || result.summary,
                    duration
                },
                context
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            console.log(`   ❌ Agente #${agentNumber} error: ${target.name} - ${(error as Error).message}`);

            return {
                result: {
                    target: target.name,
                    url: target.url,
                    status: 'error',
                    extractedInfo: [],
                    summary: `Error: ${(error as Error).message}`,
                    duration,
                    error: (error as Error).message
                },
                context
            };
        }
    }

    /** Decodifica escapes Unicode (\uXXXX) en el texto para mostrar correctamente en el resumen. */
    private decodeUnicodeEscapes(text: string): string {
        return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        );
    }

    private generateComparison(instruction: string, results: ParallelTargetResult[]): string {
        const resultsWithInfo = results.filter(r => r.extractedInfo.length > 0);

        let summary = `\n📋 RESUMEN UNIFICADO\n`;
        summary += `${'='.repeat(50)}\n`;
        summary += `🎯 Objetivo: ${instruction}\n\n`;

        summary += `Sitios consultados: ${results.length}\n`;
        for (const r of results) {
            const status = r.status === 'success' ? '✓' : r.status === 'error' ? '✗' : '−';
            const info = r.extractedInfo.length > 0 ? ` (${r.extractedInfo.length} dato(s))` : '';
            summary += `   ${status} ${r.target}${info}\n`;
        }
        summary += '\n';

        // Resumen por sitio: que TODOS los sitios consultados aparezcan con lo que aportaron (o "sin datos")
        summary += `📌 Resumen por sitio (todos los consultados):\n`;
        for (const r of results) {
            const n = r.extractedInfo.length;
            if (n === 0) {
                summary += `   • ${r.target}: sin información extraída\n`;
            } else {
                const byTypeCount: Record<string, number> = {};
                for (const info of r.extractedInfo) {
                    byTypeCount[info.type] = (byTypeCount[info.type] || 0) + 1;
                }
                const parts = Object.entries(byTypeCount)
                    .map(([t, c]) => `${t}: ${c}`)
                    .join(', ');
                summary += `   • ${r.target}: ${n} dato(s) — ${parts}\n`;
            }
        }
        summary += '\n';

        if (resultsWithInfo.length === 0) {
            summary += 'No se extrajo información en ninguno de los sitios.\n';
            summary += `${'='.repeat(50)}\n`;
            return summary;
        }

        const byType: Record<string, Array<{ target: string; content: string }>> = {};
        for (const result of resultsWithInfo) {
            for (const info of result.extractedInfo) {
                if (!byType[info.type]) {
                    byType[info.type] = [];
                }
                byType[info.type].push({
                    target: result.target,
                    content: this.decodeUnicodeEscapes(info.content)
                });
            }
        }

        // Orden: tipos que contengan "price"/"precio" primero, luego el resto (orden estable por nombre)
        const typeNames = Object.keys(byType).filter(t => byType[t]?.length);
        const priceLike = typeNames.filter(t => /price|precio/i.test(t));
        const rest = typeNames.filter(t => !/price|precio/i.test(t)).sort((a, b) => a.localeCompare(b));
        const orderedTypes = [...priceLike, ...rest];

        for (const type of orderedTypes) {
            const items = byType[type];
            if (!items || items.length === 0) continue;
            const typeLabel = type.toUpperCase();
            summary += `📦 [${typeLabel}]\n`;
            for (const item of items) {
                summary += `   • ${item.target}: ${item.content}\n`;
            }
            summary += '\n';
        }

        const priceItems = Object.entries(byType)
            .filter(([t]) => /price|precio/i.test(t))
            .flatMap(([, items]) => items);

        // Solo considerar para "mejor precio" entradas que sean precios reales (tienen moneda) y no mensajes de error
        const noPricePhrases = /no (fue )?especificado|no se (encontr[oó]|pudo)|se necesita revisar|informaci[oó]n\.?\s*$/i;
        const hasCurrency = /RD\s*\$|[\$€£]\s*\d|desde\s*RD\s*\$|precio\s*[:=]?\s*RD\s*\$/i;
        const priceItemsValid = priceItems.filter(
            item => !noPricePhrases.test(item.content) && hasCurrency.test(item.content)
        );

        if (priceItemsValid.length >= 1) {
            const prices = priceItemsValid.map(item => {
                const match = item.content.match(/RD\s*\$\s*([\d.,]+)|[\$€£]\s*([\d.,]+)/i) ||
                    item.content.match(/(\d+[.,]\d+)\s*(?:RD|\$|€|£)/i);
                const raw = match ? (match[1] || match[2] || '') : '';
                const numStr = raw.replace(/,/g, ''); // quitar comas de miles
                const price = numStr ? parseFloat(numStr) : Infinity;
                return {
                    target: item.target,
                    price: Number.isFinite(price) ? price : Infinity,
                    original: item.content
                };
            }).filter(p => p.price !== Infinity && p.price > 0);

            if (prices.length >= 1) {
                prices.sort((a, b) => a.price - b.price);
                summary += `💰 MEJOR PRECIO (menor valor encontrado): ${prices[0].target} — ${prices[0].original}\n`;
                if (prices.length > 1) {
                    summary += `   Otros: ${prices.slice(1, 4).map(p => `${p.target} (${p.original})`).join(' | ')}\n`;
                }
            }
        }

        const hasPriceType = (r: ParallelTargetResult) =>
            r.extractedInfo.some(i => /price|precio/i.test(i.type));
        const targetsWithInfoNoPrice = resultsWithInfo.filter(r => !hasPriceType(r)).map(r => r.target);
        if (targetsWithInfoNoPrice.length > 0) {
            summary += `\n📌 Sitios con información extraída pero sin dato de precio:\n`;
            for (const t of targetsWithInfoNoPrice) {
                summary += `   • ${t}\n`;
            }
        }

        summary += `${'='.repeat(50)}\n`;

        return summary;
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
