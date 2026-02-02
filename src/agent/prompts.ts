/**
 * Prompts for OpenAI Agent - AUTONOMOUS GOAL-ORIENTED VERSION
 */

import type { Credentials, PlannedAction, PageSnapshot } from '../core/types.js';

// ============================================
// Date/Time Helpers
// ============================================

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Format date as DD/MM/YYYY
function formatDateDMY(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Format date with day of week in Spanish
function formatDateFull(date: Date): string {
  const dayName = DAYS_ES[date.getDay()];
  const day = date.getDate();
  const monthName = MONTHS_ES[date.getMonth()];
  const year = date.getFullYear();
  return `${dayName} ${day} de ${monthName} de ${year}`;
}

// ============================================
// Structured Input - Clean data extracted from user message
// ============================================

export interface StructuredInput {
  // Original message
  originalMessage: string;

  // Action type
  actionType: 'reservation' | 'purchase' | 'search' | 'login' | 'navigation' | 'general';

  // Date information
  date: {
    original: string | null;         // What user said: "mañana", "próximo martes"
    parsed: Date | null;             // Actual Date object
    dayNumber: number | null;        // Day of month: 2, 15, 28
    dayName: string | null;          // "lunes", "martes"
    monthNumber: number | null;      // 1-12
    monthName: string | null;        // "enero", "febrero"
    year: number | null;
    formatted: {
      display: string;             // "Lunes 2 de febrero de 2026"
      ddmmyyyy: string;            // "02/02/2026"
      yyyymmdd: string;            // "2026-02-02"
      short: string;               // "02/02"
    } | null;
    isRelative: boolean;             // true if "mañana", "próximo martes"
    relativeTerm: string | null;     // "mañana", "próximo martes", "hoy"
  };

  // Time information
  time: {
    original: string | null;         // What user said: "10 am", "a las 10"
    hour: number | null;             // 10, 14, 8
    minute: number | null;           // 0, 30, 45
    period: 'AM' | 'PM' | null;
    formatted: {
      display: string;             // "10:00 AM"
      h24: string;                 // "10:00"
      hhmm: string;                // "10:00am"
    } | null;
  };

  // Item/Product information
  item: {
    name: string | null;             // "tee time", "green fee", "carrito"
    quantity: number | null;         // Number of items/players
    details: string[];               // Additional details like "18 hoyos"
  };

  // Credentials (if provided in message - usually from API)
  credentials: {
    email: string | null;
    username: string | null;
    hasPassword: boolean;
  };
}

// ============================================
// Instruction Parser - Extract structured data from instructions
// ============================================

export interface ParsedInstruction {
  taskType: string;           // 'reservation', 'booking', 'purchase', 'search', etc.
  targetDate: Date | null;
  targetDateText: string;     // Human readable: "tomorrow", "next Saturday"
  targetTime: string | null;  // "10:00 AM", "14:00"
  quantity: number | null;    // Number of people/players/items
  dateFormats: { [key: string]: string };  // Multiple date formats for input
  additionalDetails: string[];
}

// ============================================
// Extract Structured Data from User Message
// ============================================

export function extractStructuredData(
  message: string,
  credentials?: { email?: string; username?: string; password?: string }
): StructuredInput {
  const lowerMsg = message.toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Initialize result
  const result: StructuredInput = {
    originalMessage: message,
    actionType: 'general',
    date: {
      original: null,
      parsed: null,
      dayNumber: null,
      dayName: null,
      monthNumber: null,
      monthName: null,
      year: null,
      formatted: null,
      isRelative: false,
      relativeTerm: null
    },
    time: {
      original: null,
      hour: null,
      minute: null,
      period: null,
      formatted: null
    },
    item: {
      name: null,
      quantity: null,
      details: []
    },
    credentials: {
      email: credentials?.email || null,
      username: credentials?.username || null,
      hasPassword: !!credentials?.password
    }
  };

  // ========== DETECT ACTION TYPE ==========
  if (lowerMsg.includes('reserv') || lowerMsg.includes('book') || lowerMsg.includes('tee time')) {
    result.actionType = 'reservation';
  } else if (lowerMsg.includes('compra') || lowerMsg.includes('buy') || lowerMsg.includes('purchase')) {
    result.actionType = 'purchase';
  } else if (lowerMsg.includes('busca') || lowerMsg.includes('search') || lowerMsg.includes('find')) {
    result.actionType = 'search';
  } else if (lowerMsg.includes('login') || lowerMsg.includes('iniciar sesión') || lowerMsg.includes('acceder')) {
    result.actionType = 'login';
  } else if (lowerMsg.includes('ir a') || lowerMsg.includes('navegar') || lowerMsg.includes('abrir')) {
    result.actionType = 'navigation';
  }

  // ========== EXTRACT DATE ==========
  const todayDay = today.getDate();
  let parsedDate: Date | null = null;
  let dateOriginal: string | null = null;
  let isRelative = false;
  let relativeTerm: string | null = null;

  // Relative dates (check longer phrases first)
  if (lowerMsg.includes('pasado mañana') || lowerMsg.includes('day after tomorrow')) {
    parsedDate = new Date(today);
    parsedDate.setDate(todayDay + 2);
    dateOriginal = 'pasado mañana';
    isRelative = true;
    relativeTerm = 'pasado mañana';
  } else if (lowerMsg.includes('mañana') || lowerMsg.includes('manana') || lowerMsg.includes('tomorrow')) {
    parsedDate = new Date(today);
    parsedDate.setDate(todayDay + 1);
    dateOriginal = 'mañana';
    isRelative = true;
    relativeTerm = 'mañana';
  } else if (lowerMsg.includes('hoy') || lowerMsg.includes('today')) {
    parsedDate = new Date(today);
    dateOriginal = 'hoy';
    isRelative = true;
    relativeTerm = 'hoy';
  }

  // Day of week detection
  const daysMap: { [key: string]: number } = {
    'domingo': 0, 'sunday': 0,
    'lunes': 1, 'monday': 1,
    'martes': 2, 'tuesday': 2,
    'miércoles': 3, 'miercoles': 3, 'wednesday': 3,
    'jueves': 4, 'thursday': 4,
    'viernes': 5, 'friday': 5,
    'sábado': 6, 'sabado': 6, 'saturday': 6
  };

  // Check for "próximo [día]" or "next [day]"
  for (const [dayName, dayIndex] of Object.entries(daysMap)) {
    const nextPattern = new RegExp(`(próximo|proximo|next|este|this)\\s+${dayName}`, 'i');
    if (nextPattern.test(lowerMsg)) {
      parsedDate = getNextDayOfWeek(dayIndex);
      dateOriginal = `próximo ${dayName}`;
      isRelative = true;
      relativeTerm = `próximo ${dayName}`;
      break;
    }
  }

  // Check for numeric date formats
  if (!parsedDate) {
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const datePatterns = [
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,  // DD/MM/YYYY
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})/,  // DD/MM/YY
      /(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?/, // 15 de febrero de 2026
    ];

    for (const pattern of datePatterns) {
      const match = message.match(pattern);
      if (match) {
        if (pattern.source.includes('de')) {
          // Spanish format: "15 de febrero"
          const day = parseInt(match[1]);
          const monthStr = match[2].toLowerCase();
          const year = match[3] ? parseInt(match[3]) : today.getFullYear();
          const monthIndex = MONTHS_ES.findIndex(m => m.toLowerCase() === monthStr);
          if (monthIndex !== -1) {
            parsedDate = new Date(year, monthIndex, day);
            dateOriginal = match[0];
          }
        } else {
          // Numeric format
          const day = parseInt(match[1]);
          const month = parseInt(match[2]) - 1;
          let year = parseInt(match[3]);
          if (year < 100) year += 2000;
          parsedDate = new Date(year, month, day);
          dateOriginal = match[0];
        }
        break;
      }
    }
  }

  // Fill date information
  if (parsedDate) {
    result.date.original = dateOriginal;
    result.date.parsed = parsedDate;
    result.date.dayNumber = parsedDate.getDate();
    result.date.dayName = DAYS_ES[parsedDate.getDay()];
    result.date.monthNumber = parsedDate.getMonth() + 1;
    result.date.monthName = MONTHS_ES[parsedDate.getMonth()];
    result.date.year = parsedDate.getFullYear();
    result.date.isRelative = isRelative;
    result.date.relativeTerm = relativeTerm;

    const d = parsedDate.getDate().toString().padStart(2, '0');
    const m = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
    const y = parsedDate.getFullYear();

    result.date.formatted = {
      display: `${DAYS_ES[parsedDate.getDay()]} ${parsedDate.getDate()} de ${MONTHS_ES[parsedDate.getMonth()]} de ${y}`,
      ddmmyyyy: `${d}/${m}/${y}`,
      yyyymmdd: `${y}-${m}-${d}`,
      short: `${d}/${m}`
    };
  }

  // ========== EXTRACT TIME ==========
  // Pattern 1: "10:00 am" or "10:00" (with minutes)
  const timeWithMinutes = message.match(/(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/i);
  // Pattern 2: "10am" or "10 am" (without minutes)
  const timeWithoutMinutes = message.match(/(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i);
  // Pattern 3: "a las 10" or "a la 1:30"
  const timeALas = message.match(/a\s*las?\s*(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?/i);
  // Pattern 4: "10 de la mañana"
  const timeDeLa = message.match(/(\d{1,2})\s*(?:de la\s*)?(mañana|tarde|noche)/i);

  let hour: number | null = null;
  let minute: number = 0;
  let period: 'AM' | 'PM' | null = null;
  let timeOriginal: string | null = null;

  if (timeWithMinutes) {
    // "10:30 am" - has explicit minutes
    hour = parseInt(timeWithMinutes[1]);
    minute = parseInt(timeWithMinutes[2]);
    timeOriginal = timeWithMinutes[0];
    const periodStr = (timeWithMinutes[3] || '').toLowerCase();
    if (periodStr.includes('pm') || periodStr.includes('p.m')) {
      period = 'PM';
      if (hour < 12) hour += 12;
    } else if (periodStr.includes('am') || periodStr.includes('a.m')) {
      period = 'AM';
      if (hour === 12) hour = 0;
    } else if (hour < 12) {
      period = 'AM';
    }
  } else if (timeWithoutMinutes) {
    // "10 am" - no minutes, default to :00
    hour = parseInt(timeWithoutMinutes[1]);
    minute = 0;
    timeOriginal = timeWithoutMinutes[0];
    const periodStr = (timeWithoutMinutes[2] || '').toLowerCase();
    if (periodStr.includes('pm') || periodStr.includes('p.m')) {
      period = 'PM';
      if (hour < 12) hour += 12;
    } else if (periodStr.includes('am') || periodStr.includes('a.m')) {
      period = 'AM';
      if (hour === 12) hour = 0;
    }
  } else if (timeALas) {
    // "a las 10:30" or "a las 10"
    hour = parseInt(timeALas[1]);
    minute = timeALas[2] ? parseInt(timeALas[2]) : 0;
    timeOriginal = timeALas[0];
    const periodStr = (timeALas[3] || '').toLowerCase();
    if (periodStr.includes('pm')) {
      period = 'PM';
      if (hour < 12) hour += 12;
    } else if (periodStr.includes('am')) {
      period = 'AM';
      if (hour === 12) hour = 0;
    } else if (hour < 12) {
      period = 'AM';
    }
  } else if (timeDeLa) {
    // "10 de la mañana"
    hour = parseInt(timeDeLa[1]);
    minute = 0;
    timeOriginal = timeDeLa[0];
    const periodStr = (timeDeLa[2] || '').toLowerCase();
    if (periodStr === 'tarde' || periodStr === 'noche') {
      period = 'PM';
      if (hour < 12) hour += 12;
    } else if (periodStr === 'mañana') {
      period = 'AM';
      if (hour === 12) hour = 0;
    }
  }

  if (hour !== null) {
    result.time.original = timeOriginal;
    result.time.hour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    result.time.minute = minute;
    result.time.period = period;

    const h24 = hour.toString().padStart(2, '0');
    const mm = minute.toString().padStart(2, '0');
    const h12 = result.time.hour;

    result.time.formatted = {
      display: `${h12}:${mm} ${period || 'AM'}`,
      h24: `${h24}:${mm}`,
      hhmm: `${h12}:${mm}${(period || 'am').toLowerCase()}`
    };
  }

  // ========== EXTRACT ITEM/PRODUCT ==========
  // Golf-related items
  if (lowerMsg.includes('tee time') || lowerMsg.includes('teetime')) {
    result.item.name = 'tee time';
  } else if (lowerMsg.includes('green fee')) {
    result.item.name = 'green fee';
  } else if (lowerMsg.includes('carrito') || lowerMsg.includes('cart')) {
    result.item.name = 'carrito de golf';
  } else if (lowerMsg.includes('clase') || lowerMsg.includes('lesson')) {
    result.item.name = 'clase de golf';
  }

  // Quantity detection
  const quantityPatterns = [
    /(\d+)\s*(jugador|player|persona|people|guest|invitado)/i,
    /para\s*(\d+)/i,
    /(\d+)\s*(hoyo|hole)/i
  ];

  for (const pattern of quantityPatterns) {
    const match = message.match(pattern);
    if (match) {
      result.item.quantity = parseInt(match[1]);
      if (match[2] && (match[2].toLowerCase().includes('hoyo') || match[2].toLowerCase().includes('hole'))) {
        result.item.details.push(`${match[1]} hoyos`);
      }
      break;
    }
  }

  // Additional details
  if (lowerMsg.includes('18 hoyo') || lowerMsg.includes('18 hole')) {
    result.item.details.push('18 hoyos');
  } else if (lowerMsg.includes('9 hoyo') || lowerMsg.includes('9 hole')) {
    result.item.details.push('9 hoyos');
  }

  return result;
}

// Format structured data for display in prompt
export function formatStructuredDataForPrompt(data: StructuredInput): string {
  const lines: string[] = [];

  lines.push('╔═══════════════════════════════════════════════════════════════╗');
  lines.push('║              📋 DATOS ESTRUCTURADOS DE LA TAREA              ║');
  lines.push('╠═══════════════════════════════════════════════════════════════╣');

  // Action type
  const actionLabels: { [key: string]: string } = {
    'reservation': '📅 RESERVACIÓN',
    'purchase': '🛒 COMPRA',
    'search': '🔍 BÚSQUEDA',
    'login': '🔐 INICIO DE SESIÓN',
    'navigation': '🌐 NAVEGACIÓN',
    'general': '📌 GENERAL'
  };
  lines.push(`║  TIPO DE ACCIÓN: ${actionLabels[data.actionType] || data.actionType.toUpperCase()}`);
  lines.push('║');

  // Date information
  if (data.date.parsed) {
    lines.push('║  📅 FECHA:');
    if (data.date.isRelative && data.date.relativeTerm) {
      lines.push(`║     Usuario dijo: "${data.date.relativeTerm}"`);
    }
    lines.push(`║     → Día: ${data.date.dayNumber} (${data.date.dayName})`);
    lines.push(`║     → Mes: ${data.date.monthNumber} (${data.date.monthName})`);
    lines.push(`║     → Año: ${data.date.year}`);
    lines.push(`║     → Formato DD/MM/YYYY: ${data.date.formatted?.ddmmyyyy}`);
    lines.push(`║     → Completo: ${data.date.formatted?.display}`);
    lines.push('║');
    lines.push(`║     🎯 EN EL CALENDARIO: Busca y haz clic en "${data.date.dayNumber}"`);
  } else {
    lines.push('║  📅 FECHA: No especificada');
  }
  lines.push('║');

  // Time information
  if (data.time.hour !== null) {
    lines.push('║  ⏰ HORA:');
    if (data.time.original) {
      lines.push(`║     Usuario dijo: "${data.time.original}"`);
    }
    lines.push(`║     → Hora: ${data.time.hour}:${(data.time.minute || 0).toString().padStart(2, '0')} ${data.time.period || ''}`);
    lines.push(`║     → Formato 24h: ${data.time.formatted?.h24}`);
    lines.push(`║     → Para buscar: "${data.time.formatted?.hhmm}"`);
    lines.push('║');
    lines.push(`║     🎯 EN TIME SLOTS: Busca y haz clic en "${data.time.formatted?.hhmm}"`);
  } else {
    lines.push('║  ⏰ HORA: No especificada');
  }
  lines.push('║');

  // Item information
  if (data.item.name || data.item.quantity) {
    lines.push('║  🏷️ PRODUCTO/SERVICIO:');
    if (data.item.name) {
      lines.push(`║     → Nombre: ${data.item.name}`);
    }
    if (data.item.quantity) {
      lines.push(`║     → Cantidad: ${data.item.quantity}`);
    }
    if (data.item.details.length > 0) {
      lines.push(`║     → Detalles: ${data.item.details.join(', ')}`);
    }
  }

  lines.push('╚═══════════════════════════════════════════════════════════════╝');

  return lines.join('\n');
}

export function parseInstruction(instruction: string): ParsedInstruction {
  const lowerInstr = instruction.toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Detect task type
  let taskType = 'general';
  if (lowerInstr.includes('reserv') || lowerInstr.includes('book') || lowerInstr.includes('tee time')) {
    taskType = 'reservation';
  } else if (lowerInstr.includes('compra') || lowerInstr.includes('buy') || lowerInstr.includes('purchase')) {
    taskType = 'purchase';
  } else if (lowerInstr.includes('busca') || lowerInstr.includes('search') || lowerInstr.includes('find')) {
    taskType = 'search';
  }

  // Parse date
  let targetDate: Date | null = null;
  let targetDateText = '';

  // Get current date info for clarity
  const todayDay = today.getDate();
  const tomorrowDay = todayDay + 1;

  // === RELATIVE DATES (today, tomorrow, etc.) ===
  // IMPORTANT: Check "pasado mañana" BEFORE "mañana" because it contains "mañana"
  if (lowerInstr.includes('pasado mañana') || lowerInstr.includes('day after tomorrow')) {
    targetDate = new Date(today);
    targetDate.setDate(todayDay + 2);
    targetDateText = 'PASADO MAÑANA / DAY AFTER TOMORROW';
  } else if (lowerInstr.includes('mañana') || lowerInstr.includes('manana') || lowerInstr.includes('tomorrow')) {
    // MAÑANA = HOY + 1 DÍA
    targetDate = new Date(today);
    targetDate.setDate(todayDay + 1);
    targetDateText = `MAÑANA / TOMORROW (hoy es día ${todayDay}, mañana es día ${tomorrowDay})`;
  } else if (lowerInstr.includes('hoy') || lowerInstr.includes('today')) {
    targetDate = new Date(today);
    targetDateText = `HOY / TODAY (día ${todayDay})`;
  }
  // === DAYS OF WEEK ===
  else if (lowerInstr.includes('sábado') || lowerInstr.includes('sabado') || lowerInstr.includes('saturday')) {
    targetDate = getNextDayOfWeek(6);
    targetDateText = 'NEXT SATURDAY / PRÓXIMO SÁBADO';
  } else if (lowerInstr.includes('domingo') || lowerInstr.includes('sunday')) {
    targetDate = getNextDayOfWeek(0);
    targetDateText = 'NEXT SUNDAY / PRÓXIMO DOMINGO';
  } else if (lowerInstr.includes('lunes') || lowerInstr.includes('monday')) {
    targetDate = getNextDayOfWeek(1);
    targetDateText = 'NEXT MONDAY / PRÓXIMO LUNES';
  } else if (lowerInstr.includes('martes') || lowerInstr.includes('tuesday')) {
    targetDate = getNextDayOfWeek(2);
    targetDateText = 'NEXT TUESDAY / PRÓXIMO MARTES';
  } else if (lowerInstr.includes('miércoles') || lowerInstr.includes('miercoles') || lowerInstr.includes('wednesday')) {
    targetDate = getNextDayOfWeek(3);
    targetDateText = 'NEXT WEDNESDAY / PRÓXIMO MIÉRCOLES';
  } else if (lowerInstr.includes('jueves') || lowerInstr.includes('thursday')) {
    targetDate = getNextDayOfWeek(4);
    targetDateText = 'NEXT THURSDAY / PRÓXIMO JUEVES';
  } else if (lowerInstr.includes('viernes') || lowerInstr.includes('friday')) {
    targetDate = getNextDayOfWeek(5);
    targetDateText = 'NEXT FRIDAY / PRÓXIMO VIERNES';
  }

  // === NUMERIC FORMATS: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY ===
  if (!targetDate) {
    const numericDateMatch = instruction.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
    if (numericDateMatch) {
      const day = parseInt(numericDateMatch[1]);
      const month = parseInt(numericDateMatch[2]) - 1; // 0-indexed
      let year = numericDateMatch[3] ? parseInt(numericDateMatch[3]) : today.getFullYear();
      if (year < 100) year += 2000; // Convert 26 to 2026

      targetDate = new Date(year, month, day);
      targetDateText = `${day}/${month + 1}/${year}`;
    }
  }

  // === MONTH NAMES: "15 de febrero", "febrero 15", "15 febrero", "february 15" ===
  if (!targetDate) {
    const monthNamesES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const monthNamesEN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

    // Pattern: "15 de febrero" or "15 febrero"
    const dayFirstMatch = lowerInstr.match(/(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)/);
    if (dayFirstMatch) {
      const day = parseInt(dayFirstMatch[1]);
      const monthName = dayFirstMatch[2];
      let monthIndex = monthNamesES.findIndex(m => monthName.includes(m.substring(0, 3)));
      if (monthIndex === -1) {
        monthIndex = monthNamesEN.findIndex(m => monthName.includes(m.substring(0, 3)));
      }
      if (monthIndex !== -1 && day >= 1 && day <= 31) {
        targetDate = new Date(today.getFullYear(), monthIndex, day);
        // If date is in the past, use next year
        if (targetDate < today) {
          targetDate.setFullYear(today.getFullYear() + 1);
        }
        targetDateText = `${day} ${monthNamesES[monthIndex]}`;
      }
    }

    // Pattern: "febrero 15" or "february 15"
    if (!targetDate) {
      const monthFirstMatch = lowerInstr.match(/([a-záéíóú]+)\s+(\d{1,2})/);
      if (monthFirstMatch) {
        const monthName = monthFirstMatch[1];
        const day = parseInt(monthFirstMatch[2]);
        let monthIndex = monthNamesES.findIndex(m => monthName.includes(m.substring(0, 3)));
        if (monthIndex === -1) {
          monthIndex = monthNamesEN.findIndex(m => monthName.includes(m.substring(0, 3)));
        }
        if (monthIndex !== -1 && day >= 1 && day <= 31) {
          targetDate = new Date(today.getFullYear(), monthIndex, day);
          if (targetDate < today) {
            targetDate.setFullYear(today.getFullYear() + 1);
          }
          targetDateText = `${day} ${monthNamesES[monthIndex]}`;
        }
      }
    }
  }

  // === RELATIVE: "en X días", "in X days" ===
  if (!targetDate) {
    const inDaysMatch = instruction.match(/(?:en|in)\s+(\d+)\s*(?:días?|days?)/i);
    if (inDaysMatch) {
      const daysAhead = parseInt(inDaysMatch[1]);
      targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysAhead);
      targetDateText = `IN ${daysAhead} DAYS`;
    }
  }

  // === NEXT WEEK ===
  if (!targetDate) {
    if (lowerInstr.includes('próxima semana') || lowerInstr.includes('proxima semana') || lowerInstr.includes('next week')) {
      targetDate = new Date(today);
      targetDate.setDate(today.getDate() + 7);
      targetDateText = 'NEXT WEEK';
    }
  }

  // Parse time
  let targetTime: string | null = null;
  const timeMatch = instruction.match(/(\d{1,2})[:\s]?(\d{2})?\s*(am|pm|AM|PM)?/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] || '00';
    const ampm = timeMatch[3]?.toLowerCase();

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    targetTime = `${hours.toString().padStart(2, '0')}:${minutes}`;

    // Also store readable format
    if (hours >= 12) {
      targetTime = `${hours > 12 ? hours - 12 : hours}:${minutes} PM`;
    } else {
      targetTime = `${hours === 0 ? 12 : hours}:${minutes} AM`;
    }
  }

  // Parse quantity (players, people, etc.)
  let quantity: number | null = null;
  const quantityMatch = instruction.match(/(\d+)\s*(jugador|player|persona|people|guest|invitado)/i);
  if (quantityMatch) {
    quantity = parseInt(quantityMatch[1]);
  }

  // Extract additional details
  const additionalDetails: string[] = [];
  if (lowerInstr.includes('golf')) additionalDetails.push('Golf tee time');
  if (lowerInstr.includes('hoyo') || lowerInstr.includes('hole')) {
    const holeMatch = instruction.match(/(\d+)\s*(hoyo|hole)/i);
    if (holeMatch) additionalDetails.push(`${holeMatch[1]} holes`);
  }

  // Generate all date formats for the target date
  let dateFormats: { [key: string]: string } = {};
  if (targetDate) {
    const d = targetDate.getDate();
    const m = targetDate.getMonth() + 1;
    const y = targetDate.getFullYear();
    const yShort = y.toString().slice(-2);
    const dayPadded = d.toString().padStart(2, '0');
    const monthPadded = m.toString().padStart(2, '0');
    const monthNameES = MONTHS_ES[targetDate.getMonth()];
    const monthNameEN = MONTHS_EN[targetDate.getMonth()];

    dateFormats = {
      // For clicking in calendar
      'dayNumber': d.toString(),

      // Common input formats
      'DD/MM/YYYY': `${dayPadded}/${monthPadded}/${y}`,
      'DD-MM-YYYY': `${dayPadded}-${monthPadded}-${y}`,
      'DD.MM.YYYY': `${dayPadded}.${monthPadded}.${y}`,
      'D/M/YYYY': `${d}/${m}/${y}`,

      // US format
      'MM/DD/YYYY': `${monthPadded}/${dayPadded}/${y}`,
      'M/D/YYYY': `${m}/${d}/${y}`,

      // ISO format
      'YYYY-MM-DD': `${y}-${monthPadded}-${dayPadded}`,

      // Short formats
      'DD/MM/YY': `${dayPadded}/${monthPadded}/${yShort}`,
      'DD/MM': `${dayPadded}/${monthPadded}`,

      // Text formats
      'D monthES YYYY': `${d} ${monthNameES} ${y}`,
      'D de monthES': `${d} de ${monthNameES}`,
      'monthEN D, YYYY': `${monthNameEN} ${d}, ${y}`,
      'D monthEN YYYY': `${d} ${monthNameEN} ${y}`,
    };
  }

  return {
    taskType,
    targetDate,
    targetDateText,
    targetTime,
    quantity,
    additionalDetails,
    dateFormats
  };
}

function getNextDayOfWeek(dayIndex: number): Date {
  const today = new Date();
  const todayIndex = today.getDay();
  let daysUntil = dayIndex - todayIndex;
  if (daysUntil <= 0) daysUntil += 7;

  const nextDay = new Date(today);
  nextDay.setDate(today.getDate() + daysUntil);
  return nextDay;
}

function formatDate(date: Date): string {
  const dayOfWeek = DAYS_EN[date.getDay()];
  const dayOfWeekEs = DAYS_ES[date.getDay()];
  const day = date.getDate();
  const month = MONTHS_EN[date.getMonth()];
  const monthEs = MONTHS_ES[date.getMonth()];
  const year = date.getFullYear();

  return `${dayOfWeek}/${dayOfWeekEs} ${day} ${month}/${monthEs} ${year}`;
}

// ============================================
// Progress Tracker - Determine what steps have been completed
// ============================================

export interface TaskProgress {
  loggedIn: boolean;
  navigatedToReservation: boolean;
  calendarOpened: boolean;
  dateSelected: boolean;
  timeSelected: boolean;
  quantitySelected: boolean;
  confirmed: boolean;
  completedSteps: string[];
  pendingSteps: string[];
  currentPhase: string;
}

export function analyzeProgress(
  previousActions: PlannedAction[],
  currentUrl: string,
  elements: { role: string; name: string }[]
): TaskProgress {
  const progress: TaskProgress = {
    loggedIn: false,
    navigatedToReservation: false,
    calendarOpened: false,
    dateSelected: false,
    timeSelected: false,
    quantitySelected: false,
    confirmed: false,
    completedSteps: [],
    pendingSteps: [],
    currentPhase: 'starting'
  };

  // Check login status from actions
  const loginActions = previousActions.filter(a => a.action === 'login');
  if (loginActions.length > 0) {
    progress.loggedIn = true;
    progress.completedSteps.push('✅ Logged in');
  }

  // Check URL for reservation page
  const urlLower = currentUrl.toLowerCase();
  if (urlLower.includes('reserv') || urlLower.includes('booking') || urlLower.includes('tee')) {
    progress.navigatedToReservation = true;
    progress.completedSteps.push('✅ Navigated to reservation page');
  }

  // Check if on make-booking/checkout page (date/time already selected!)
  if (urlLower.includes('make-booking') || urlLower.includes('checkout') || urlLower.includes('confirm') || urlLower.includes('payment')) {
    progress.dateSelected = true;
    progress.timeSelected = true;
    progress.completedSteps.push('✅ Date and time ALREADY SELECTED');
    progress.currentPhase = 'completing_reservation';
  }

  // Check elements for booking confirmation indicators
  const elementNamesArray = elements.map(e => (e.name || '').toLowerCase());
  const hasProductSelection = elementNamesArray.some(n => n.includes('elegir producto') || n.includes('select product'));
  const hasPaymentButton = elementNamesArray.some(n => n.includes('procesar pago') || n.includes('payment') || n.includes('confirmar'));
  const hasDateInTitle = elementNamesArray.some(n => /\d{2}\/\d{2}\/\d{4}.*\d{1,2}:\d{2}/.test(n)); // Date in title format

  if (hasProductSelection || hasPaymentButton || hasDateInTitle) {
    progress.dateSelected = true;
    progress.timeSelected = true;
    if (!progress.completedSteps.includes('✅ Date and time ALREADY SELECTED')) {
      progress.completedSteps.push('✅ Date and time ALREADY SELECTED');
    }
    progress.currentPhase = 'completing_reservation';
  }

  // Check if calendar elements are visible
  const elementNamesStr = elements.map(e => (e.name || '').toLowerCase()).join(' ');
  const hasCalendarElements = elementNamesStr.includes('calendar') ||
    elementNamesStr.includes('date') ||
    elementNamesStr.includes('día') ||
    elementNamesStr.includes('fecha') ||
    /\b\d{1,2}\b/.test(elementNamesStr); // Day numbers

  if (hasCalendarElements) {
    progress.calendarOpened = true;
    progress.completedSteps.push('✅ Calendar/date picker visible');
  }

  // Check for time elements
  const hasTimeElements = elementNamesStr.includes('hora') ||
    elementNamesStr.includes('time') ||
    elementNamesStr.includes('am') ||
    elementNamesStr.includes('pm') ||
    /\d{1,2}:\d{2}/.test(elementNamesStr);

  if (hasTimeElements) {
    progress.completedSteps.push('✅ Time slots visible');
  }

  // Determine pending steps
  if (!progress.loggedIn) {
    progress.pendingSteps.push('⏳ Need to login');
    progress.currentPhase = 'authentication';
  } else if (!progress.navigatedToReservation) {
    progress.pendingSteps.push('⏳ Navigate to reservation page');
    progress.currentPhase = 'navigation';
  } else if (!progress.calendarOpened) {
    progress.pendingSteps.push('⏳ Open calendar/date picker');
    progress.currentPhase = 'open_calendar';
  } else if (!progress.dateSelected) {
    progress.pendingSteps.push('⏳ Select the target date');
    progress.currentPhase = 'select_date';
  } else if (!progress.timeSelected) {
    progress.pendingSteps.push('⏳ Select the target time');
    progress.currentPhase = 'select_time';
  } else {
    progress.pendingSteps.push('⏳ Confirm reservation');
    progress.currentPhase = 'confirm';
  }

  return progress;
}

export function getDateContext(): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(today.getDate() + 2);

  // Calculate next days of the week
  const nextSaturday = getNextDayOfWeek(6); // Saturday = 6
  const nextSunday = getNextDayOfWeek(0);   // Sunday = 0
  const nextMonday = getNextDayOfWeek(1);
  const nextFriday = getNextDayOfWeek(5);

  // This weekend
  const thisWeekend = today.getDay() === 6 ? today : (today.getDay() === 0 ? today : nextSaturday);

  const todayNum = today.getDate();
  const tomorrowNum = tomorrow.getDate();
  const dayAfterNum = dayAfterTomorrow.getDate();

  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '📅 FECHAS EN FORMATO DD/MM/YYYY',
    '═══════════════════════════════════════════════════════════════',
    `   🕐 Hora actual: ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
    '',
    `   📆 HOY:`,
    `      Fecha: ${formatDateDMY(today)}`,
    `      Día: ${todayNum}`,
    `      Completa: ${formatDateFull(today)}`,
    '',
    '   ═══════════════════════════════════════════════════════════',
    `   ⭐⭐⭐ MAÑANA:`,
    `      Fecha: ${formatDateDMY(tomorrow)}`,
    `      Día: ${tomorrowNum}`,
    `      Completa: ${formatDateFull(tomorrow)}`,
    `      CÁLCULO: día ${todayNum} + 1 = día ${tomorrowNum}`,
    '   ═══════════════════════════════════════════════════════════',
    '',
    `   📆 PASADO MAÑANA:`,
    `      Fecha: ${formatDateDMY(dayAfterTomorrow)}`,
    `      Día: ${dayAfterNum}`,
    '',
    '   🗓️ PRÓXIMOS DÍAS:',
    `      Sábado: ${formatDateDMY(nextSaturday)} (día ${nextSaturday.getDate()})`,
    `      Domingo: ${formatDateDMY(nextSunday)} (día ${nextSunday.getDate()})`,
    `      Lunes: ${formatDateDMY(nextMonday)} (día ${nextMonday.getDate()})`,
    `      Viernes: ${formatDateDMY(nextFriday)} (día ${nextFriday.getDate()})`,
    '',
    '   ⚠️ VERIFICACIÓN EN CALENDARIO:',
    `      "mañana" = día ${tomorrowNum} del mes (fecha ${formatDateDMY(tomorrow)})`,
    `      "hoy" = día ${todayNum} del mes (fecha ${formatDateDMY(today)})`,
    `      "pasado mañana" = día ${dayAfterNum} del mes (fecha ${formatDateDMY(dayAfterTomorrow)})`,
  ];

  return lines.join('\n');
}

export const SYSTEM_PROMPT = `You are an AUTONOMOUS web automation agent. Your job is to ACHIEVE GOALS, not follow step-by-step instructions.

## LANGUAGE REQUIREMENT (IMPORTANT)
- ALL your summaries and "done" responses MUST be in SPANISH
- When you complete a task, write the summary in Spanish
- Example: Instead of "Successfully reserved..." write "Reserva completada exitosamente..."
- Example: Instead of "Could not complete..." write "No se pudo completar..."

## VALID ACTIONS (CRITICAL - USE ONLY THESE)
You MUST respond with ONE of these actions. NEVER respond with "undefined" or empty action:
- click [ref] - Click on an element (e.g., click [e5])
- type [ref]: "value" - Type text into an input field
- scroll - Scroll the page (with direction: "up" or "down")
- navigate: "url" - Go to a specific URL
- login - Fill and submit login form (only when login form is visible)
- wait - Wait for page to load (use sparingly)
- done - Task is complete

**IF YOU DON'T KNOW WHAT TO DO:**
- Use "scroll" with direction "up" or "down" to see more content
- NEVER respond with action: "undefined"

## YOUR MISSION
The user gives you a GOAL (what they want to accomplish). YOU must figure out HOW to achieve it by:
1. Analyzing what you see on the current page
2. Deciding the best next action to get closer to the goal
3. Adapting your strategy as pages change
4. Continuing until the goal is fully achieved

## STRATEGIC THINKING
Before EVERY action, ask yourself:
- What is my ULTIMATE GOAL?
- What do I currently see on this page?
- Am I logged in? Do I need to be?
- What is blocking me from reaching the goal?
- What is the most logical next step?

## AUTOMATIC BEHAVIORS (DO THESE WITHOUT BEING TOLD)

### Authentication (CRITICAL - READ CAREFULLY)
- ONLY use the "login" action when you see BOTH:
  1. An email/username input field AND
  2. A password input field (type="password")
- If you DON'T see a password field, you are NOT on a login page - do NOT use "login" action
- If you already used "login" action and the page looks the same, the login FAILED or you're already logged in
- Signs you ARE logged in: "Logout", "Sign out", "Mi cuenta", user profile icon, no login form visible
- NEVER repeat the "login" action more than 2 times on the same page
- After login, WAIT for the page to change before taking another action

### Navigation
- If you don't see what you need → look for menus, navigation links
- If the page seems empty → scroll down to load more content
- If you're on the wrong page → use navigation or go back

### Forms & Inputs
- Date pickers: These are CLICKABLE calendars, NOT text inputs. Click to open, then click the date.
- Time slots: Usually displayed as BUTTONS showing times like "10:00 AM" - CLICK them, don't type
- Dropdowns/Selects: Click to open, then click the option you want
- Text inputs: Only TYPE into actual input fields (textbox role)

### DATE SELECTION (VERY IMPORTANT)
- You will receive EXACT DATE INFORMATION including today, tomorrow, next Saturday, etc.
- When the user says "tomorrow" → use the EXACT day number provided in the date context
- When the user says "next Saturday" → use the EXACT day number for next Saturday

**HOW TO OPEN A DATE PICKER:**
- Look for INPUT fields with labels like "Fecha", "Date", "Seleccionar Fecha"
- CLICK on the INPUT field to open the calendar/datepicker
- If you see an input with type="text" near a date label → CLICK IT to open calendar
- Example: If you see [e7] input: "Seleccionar Fecha" → click [e7] to open calendar

**HOW TO SELECT A DATE (CALENDAR METHOD):**
- After clicking the input, a calendar should appear with day numbers
- In calendars, look for buttons/elements with the DAY NUMBER (e.g., "15", "16", "22")
- To select a date: First find the correct MONTH (navigate if needed), then click the DAY NUMBER
- ALWAYS use the day numbers from the DATE CONTEXT section - these are calculated for you
- Example: If tomorrow is "Wednesday 15 March" → click the button/element showing "15"

⚠️ VERIFY BEFORE CLICKING DATE (CRITICAL):
- BEFORE clicking a day, VERIFY the element text matches your target day number
- If target is day "2", find an element with EXACTLY "2" as the name
- Check TASK BREAKDOWN section for your exact target day number
- If you see [e28] "2" and your target is day 2 → that's correct, click it
- If you see [e28] "15" but your target is day 2 → DON'T click, find the correct one
- NEVER click a day element without verifying it matches your target

**HOW TO TYPE A DATE (IF CALENDAR DOESN'T WORK):**
- Some date fields accept typed input instead of calendar selection
- If the field accepts text, use one of these formats (check TASK BREAKDOWN for exact values):
  - DD/MM/YYYY (most common): "02/02/2026"
  - YYYY-MM-DD (ISO format): "2026-02-02"
  - DD-MM-YYYY: "02-02-2026"
  - MM/DD/YYYY (US format): "02/02/2026"
- After typing, press Enter or click outside to confirm
- The correct format depends on the website - try DD/MM/YYYY first

**IF CALENDAR DOESN'T APPEAR:**
- Try clicking the input again
- Try clicking the label next to the input
- Look for a calendar icon button near the input

**WHEN CALENDAR IS OPEN (CRITICAL):**
- If you see MANY elements (30+) after clicking a date input → THE CALENDAR IS OPEN
- DO NOT use "login" action when calendar is open!
- DO NOT click navigation links when calendar is open!
- LOOK for elements with day numbers: "1", "2", "3", ... "31"
- Find the EXACT day number you need and CLICK it
- If you need day "2", look for an element named "2" and click it
- After selecting the day, the calendar will close automatically
- Then continue with the next step (selecting time, etc.)

**AFTER SELECTING DATE - FIND TIME SLOTS (CRITICAL):**
- After clicking a date, TIME SLOTS should appear on the page
- Time slots look like: "6:00am", "7:00am", "8:00am", "10:00am", "14:30", etc.
- They are span or button elements with TIME values, NOT calendar days

**⚠️ CALENDAR vs TIME SLOTS - UNDERSTAND THE DIFFERENCE:**
- CALENDAR (date picker): Shows day NUMBERS (1, 2, 3, 4, ... 31)
  - Used to SELECT THE DATE
  - Click the DAY NUMBER to select (e.g., click "2" for day 2)
- TIME SLOTS: Shows TIMES with colons (6:00am, 7:00am, 10:00am)
  - Used to SELECT THE HOUR
  - Click the TIME that matches your target (e.g., click "10:00am")
  
**WHEN YOU SEE TIMES LIKE "6:00am", "10:00am":**
- You are on the TIME SLOTS page, NOT the calendar
- The DATE was already selected
- Now you need to click the CORRECT TIME
- DO NOT look for "day 2" here - that was the calendar step
- LOOK for your target time (e.g., "10:00am") and click it

⚠️ VERIFY BEFORE CLICKING TIME SLOT (CRITICAL):
- BEFORE clicking a time slot, VERIFY it matches your target time
- Check TASK BREAKDOWN section for your exact target time
- If target is "10:00 AM", find element with "10:00" or "10:00am" or "10:00 AM"
- If you see [e15] "7:00am" but target is 10:00 AM → DON'T click, find "10:00"
- If you see [e18] "10:00am" and target is 10:00 AM → that's correct, click it
- Time formats may vary: "10:00", "10:00am", "10:00 AM", "10:00 a.m."
- NEVER click a time slot without verifying it matches your target time

⚠️ VERY IMPORTANT - DO NOT CLICK MENU LINKS:
- [e1] "Reservar" is a NAVIGATION MENU link, NOT a submit button!
- After selecting date, you should see MORE elements (15-50), not fewer
- If you see [e1] "Reservar" at the top of the list → IGNORE IT, it's just the menu
- Look for elements with TIME patterns (7:00, 8:00, 10:00, etc.)
- The time slots are usually in the MIDDLE of the element list, not at the beginning

- DO NOT click "Reservar" menu link after selecting date!
- DO NOT do multiple scrolls/waits - the time slots should be visible
- If you see 15-50 elements after date selection → look for TIME elements in the list
- CLICK the time slot that matches your target time (e.g., "10:00 AM", "10:00am")
- If the page has few elements (< 10) after date selection, scroll DOWN ONCE to find time slots

### Obstacles
- Cookie banners, popups, modals → dismiss them and continue
- "Accept cookies", "Aceptar", "Cerrar" → click to dismiss
- If something blocks your view → close it first

## DETECTING ELEMENT TYPES
- role: "textbox" or "input" → you CAN type here
- role: "button" or "link" → you must CLICK, never type
- role: "combobox" → click to open dropdown, then select
- Elements showing dates/times as text → likely clickable, not typeable

## ELEMENTS THAT ARE NOT CLICKABLE (DO NOT CLICK THESE)
- h1, h2, h3, h4, h5, h6 tags → these are TITLES, just display text
- label elements → these are LABELS for inputs, not buttons
- Elements showing confirmation info (like "Reservar 03/01/2026 10:00am") → these are READ-ONLY titles
- If an element shows a date/time you ALREADY selected → it's confirming your selection, NOT a button to change it

## RECOGNIZING COMPLETED STEPS (IMPORTANT FOR SPEED)
- If you see a page with "Elegir Producto", "Procesar Pago" → you ALREADY selected date/time, move to next step!
- If the URL changed to "make-booking", "checkout", "confirm" → date selection is DONE
- If you see your selected date/time in a title → that step is COMPLETE, proceed to next step
- DO NOT go back to re-select date if you already see confirmation
- FOCUS on what's NEXT: product selection, payment, confirmation

## BE EFFICIENT (SPEED IS IMPORTANT)
- DO NOT use "wait" or "scroll" unless absolutely necessary
- If you see the elements you need → CLICK them immediately, don't wait
- If you already selected something and see confirmation → MOVE ON to next step
- Each unnecessary action wastes time - be DIRECT and PURPOSEFUL
- If you're on a booking/checkout page → focus on completing the form, not re-selecting
- NEVER use "login" if you see user-specific content (like "Mis Reservas", "Mi Cuenta", "Salir")

## AVOIDING LOOPS & FAILURES (VERY IMPORTANT)
- If you did the same action 2+ times with no visible change → STOP and TRY SOMETHING COMPLETELY DIFFERENT
- If you used "login" action and the page still shows login form → login failed, DO NOT retry login
- If the page looks identical after your action → the action probably failed, try another approach
- If you can't find what you need → scroll down, look for navigation menu, or try a different URL path
- If an action fails → NEVER repeat the exact same action, try an alternative
- Track what you've already tried and NEVER repeat failed approaches
- If you see the same 2-3 elements repeatedly → you might be on a loading page, wait or scroll
- CRITICAL: If "login" appears multiple times in your action history, STOP using login and analyze the page differently
- CRITICAL: If you see "Salir", "Logout", "Mi Cuenta" → you are ALREADY logged in, DO NOT use login action!

## KNOWING WHEN YOU'RE DONE (VERY IMPORTANT - READ CAREFULLY)
- Goal achieved: You see confirmation of success (confirmation message, receipt, "thank you" page)
- Goal impossible: You've tried multiple approaches and none work, or the option doesn't exist
- Be HONEST: Don't say "done" unless you actually completed the goal or truly cannot proceed

## RESERVATION IS NOT COMPLETE UNTIL (CRITICAL):
- You see a PAYMENT page or CONFIRMATION page
- The URL changed to something like: /checkout, /payment, /confirm, /make-booking
- You see "Procesar Pago", "Confirmar", "Pagar", "Complete", "Confirmation"
- You filled ALL required fields (product, players, payment info)
- NEVER say "reserva completada" if you're still on the time slots page!
- After clicking a time slot, the page SHOULD CHANGE to a booking form
- If the page didn't change after clicking time slot → try clicking again or scroll

## AFTER CLICKING TIME SLOT (CRITICAL):
- The page should navigate to a booking/checkout page
- If you still see time slots after clicking → the click didn't work
- Look for: "Elegir Producto", "Procesar Pago", "Confirmar Reserva"
- If URL still shows "/welcome" → you haven't progressed, keep trying

## IF TIME SLOT CLICK DOESN'T WORK:
- If you clicked 10:00am but still see time slots → the click FAILED
- DO NOT scroll away! The time slot might need a different click approach
- Try scrolling UP to see the time slot again if you scrolled past it
- Try clicking the element again with a different ref if available
- The time slot might be a link or need to be clicked on a specific area
- NEVER give up and say "completed" if the page didn't change!

## DO NOT GIVE UP TOO EARLY (CRITICAL)
- If you don't see your target time slot → SCROLL DOWN to see more slots
- There are usually MORE time slots below the visible ones
- NEVER say "no available times" without scrolling to see all options first
- If you see time slots from 6:00-8:00 but need 10:00 → scroll down, there are more
- Only say "no available times" AFTER scrolling and confirming no matching slots exist

## DO NOT LIE ABOUT COMPLETION
- NEVER say "reserva completada" unless you SEE confirmation
- Check the URL - did it change to a confirmation page?
- Check the elements - do you see payment/confirmation elements?
- If still on time slots page → reservation is NOT complete!

## SUMMARY LANGUAGE
- Write ALL summaries in SPANISH
- "Reserva completada para..." not "Reservation completed for..."
- "No se encontró horario disponible para..." not "No available time found..."

## RESPONSE FORMAT
Respond with ONLY valid JSON. No explanations outside the JSON.

### For actions:
{"action":"click","ref":"e5","reason":"clicking login button because I need to authenticate first"}
{"action":"type","ref":"e3","value":"user@email.com","reason":"entering email in login form"}
{"action":"login","reason":"login form detected and credentials were provided"}
{"action":"selectTimeSlot","value":"10:00am","reason":"selecting the 10:00am time slot for the reservation"}
{"action":"scroll","direction":"down","reason":"looking for reservation calendar"}
{"action":"select","ref":"e7","value":"2","reason":"selecting number of players"}
{"action":"wait","waitFor":"load","reason":"waiting for dynamic content to load after clicking button"}

### When goal is ACHIEVED:
{"done":true,"summary":"Successfully reserved tee time for March 15 at 10:00 AM for 2 players. Confirmation #12345."}

### When goal CANNOT be achieved:
{"done":true,"summary":"Could not complete reservation: no available tee times at 10 AM tomorrow. Earliest available is 2 PM."}

## AVAILABLE ACTIONS
| Action | Parameters | Use for |
|--------|------------|---------|
| click | ref | Clicking buttons, links, calendar dates |
| type | ref, value | Entering text in input fields ONLY |
| select | ref, value | Choosing from dropdown menus |
| selectTimeSlot | value (time like "10:00am") | **USE THIS FOR TIME SLOTS** - Efficient auto-scroll and click |
| login | (none) | Auto-fill login form with provided credentials |
| scroll | direction (up/down) | Finding content not currently visible |
| wait | waitFor | Waiting for page to load or element to appear |
| navigate | value (url) | Going to a specific URL |
| goBack | (none) | Returning to previous page |
| done | summary | Goal achieved or cannot be achieved |

## ⛔ TIME SLOT SELECTION - MANDATORY RULES
**PROHIBIDO**: NUNCA uses "click" o "scroll" para seleccionar horarios.
**OBLIGATORIO**: SIEMPRE usa "selectTimeSlot" para CUALQUIER horario (10:00am, 10:10am, 2:30pm, etc.)

When you see a time picker/grid with times like "10:00am", "10:30am", etc:
- ❌ WRONG: {"action":"click","ref":"e15","reason":"clicking on 10:00am"}
- ❌ WRONG: {"action":"scroll","direction":"down","reason":"looking for 10:00am"}
- ✅ CORRECT: {"action":"selectTimeSlot","value":"10:00am","reason":"selecting 10:00am slot"}

The selectTimeSlot action:
- Automatically finds the time slot on the page
- Scrolls to it if needed
- Clicks it in one operation
- Returns nearby alternatives if unavailable

## CRITICAL RULES
1. Use element refs (e1, e2, e3...) from the page snapshot - these are your targets
2. NEVER type into non-input elements - if it's a button or link, CLICK it
3. Be AUTONOMOUS - discover the process yourself, don't wait for instructions
4. Credentials provided = LOGIN FIRST before attempting the main goal
5. ADAPT to what you actually see, don't assume how the page works
6. Be PERSISTENT but not repetitive - try different approaches if one fails
7. Be HONEST about success/failure - don't claim success without confirmation
8. **FOR TIME SLOTS**: ALWAYS use selectTimeSlot action, NEVER use click on time elements
`;

// Track last URL to detect page changes
let lastKnownUrl = '';

export function buildUserPrompt(params: {
  instruction: string;
  currentUrl: string;
  snapshot: PageSnapshot;
  previousActions: PlannedAction[];
  credentials?: Credentials;
  formData?: Record<string, string>;
}): string {
  const parts: string[] = [];

  // Extract structured data from instruction (NEW - cleaner data)
  const structuredData = extractStructuredData(params.instruction, params.credentials);

  // Parse the instruction to extract structured data (legacy - keep for compatibility)
  const parsed = parseInstruction(params.instruction);

  // Analyze progress
  const progress = analyzeProgress(
    params.previousActions,
    params.currentUrl,
    params.snapshot.elements.map(e => ({ role: e.role, name: e.name }))
  );

  // ========== NEW STRUCTURED DATA DISPLAY ==========
  parts.push(formatStructuredDataForPrompt(structuredData));
  parts.push('');

  // ========== ORIGINAL ACTION MESSAGE ==========
  parts.push('═══════════════════════════════════════════════════════════════');
  parts.push('📨 MENSAJE ORIGINAL DEL USUARIO:');
  parts.push('═══════════════════════════════════════════════════════════════');
  parts.push(`   "${params.instruction}"`);
  parts.push('');

  // ========== STRUCTURED TASK INFO (Legacy format - kept for compatibility) ==========
  parts.push('═══════════════════════════════════════════════════════════════');
  parts.push('📋 TASK BREAKDOWN (PARSED FROM YOUR INSTRUCTION):');
  parts.push('═══════════════════════════════════════════════════════════════');
  parts.push(`   Task Type: ${parsed.taskType.toUpperCase()}`);

  if (parsed.targetDate) {
    const dayNum = parsed.targetDate.getDate();
    const monthNum = parsed.targetDate.getMonth() + 1;
    const yearNum = parsed.targetDate.getFullYear();
    const monthNameES = MONTHS_ES[parsed.targetDate.getMonth()];
    const dayOfWeekES = DAYS_ES[parsed.targetDate.getDay()];
    const dateFormatted = formatDateDMY(parsed.targetDate);

    parts.push(`   📅 FECHA OBJETIVO: ${parsed.targetDateText}`);
    parts.push('');
    parts.push('   ═══════════════════════════════════════════════════════════');
    parts.push(`   ⭐ FECHA EXACTA A SELECCIONAR:`);
    parts.push(`      📆 Formato DD/MM/YYYY: ${dateFormatted}`);
    parts.push(`      📆 Día del mes: ${dayNum}`);
    parts.push(`      📆 Mes: ${monthNameES} (${monthNum})`);
    parts.push(`      📆 Año: ${yearNum}`);
    parts.push(`      📆 Fecha completa: ${dayOfWeekES} ${dayNum} de ${monthNameES} de ${yearNum}`);
    parts.push('   ═══════════════════════════════════════════════════════════');
    parts.push('');
    parts.push(`   🎯 EN EL CALENDARIO:`);
    parts.push(`      → Busca el número "${dayNum}" y haz clic en él`);
    parts.push(`      → El mes debe ser ${monthNameES} (mes ${monthNum})`);
    parts.push('');
    parts.push(`   🚨 VERIFICACIÓN OBLIGATORIA - NO SELECCIONES OTRA FECHA:`);
    parts.push(`      ✓ SOLO haz clic en el día "${dayNum}"`);
    parts.push(`      ✓ El mes DEBE ser ${monthNameES} (${monthNum})`);
    parts.push(`      ✓ La fecha DEBE ser ${dateFormatted}`);
    parts.push(`      ❌ Si el calendario muestra otro mes, navega hasta ${monthNameES}`);
    parts.push(`      ❌ NO hagas clic en ningún otro número que no sea "${dayNum}"`);
    parts.push('');
    parts.push('      📝 SI NECESITAS ESCRIBIR LA FECHA:');
    parts.push(`         • DD/MM/YYYY: "${dateFormatted}"`);
    Object.entries(parsed.dateFormats).forEach(([format, value]) => {
      if (format !== 'dayNumber' && format !== 'DD/MM/YYYY') {
        parts.push(`         • ${format}: "${value}"`);
      }
    });
  }

  if (parsed.targetTime) {
    parts.push('');
    parts.push(`   ⏰ HORA OBJETIVO: ${parsed.targetTime}`);
    parts.push(`      → Busca el horario "${parsed.targetTime}" o similar (ej: "10:00am", "10:00 AM")`);
    parts.push('');
    parts.push(`   🚨 VERIFICACIÓN DE HORA - NO SELECCIONES OTRA HORA:`);
    parts.push(`      ✓ SOLO haz clic en "${parsed.targetTime}"`);
    parts.push(`      ❌ NO selecciones 8:30, 9:00, o cualquier otra hora`);
    parts.push(`      ❌ Si no ves "${parsed.targetTime}", haz scroll para buscarla`);
  }

  if (parsed.quantity) {
    parts.push(`   👥 QUANTITY: ${parsed.quantity} players/people`);
  }

  if (parsed.additionalDetails.length > 0) {
    parts.push(`   📝 Details: ${parsed.additionalDetails.join(', ')}`);
  }
  parts.push('');

  // ========== PROGRESS TRACKING ==========
  parts.push('═══════════════════════════════════════════════════════════════');
  parts.push('📊 YOUR PROGRESS:');
  parts.push('═══════════════════════════════════════════════════════════════');

  if (progress.completedSteps.length > 0) {
    parts.push('   Completed:');
    progress.completedSteps.forEach(step => parts.push(`      ${step}`));
  }

  parts.push('   Pending:');
  progress.pendingSteps.forEach(step => parts.push(`      ${step}`));

  parts.push(`   📍 CURRENT PHASE: ${progress.currentPhase.toUpperCase()}`);
  parts.push('');

  // ========== DATE CONTEXT ==========
  parts.push(getDateContext());
  parts.push('');

  // ========== GOAL ==========
  parts.push('═══════════════════════════════════════════════════════════════');
  parts.push(`🎯 ORIGINAL GOAL: ${params.instruction}`);
  parts.push('═══════════════════════════════════════════════════════════════');
  parts.push('');

  // Detect page change
  const pageChanged = lastKnownUrl !== '' && lastKnownUrl !== params.currentUrl;
  lastKnownUrl = params.currentUrl;

  // Current state with page change indicator
  if (pageChanged) {
    parts.push('🌐 *** PAGE HAS CHANGED! *** This is a NEW page - analyze carefully!');
  }
  parts.push(`📍 CURRENT PAGE: ${params.currentUrl}`);
  parts.push(`📊 Page Title: ${params.snapshot.title}`);
  parts.push('');

  // Detect if stuck at bottom of page (few elements, many scroll downs)
  const recentScrollsDownCount = params.previousActions.slice(-6).filter(a =>
    a.action === 'scroll' && (a.direction === 'down' || !a.direction)
  ).length;
  const currentVisibleElements = params.snapshot.elements.length;

  if (recentScrollsDownCount >= 3 && currentVisibleElements <= 5) {
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('🚨 *** ESTÁS ATASCADO EN LA PARTE INFERIOR DE LA PÁGINA ***');
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push(`   Has hecho ${recentScrollsDownCount} scrolls hacia abajo y solo ves ${currentVisibleElements} elementos`);
    parts.push('   📌 ACCIÓN REQUERIDA: scroll con direction: "up"');
    parts.push('   Esto te llevará de vuelta a ver los horarios/elementos');
    parts.push('');
  }

  // Detect if on booking/checkout page (date already selected)
  const urlLower = params.currentUrl.toLowerCase();
  const isOnBookingPage = urlLower.includes('make-booking') || urlLower.includes('checkout') ||
    urlLower.includes('confirm') || urlLower.includes('payment');
  const hasProductSelect = params.snapshot.elements.some(e =>
    (e.name || '').toLowerCase().includes('elegir producto') ||
    (e.name || '').toLowerCase().includes('procesar pago')
  );

  if (isOnBookingPage || hasProductSelect) {
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('🎯 *** YOU ARE ON THE BOOKING PAGE! ***');
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('   Date and time have been selected.');
    parts.push('   NOW you must complete the reservation:');
    parts.push('');
    parts.push('   📋 STEPS TO COMPLETE:');
    parts.push('   1. Select product from dropdown (if available)');
    parts.push('   2. Add other players if needed');
    parts.push('   3. Click "Procesar Pago" or "Confirmar" to complete');
    parts.push('');
    parts.push('   ⚠️ RESERVATION IS NOT COMPLETE UNTIL:');
    parts.push('   - You click "Procesar Pago" and see a confirmation');
    parts.push('   - Or you see "Reserva confirmada", "Éxito", "Gracias"');
    parts.push('');
  } else if (!isOnBookingPage && !hasProductSelect) {
    // Still on welcome page with time slots - need to progress
    const stillOnWelcome = urlLower.includes('welcome');
    if (stillOnWelcome && params.previousActions.length > 5) {
      parts.push('');
      parts.push('   ⚠️ WARNING: You are still on the WELCOME page!');
      parts.push('   After selecting time, you should be redirected to /make-booking');
      parts.push('   If not redirected, the time slot selection might not have worked.');
      parts.push('');
    }
  }

  // ========== DETECT CALENDAR OPEN ==========
  const elementCount = params.snapshot.elements.length;

  // Check if any element looks like a calendar day (numbers 1-31)
  const dayElements = params.snapshot.elements.filter(e => {
    const name = e.name?.trim();
    if (!name) return false;
    const num = parseInt(name);
    return num >= 1 && num <= 31 && name === num.toString();
  });

  // Calendar is likely open if we see day numbers
  const calendarMightBeOpen = dayElements.length >= 5 || elementCount > 30;

  if (calendarMightBeOpen && parsed.targetDate) {
    const dayNum = parsed.targetDate.getDate();
    const monthName = MONTHS_EN[parsed.targetDate.getMonth()];
    const monthNameES = MONTHS_ES[parsed.targetDate.getMonth()];

    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('📅 *** CALENDAR IS OPEN! SELECT THE DATE NOW! ***');
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('');
    parts.push(`   🎯 TARGET DAY: ${dayNum}`);
    parts.push(`   📆 Target Month: ${monthName} / ${monthNameES}`);
    parts.push('');
    parts.push('   ⚠️ VERIFY BEFORE CLICKING:');
    parts.push(`   - The element you click MUST show exactly "${dayNum}"`);
    parts.push(`   - If element shows different number → DON'T click it`);
    parts.push('');

    // Try to find the exact element to click
    const targetElement = params.snapshot.elements.find(e => e.name?.trim() === dayNum.toString());
    if (targetElement) {
      parts.push(`   ✅ VERIFIED: Click [${targetElement.ref}] → shows "${dayNum}" ✓`);
      parts.push(`   ACTION: click [${targetElement.ref}]`);
    } else {
      // Show available day elements
      const availableDays = dayElements.slice(0, 10).map(e => `[${e.ref}]="${e.name}"`).join(', ');
      parts.push(`   ⚠️ Day "${dayNum}" not found directly. Available days: ${availableDays}`);
      parts.push(`   → Look for element with text "${dayNum}" and click it`);
    }
    parts.push('');
    parts.push('   ❌ DO NOT CLICK: "Reservar", navigation links, or use "login"!');
    parts.push('');
  } else if (calendarMightBeOpen) {
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('📅 *** CALENDAR APPEARS TO BE OPEN ***');
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('   → Look for day numbers and click the correct one');
    parts.push('   → DO NOT click navigation links or use "login"!');
    parts.push('');
  }

  // ========== DETECT DATE INPUT FIELD (CRITICAL - CHECK BEFORE TIME SLOTS) ==========
  // Look for date input fields that need to be clicked to open calendar
  const dateInputElements = params.snapshot.elements.filter(e => {
    const name = (e.name || '').toLowerCase();
    const role = (e.role || '').toLowerCase();
    return (role === 'input' || role === 'textbox') &&
      (name.includes('fecha') || name.includes('date') ||
        name.includes('seleccionar') || name.includes('select'));
  });

  // Check if there's a date label but possibly no input visible
  const hasDateLabel = params.snapshot.elements.some(e => {
    const name = (e.name || '').toLowerCase();
    const role = (e.role || '').toLowerCase();
    return role === 'label' && (name.includes('fecha') || name.includes('date'));
  });

  // Check if time slots are showing very early times (midnight range) - indicates date not selected
  const earlyMorningSlots = params.snapshot.elements.filter(e => {
    const name = (e.name || '').toLowerCase().replace(/\s/g, '');
    return /^12:\d{2}am$/.test(name) || /^1:\d{2}am$/.test(name) || /^2:\d{2}am$/.test(name);
  });

  const hasDateInputVisible = dateInputElements.length > 0;
  const hasEarlyMorningSlotsOnly = earlyMorningSlots.length >= 3;

  // If date input is visible, we should SELECT DATE FIRST before looking at time slots
  if (hasDateInputVisible || (hasDateLabel && hasEarlyMorningSlotsOnly)) {
    parts.push('');
    parts.push('╔═══════════════════════════════════════════════════════════════╗');
    parts.push('║  🚨 IMPORTANTE: DEBES SELECCIONAR LA FECHA PRIMERO 🚨        ║');
    parts.push('╠═══════════════════════════════════════════════════════════════╣');
    parts.push('║                                                               ║');
    parts.push('║  HAY UN CAMPO DE FECHA QUE NECESITA SER SELECCIONADO         ║');
    parts.push('║  Los horarios actuales (12:10am, etc.) son de MADRUGADA      ║');
    parts.push('║  Esto indica que NO se ha seleccionado la fecha correcta     ║');
    parts.push('║                                                               ║');
    parts.push('╚═══════════════════════════════════════════════════════════════╝');
    parts.push('');

    if (dateInputElements.length > 0) {
      const dateInput = dateInputElements[0];
      parts.push(`   🎯 ACCIÓN REQUERIDA: Haz clic en [${dateInput.ref}] para abrir el calendario`);
      parts.push(`   📋 Elemento: [${dateInput.ref}] ${dateInput.role}: "${dateInput.name}"`);
      parts.push('');
      parts.push('   📌 DESPUÉS de abrir el calendario:');
      if (parsed.targetDate) {
        const dayNum = parsed.targetDate.getDate();
        parts.push(`      1. Busca el día "${dayNum}" en el calendario`);
        parts.push(`      2. Haz clic en "${dayNum}" para seleccionar la fecha`);
        parts.push(`      3. LUEGO busca el horario ${parsed.targetTime || '10:00am'}`);
      }
    }

    parts.push('');
    parts.push('   ❌ NO hagas scroll buscando 10:00am todavía');
    parts.push('   ❌ Los horarios 12:10am, 12:20am son de MADRUGADA, no lo que buscas');
    parts.push('   ❌ PRIMERO selecciona la fecha, LUEGO aparecerán los horarios correctos');
    parts.push('');
  }

  // ========== DETECT TIME SLOTS ==========
  // Check for time-related elements (time slots after date selection)
  const timeSlotElements = params.snapshot.elements.filter(e => {
    const name = (e.name || '').toLowerCase();
    return name.includes('am') || name.includes('pm') ||
      /\d{1,2}:\d{2}/.test(name) ||  // 10:00, 7:30, etc.
      name.includes('hora') || name.includes('turno') ||
      name.includes('slot') || name.includes('disponible');
  });

  // AGGRESSIVE TIME SLOT DETECTION: If many elements look like times, we're definitely on time slots page
  const timePatternElements = params.snapshot.elements.filter(e => {
    const name = (e.name || '').toLowerCase();
    return /^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(name.trim());
  });
  const isDefinitelyTimeSlotPage = timePatternElements.length >= 5;

  // Also check if we have many elements (15-50) which likely means time slots appeared
  const likelyTimeSlotsPage = (elementCount >= 15 && elementCount <= 60 && !calendarMightBeOpen) || isDefinitelyTimeSlotPage;

  // Check if we already clicked a time slot in previous actions
  const clickedTimeSlot = params.previousActions.some(a =>
    a.action === 'click' &&
    (a.reason?.toLowerCase().includes('10:00') ||
      a.reason?.toLowerCase().includes('horario') ||
      a.reason?.toLowerCase().includes('time slot') ||
      a.reason?.toLowerCase().includes('hora') ||
      /\d{1,2}:\d{2}/.test(a.reason || ''))
  );

  // Count how many times we clicked a time slot
  const timeSlotClicks = params.previousActions.filter(a =>
    a.action === 'click' &&
    (a.reason?.toLowerCase().includes('am') ||
      a.reason?.toLowerCase().includes('pm') ||
      /\d{1,2}:\d{2}/.test(a.reason || ''))
  ).length;

  if ((timeSlotElements.length > 0 || likelyTimeSlotsPage) && !calendarMightBeOpen) {
    // VERY IMPORTANT: Make it crystal clear this is NOT a calendar
    parts.push('');
    parts.push('╔═══════════════════════════════════════════════════════════════╗');
    parts.push('║  🚫 ESTO NO ES UN CALENDARIO - ES LA PÁGINA DE HORARIOS 🚫   ║');
    parts.push('║                                                               ║');
    parts.push('║  Los números que ves (6:00am, 10:00am) son HORAS, no DÍAS    ║');
    parts.push('║  NO busques "día 2" - la FECHA ya está seleccionada          ║');
    parts.push('║  DEBES hacer clic en la HORA correcta                        ║');
    parts.push('║                                                               ║');
    parts.push('║  🚨 SI VES TU HORA (10:00am): HAZ CLICK, NO SCROLL! 🚨       ║');
    parts.push('╚═══════════════════════════════════════════════════════════════╝');
    parts.push('');

    // If we already clicked a time slot but still seeing time slots, something is wrong
    if (clickedTimeSlot) {
      parts.push('═══════════════════════════════════════════════════════════════');
      parts.push('🚨 *** PROBLEMA: SIGUES EN LA PÁGINA DE HORARIOS! ***');
      parts.push('═══════════════════════════════════════════════════════════════');
      parts.push(`   Has hecho clic en un horario ${timeSlotClicks} veces pero la página NO cambió!`);
      parts.push('');

      if (timeSlotClicks >= 3) {
        parts.push('   ⚠️ MÚLTIPLES INTENTOS FALLIDOS - EL CLIC NO FUNCIONA');
        parts.push('   📋 ALTERNATIVAS:');
        parts.push('   1. Intenta hacer clic en un elemento "i" ADYACENTE al horario');
        parts.push('   2. Los elementos "i" pueden ser iconos que activan la selección');
        parts.push('   3. Busca el "i" element justo DESPUÉS del horario 10:00am');
        parts.push('');
      }

      // Check if target time is visible
      const targetTimeVisible = parsed.targetTime && timeSlotElements.some(e =>
        (e.name || '').toLowerCase().includes('10:00') ||
        (e.name || '').toLowerCase().includes(parsed.targetTime?.split(':')[0] || '')
      );

      if (targetTimeVisible) {
        const targetSlot = timeSlotElements.find(e =>
          (e.name || '').toLowerCase().includes('10:00')
        );
        if (targetSlot) {
          // Find adjacent i elements
          const targetIdx = params.snapshot.elements.findIndex(e => e.ref === targetSlot.ref);
          const adjacentElements = params.snapshot.elements.slice(targetIdx, targetIdx + 4);
          const iElements = adjacentElements.filter(e => e.role === 'i' || e.name === 'i element');

          parts.push(`   📋 OPCIONES:`);
          parts.push(`   → Opción 1: click [${targetSlot.ref}] (horario directo)`);
          if (iElements.length > 0) {
            parts.push(`   → Opción 2: click [${iElements[0].ref}] (icono adyacente)`);
          }
        }
      } else {
        parts.push('   1. El horario 10:00am NO está visible');
        parts.push('   2. Haz scroll hacia ARRIBA (direction: "up") para encontrarlo');
      }
      parts.push('');
      parts.push('   ❌ NO digas "reserva completada" - sigues en la página de horarios!');
      parts.push('');
    }

    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('⏰ *** PÁGINA DE HORARIOS (TIME SLOTS) ***');
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('');
    parts.push('   ⚠️ ESTÁS EN LA PÁGINA DE HORARIOS, NO EN EL CALENDARIO DE FECHAS');
    parts.push('   ⚠️ Ya seleccionaste la FECHA, ahora debes seleccionar la HORA');
    parts.push('   ⚠️ Los elementos que ves (6:00am, 7:00am, 10:00am) son HORARIOS');
    parts.push('   ⚠️ NO busques "el día 2" aquí - eso ya lo hiciste');
    parts.push('');

    if (parsed.targetTime) {
      // Extract hour from target time (e.g., "10" from "10:00 AM")
      const targetHour = parsed.targetTime.match(/(\d{1,2})/)?.[1] || '';

      parts.push(`   🎯 HORA OBJETIVO: ${parsed.targetTime}`);
      parts.push(`   🎯 Busca el elemento que diga "${targetHour}:00am" o "${targetHour}:00"`);
      parts.push('');
      parts.push(`   🚨 IMPORTANTE:`);
      parts.push(`   ✓ Haz clic en "${targetHour}:00am" (NO en ${targetHour}:30am ni otra)`);
      parts.push(`   ❌ NO hagas clic en 6:00am, 7:00am, 8:00am, 8:30am, 9:00am, 10:30am`);
      parts.push(`   ❌ SOLO haz clic en "${targetHour}:00am"`);
      parts.push('');
      parts.push(`   🎯 TARGET TIME: ${parsed.targetTime}`);
      parts.push('');
      parts.push('   ⚠️ VERIFY BEFORE CLICKING:');
      parts.push(`   - The time slot you click MUST contain "${parsed.targetTime}" or similar`);
      parts.push('   - Acceptable formats: "10:00", "10:00am", "10:00 AM"');
      parts.push(`   - If element shows different time → DON'T click it`);
    }

    parts.push('');
    parts.push('   ❌ DO NOT CLICK:');
    parts.push('   - [e1] "Reservar" - it is just a MENU LINK!');
    parts.push('   - Any navigation links at the top of the list');
    parts.push('');

    // Try to find matching time slot
    if (timeSlotElements.length > 0 && parsed.targetTime) {
      const targetHour = parsed.targetTime.match(/(\d{1,2})/)?.[1] || '10';

      // Find EXACT match for target time (e.g., "10:00am" NOT "10:30am")
      const exactMatch = timeSlotElements.find(e => {
        const name = (e.name || '').toLowerCase().replace(/\s/g, '');
        return name === `${targetHour}:00am` ||
          name === `${targetHour}:00pm` ||
          name === `${targetHour}:00`;
      });

      parts.push(`   📋 Horarios disponibles:`);
      timeSlotElements.slice(0, 10).forEach(e => {
        const name = (e.name || '').toLowerCase().replace(/\s/g, '');
        const isExactMatch = name === `${targetHour}:00am` ||
          name === `${targetHour}:00pm` ||
          name === `${targetHour}:00`;
        const marker = isExactMatch ? '✅ →' : '   ';
        parts.push(`      ${marker} [${e.ref}] "${e.name}"`);
      });

      if (exactMatch) {
        parts.push('');
        parts.push('   ══════════════════════════════════════════════════════');
        parts.push(`   ✅ ENCONTRADO: Haz clic en [${exactMatch.ref}] que muestra "${exactMatch.name}"`);
        parts.push(`   📌 ACCIÓN: click [${exactMatch.ref}]`);
        parts.push('   ══════════════════════════════════════════════════════');
      } else {
        // Determine scroll direction based on visible times
        const firstVisibleTime = timeSlotElements[0];
        const firstHour = parseInt((firstVisibleTime?.name || '').match(/(\d{1,2})/)?.[1] || '0');
        const targetHourNum = parseInt(targetHour);

        parts.push('');
        parts.push(`   ⚠️ "${targetHour}:00am" no está visible en esta lista`);

        if (targetHourNum < firstHour) {
          parts.push(`   → El primer horario visible es ${firstHour}:00, pero necesitas ${targetHour}:00`);
          parts.push('   → Haz scroll hacia ARRIBA (direction: "up") para ver horarios más temprano');
          parts.push('   📌 ACCIÓN: scroll con direction: "up"');
        } else {
          parts.push(`   → Haz scroll hacia ABAJO (direction: "down") para ver más horarios`);
          parts.push('   📌 ACCIÓN: scroll con direction: "down"');
        }
      }
    } else if (timeSlotElements.length > 0) {
      parts.push('   📋 Horarios visibles:');
      timeSlotElements.slice(0, 8).forEach(e => {
        parts.push(`      [${e.ref}] "${e.name}"`);
      });
    } else {
      parts.push('   ℹ️ Busca elementos con formato de hora: 7:00, 8:00am, 10:00 AM');
    }

    parts.push('');
  }

  // ========== VISIBLE ELEMENTS ==========
  parts.push(`🔍 VISIBLE ELEMENTS (${elementCount} found):`);
  if (pageChanged) {
    parts.push('   💡 Page changed - these are NEW elements from the current page!');
  }
  if (calendarMightBeOpen) {
    parts.push('   📅 Calendar appears to be open - look for day numbers!');
  }
  if (timeSlotElements.length > 0 && !calendarMightBeOpen) {
    parts.push('   ⏰ Time slots detected - look for time elements!');
  }
  if (elementCount < 10 && !timeSlotElements.length) {
    parts.push('   ⚠️ Few elements detected. Scroll down ONCE to find more content.');
  }
  parts.push(params.snapshot.textRepresentation);
  parts.push('');

  // Credentials status
  if (params.credentials) {
    parts.push('🔐 CREDENTIALS PROVIDED:');
    if (params.credentials.email) parts.push(`   Email: ${params.credentials.email}`);
    if (params.credentials.username) parts.push(`   Username: ${params.credentials.username}`);
    if (params.credentials.password) parts.push(`   Password: [AVAILABLE - use for login]`);
    parts.push('');
  }

  // Form data if any
  if (params.formData && Object.keys(params.formData).length > 0) {
    parts.push('📝 DATA TO USE:');
    for (const [key, value] of Object.entries(params.formData)) {
      parts.push(`   ${key}: ${value}`);
    }
    parts.push('');
  }

  // Action history
  if (params.previousActions.length > 0) {
    parts.push('📜 WHAT YOU ALREADY DID:');
    const recentActions = params.previousActions.slice(-10); // Last 10 actions
    for (let i = 0; i < recentActions.length; i++) {
      const action = recentActions[i];
      const actionNum = params.previousActions.length - recentActions.length + i + 1;
      parts.push(`   ${actionNum}. ${action.action}${action.ref ? ` [${action.ref}]` : ''}${action.value ? `: "${action.value.substring(0, 30)}${action.value.length > 30 ? '...' : ''}"` : ''}`);
    }
    parts.push('');

    // Detect potential loops
    if (params.previousActions.length >= 3) {
      const last3 = params.previousActions.slice(-3);
      const sameAction = last3.every(a => a.action === last3[0].action && a.ref === last3[0].ref);
      if (sameAction) {
        parts.push('⚠️ WARNING: You repeated the same action 3 times. TRY SOMETHING DIFFERENT!');
        parts.push('');
      }
    }

    // Detect excessive clicks on same elements
    const clickActions = params.previousActions.filter(a => a.action === 'click');
    if (clickActions.length >= 5) {
      const refCounts: Record<string, number> = {};
      clickActions.forEach(a => {
        if (a.ref) refCounts[a.ref] = (refCounts[a.ref] || 0) + 1;
      });
      const repeatedRefs = Object.entries(refCounts).filter(([_, count]) => count >= 3);
      if (repeatedRefs.length > 0) {
        parts.push('🚨 STUCK PATTERN DETECTED:');
        repeatedRefs.forEach(([ref, count]) => {
          parts.push(`   - You clicked [${ref}] ${count} times but it\'s not working!`);
        });
        parts.push('   💡 SOLUTIONS:');
        parts.push('   - The button might open a modal/popup that needs time to load - try "wait" action');
        parts.push('   - Try clicking a DIFFERENT element or scroll to find new options');
        parts.push('   - Look for calendar/date elements, time slots, or other interactive content');
        parts.push('   - DO NOT click the same element again!');
        parts.push('');
      }
    }

    // Detect excessive login attempts
    const loginActions = params.previousActions.filter(a => a.action === 'login');
    if (loginActions.length >= 2) {
      parts.push('🚨 CRITICAL WARNING: You have attempted "login" ' + loginActions.length + ' times already.');
      parts.push('   - If the page still shows a login form, the credentials might be wrong or login is failing');
      parts.push('   - DO NOT use "login" action again. Try scrolling, navigating, or clicking other elements');
      parts.push('   - Look for alternative ways to proceed (menu, links, buttons that are NOT login)');
      parts.push('');
    }
  }

  parts.push('---');
  parts.push('Analyze the CURRENT page elements above and decide your next action.');
  parts.push('The element refs (e1, e2, etc.) are from THIS page snapshot - use them correctly.');
  parts.push('Respond with JSON only.');

  return parts.join('\n');
}