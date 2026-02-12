import { chromium, Browser, BrowserContext } from 'playwright';
import { WebAgent } from './web-agent.js';

export interface ParallelTarget {
    url: string;
    name: string;
    /** Instrucción específica para este target. Si se omite, se usa la instrucción global. */
    instruction?: string;
    /** URL donde el agente debe ir para iniciar sesión (si difiere de url). Si hay credentials y loginUrl, se navega primero a loginUrl. */
    loginUrl?: string;
    credentials?: {
        email?: string;
        username?: string;
        password?: string;
    };
}

export interface ParallelConfig {
    /** Instrucción por defecto para todos los targets. Obligatoria si algún target no tiene instruction propia. */
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

        // Advertencia de rendimiento para muchos agentes
        if (maxParallel >= 7) {
            console.log(`\n⚠️  ══════════════════════════════════════════════════════════`);
            console.log(`   ADVERTENCIA: Ejecutando ${maxParallel} agentes en paralelo`);
            console.log(`   • Alto consumo de RAM esperado (${maxParallel * 200}-${maxParallel * 400}MB aprox.)`);
            console.log(`   • Snapshots pueden tardar más`);
            console.log(`   • Se usarán múltiples navegadores para mejor rendimiento`);
            console.log(`══════════════════════════════════════════════════════════\n`);
        }

        const targetsWithOwnInstruction = targets.filter(t => t.instruction?.trim()).length;
        console.log(`\n🚀 ══════════════════════════════════════════════════════════`);
        console.log(`   EJECUCIÓN PARALELA - ${targets.length} objetivos`);
        console.log(`   📝 Instrucción global: ${instruction}`);
        if (targetsWithOwnInstruction > 0) {
            console.log(`   📌 ${targetsWithOwnInstruction} target(s) con instrucción propia`);
        }
        console.log(`   ⚡ Máximo paralelo: ${maxParallel}`);
        
        // Estrategia: usar múltiples navegadores si hay muchos agentes
        const useMultipleBrowsers = maxParallel >= 7;
        const browsersPerGroup = 3; // Máximo 3 pestañas por navegador para mejor rendimiento
        
        if (useMultipleBrowsers) {
            console.log(`   🌐 Múltiples navegadores (${Math.ceil(maxParallel / browsersPerGroup)} navegadores)`);
        } else {
            console.log(`   🌐 Navegador compartido activado`);
        }
        console.log(`══════════════════════════════════════════════════════════\n`);

        const results: ParallelTargetResult[] = [];
        const browsers: Browser[] = [];

        try {
            // Dividir targets en chunks según maxParallel
            const chunks = this.chunkArray(targets, maxParallel);

            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                const chunk = chunks[chunkIndex];
                console.log(`\n📦 Procesando lote ${chunkIndex + 1}/${chunks.length} (${chunk.length} agentes)...`);

                if (useMultipleBrowsers) {
                    // Estrategia: múltiples navegadores para mejor rendimiento
                    await this.runChunkWithMultipleBrowsers(
                        chunk,
                        instruction,
                        chunkIndex * maxParallel,
                        browsersPerGroup,
                        browsers,
                        results
                    );
                } else {
                    // Estrategia: navegador único compartido (óptimo para pocos agentes)
                    await this.runChunkWithSingleBrowser(
                        chunk,
                        instruction,
                        chunkIndex * maxParallel,
                        browsers,
                        results
                    );
                }
            }
        } catch (fatalError: any) {
            console.error('❌ Error fatal en ejecución paralela:', fatalError);
        } finally {
            // Cerrar todos los navegadores
            for (const browser of browsers) {
                await browser.close().catch(() => { });
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

    private async runChunkWithSingleBrowser(
        chunk: ParallelTarget[],
        instruction: string,
        startIndex: number,
        browsers: Browser[],
        results: ParallelTargetResult[]
    ): Promise<void> {
        // Crear navegador si no existe
        if (browsers.length === 0) {
            browsers.push(await chromium.launch({ 
                headless: this.headless,
                args: ['--disable-dev-shm-usage', '--disable-setuid-sandbox']
            }));
        }
        const browser = browsers[0];

                // Ejecutar chunk en paralelo
                const chunkPromises = chunk.map((target, index) =>
                    this.runSingleAgent(target, instruction, startIndex + index + 1, browser, false)
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

        // Cerrar contextos inmediatamente para liberar memoria
        await Promise.all(contextsToClose.map(ctx => ctx.close().catch(() => { })));
    }

    private async runChunkWithMultipleBrowsers(
        chunk: ParallelTarget[],
        instruction: string,
        startIndex: number,
        browsersPerGroup: number,
        browsers: Browser[],
        results: ParallelTargetResult[]
    ): Promise<void> {
        // Dividir chunk en grupos de navegadores
        const browserGroups = this.chunkArray(chunk, browsersPerGroup);

        for (let groupIndex = 0; groupIndex < browserGroups.length; groupIndex++) {
            const group = browserGroups[groupIndex];
            
            // Crear navegador para este grupo si no existe
            if (browsers.length <= groupIndex) {
                browsers.push(await chromium.launch({ 
                    headless: this.headless,
                    args: [
                        '--disable-dev-shm-usage',
                        '--disable-setuid-sandbox',
                        '--disable-gpu',
                        '--no-sandbox',
                        '--disable-software-rasterizer',
                        '--disable-extensions'
                    ]
                }));
            }
            const browser = browsers[groupIndex];

            // Ejecutar grupo en paralelo
            const groupPromises = group.map((target, index) =>
                this.runSingleAgent(
                    target, 
                    instruction, 
                    startIndex + groupIndex * browsersPerGroup + index + 1, 
                    browser,
                    true // Optimizar para muchos agentes
                )
            );

            const groupResults = await Promise.allSettled(groupPromises);
            const contextsToClose: BrowserContext[] = [];

            for (let i = 0; i < groupResults.length; i++) {
                const settled = groupResults[i];
                const target = group[i];

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

            // Cerrar contextos inmediatamente para liberar memoria
            await Promise.all(contextsToClose.map(ctx => ctx.close().catch(() => { })));
            
            // Pequeña pausa entre grupos para evitar sobrecarga
            if (groupIndex < browserGroups.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    private async runSingleAgent(
        target: ParallelTarget,
        globalInstruction: string,
        agentNumber: number,
        browser: Browser,
        optimizeForManyAgents: boolean = false
    ): Promise<{ result: ParallelTargetResult; context?: BrowserContext }> {
        const startTime = Date.now();
        
        // Aislar instrucción para este agente específico
        let instruction: string;
        if (target.instruction?.trim()) {
            instruction = target.instruction.trim();
            console.log(`   🤖 Agente #${agentNumber} iniciando: ${target.name} (instrucción propia)`);
        } else {
            // Filtrar instrucción global para que sea relevante solo a este sitio
            // Agregar contexto de aislamiento para evitar que el agente intente hacer tareas de otros sitios
            instruction = `IMPORTANTE: Eres el agente #${agentNumber} asignado SOLO a ${target.name} (${target.url}).
Otros sitios son manejados por otros agentes. Enfócate SOLO en lo que puedes hacer en ESTE sitio.
NO intentes navegar a otros sitios ni completar tareas destinadas a otros agentes.

Tarea específica para ${target.name}: ${globalInstruction}`;
            console.log(`   🤖 Agente #${agentNumber} iniciando: ${target.name} (${target.url})`);
        }

        let context: BrowserContext | undefined;

        try {
            // Crear contexto con límites de recursos optimizados
            context = await browser.newContext({
                viewport: { width: 1280, height: 720 }, // Resolución reducida para ahorrar memoria
                ignoreHTTPSErrors: true,
                javaScriptEnabled: true,
                bypassCSP: true
                // Nota: Para optimizaciones adicionales con muchos agentes, se pueden deshabilitar
                // imágenes/fuentes aquí, pero puede afectar la detección visual
            });

            const agent = new WebAgent({
                openaiApiKey: this.openaiApiKey,
                headless: this.headless,
                maxSteps: this.maxStepsPerAgent,
                // Optimizaciones para ejecución paralela
                optimizeForParallel: true
            });

            const result = await agent.run({
                url: target.url,
                instruction,
                credentials: target.credentials,
                loginUrl: target.loginUrl,
                context: context
            });

            const duration = Date.now() - startTime;
            const rawData = result.data || [];
            
            // Deduplicar extractedInfo antes de agregarlo al resultado
            const seen = new Set<string>();
            const dedupedInfo = rawData.filter((info: { type?: string; content?: string }) => {
                const key = `${info.type || 'unknown'}:${(info.content || '').trim().toLowerCase()}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            
            const hasAvailability = dedupedInfo.some((d: { type?: string }) => /availability|disponibilidad|horario/i.test(d.type || ''));
            const instructionLower = instruction.toLowerCase();
            const objectiveWasAvailability = /horario|golf|disponible|mañana|reserva/i.test(instructionLower);
            const isSuccess =
                result.success ||
                result.status === 'success' ||
                (objectiveWasAvailability && hasAvailability);

            console.log(`   ${isSuccess ? '✅' : '❌'} Agente #${agentNumber} terminó: ${target.name} (${(duration / 1000).toFixed(1)}s)`);

            return {
                result: {
                    target: target.name,
                    url: target.url,
                    status: isSuccess ? 'success' : 'failed',
                    extractedInfo: dedupedInfo,
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

    /**
     * Filtra y deduplica extractedInfo para evitar información errónea o repetida:
     * - Excluye HTML crudo (p. ej. página de carga de Outlook Bookings)
     * - Excluye dumps de propiedades DOM/React (__UNMOUNT, __reactContainer, etc.)
     * - Excluye contenido demasiado largo (probable dump)
     * - Deduplica mensajes iguales o muy similares por target
     */
    private filterAndDedupeExtractedInfo(
        items: Array<{ type: string; content: string }>,
        maxContentLength: number = 1200
    ): Array<{ type: string; content: string }> {
        const isHtml = (s: string) => {
            const t = s.trim();
            const lower = t.toLowerCase();
            return lower.startsWith('<!doctype') || lower.startsWith('<html') || /^\s*</.test(t);
        };
        const domReactDumpMarkers = [
            '__UNMOUNT', '__reactContainer', '_reactListening', 'attributeStyleMap',
            'NamedNodeMap', 'DOMTokenList', 'HTMLCollection', 'NodeList',
            'stateNode:', 'elementType:', 'nodeType:', 'ownerDocument:'
        ];
        const isDomOrReactDump = (s: string) => {
            const count = domReactDumpMarkers.filter(m => s.includes(m)).length;
            return count >= 2;
        };
        const seen = new Set<string>();
        const out: Array<{ type: string; content: string }> = [];
        for (const item of items) {
            const raw = (item.content || '').trim();
            if (!raw) continue;
            if (raw.length > maxContentLength) continue;
            if (isHtml(raw)) continue;
            if (isDomOrReactDump(raw)) continue;
            const key = `${item.type}\n${raw.replace(/\s+/g, ' ').toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ type: item.type, content: item.content });
        }
        return out;
    }

    private generateComparison(instruction: string, results: ParallelTargetResult[]): string {
        const resultsWithCleanedInfo = results.map(r => ({
            ...r,
            extractedInfo: this.filterAndDedupeExtractedInfo(r.extractedInfo)
        }));
        const resultsWithInfo = resultsWithCleanedInfo.filter(r => r.extractedInfo.length > 0);

        let summary = `\n📋 RESUMEN UNIFICADO\n`;
        summary += `${'='.repeat(50)}\n`;
        summary += `🎯 Objetivo: ${instruction}\n\n`;

        summary += `Sitios consultados: ${results.length}\n`;
        for (const r of resultsWithCleanedInfo) {
            const status = r.status === 'success' ? '✓' : r.status === 'error' ? '✗' : '−';
            const info = r.extractedInfo.length > 0 ? ` (${r.extractedInfo.length} dato(s))` : '';
            summary += `   ${status} ${r.target}${info}\n`;
        }
        summary += '\n';

        // Resumen por sitio (usa info filtrada y deduplicada)
        summary += `📌 Resumen por sitio (todos los consultados):\n`;
        for (const r of resultsWithCleanedInfo) {
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
        // Map para deduplicar contenido exacto por tipo
        const seenContent = new Map<string, Set<string>>(); // tipo -> Set de contenidos ya vistos
        
        for (const result of resultsWithInfo) {
            for (const info of result.extractedInfo) {
                if (!byType[info.type]) {
                    byType[info.type] = [];
                    seenContent.set(info.type, new Set());
                }
                
                const decodedContent = this.decodeUnicodeEscapes(info.content);
                // Normalizar contenido para comparación (quitar espacios extra, lowercase)
                const normalizedContent = decodedContent.replace(/\s+/g, ' ').trim().toLowerCase();
                const contentSet = seenContent.get(info.type)!;
                
                // Solo agregar si no hemos visto este contenido exacto antes
                if (!contentSet.has(normalizedContent)) {
                    contentSet.add(normalizedContent);
                    byType[info.type].push({
                        target: result.target,
                        content: decodedContent
                    });
                }
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
