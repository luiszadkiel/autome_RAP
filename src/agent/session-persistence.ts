/**
 * Persistencia de sesiones por dominio (Playwright storageState).
 * Carga sesión guardada al crear el contexto y guarda al finalizar, para evitar re-login.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DEFAULT_SESSIONS_DIR = join(process.cwd(), 'data', 'sessions');

/**
 * Sanitiza el hostname para usarlo como nombre de archivo (sin caracteres inválidos).
 */
function sanitizeHostname(hostname: string): string {
    return hostname.replace(/[^a-z0-9.-]/gi, '_').slice(0, 100) || 'default';
}

/**
 * Ruta del archivo de sesión para un dominio.
 */
export function getSessionFilePath(hostname: string, sessionsDir?: string): string {
    const dir = sessionsDir ?? DEFAULT_SESSIONS_DIR;
    return join(dir, sanitizeHostname(hostname) + '.json');
}

/**
 * Comprueba si existe una sesión guardada para el hostname.
 */
export function hasStoredSession(hostname: string, sessionsDir?: string): boolean {
    return existsSync(getSessionFilePath(hostname, sessionsDir));
}

/**
 * Asegura que el directorio de sesiones existe (para guardar).
 */
export function ensureSessionsDir(sessionsDir?: string): void {
    const dir = sessionsDir ?? DEFAULT_SESSIONS_DIR;
    mkdirSync(dir, { recursive: true });
}

export { DEFAULT_SESSIONS_DIR };
