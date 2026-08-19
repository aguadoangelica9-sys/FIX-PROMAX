/**
 * _fix-encoding.js — Corrige el mojibake en server.js
 * Los caracteres especiales quedaron con doble encoding UTF-8.
 * Este script los reemplaza por los caracteres correctos.
 */
'use strict';
const fs = require('fs');

const FILE = 'server.js';
let src = fs.readFileSync(FILE, 'utf8');
const before = src.length;

// Tabla de reemplazos: mojibake → carácter correcto
const fixes = [
    // Vocales con tilde minúsculas
    [/Ã¡/g, 'á'], [/Ã©/g, 'é'], [/Ã­/g, 'í'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
    // Vocales con tilde mayúsculas
    [/Ã/g, 'Á'],  // debe ir después de las minúsculas para no interferir
    // ñ y Ñ
    [/Ã±/g, 'ñ'], [/Ã'/g, 'Ñ'],
    // ü
    [/Ã¼/g, 'ü'],
    // Caracteres de puntuación y símbolos
    [/â€"/g, '—'], [/â€™/g, "'"], [/â€œ/g, '"'], [/â€/g, '"'],
    [/â€¢/g, '•'], [/Â·/g, '·'], [/Â°/g, '°'], [/Â¿/g, '¿'],
    [/Â¡/g, '¡'], [/Â©/g, '©'], [/Â®/g, '®'],
    // Emojis comunes que se corrompieron
    [/ðŸ"¦/g, '📦'], [/ðŸš€/g, '🚀'], [/ðŸ'Ž/g, '💎'],
    [/ðŸ'µ/g, '💵'], [/ðŸ'³/g, '💳'], [/â™¦/g, '⚡'],
    [/ðŸŸ¡/g, '🟡'], [/ðŸ¦/g, '🏦'], [/ðŸ"±/g, '📱'],
    [/ðŸ…¿ï¸/g, '🅿️'], [/âœ…/g, '✅'], [/â/g, '❌'],
    [/ðŸ'¤/g, '👤'], [/ðŸ¢/g, '🏢'], [/ðŸ"‹/g, '📋'],
    [/ðŸ"§/g, '🔧'], [/ðŸ§¹/g, '🧹'], [/ðŸŽ­/g, '🎭'],
    [/ðŸ"'/g, '🔑'], [/ðŸ""/g, '🔓'], [/ðŸ''/g, '👑'],
    [/â­/g, '⭐'], [/ðŸ"¤/g, '📤'], [/ðŸ"/g, '📁'],
    [/â¡/g, '⚡'], [/ðŸ–¥/g, '🖥️'],
    // Caracteres de caja (box drawing) que se usan en comentarios
    [/â•/g, '═'], [/â"/g, '─'], [/â•—/g, '╗'], [/â•š/g, '╚'],
    [/â•"/g, '╔'], [/â•'/g, '║'],
    // Otros
    [/Ã³/g, 'ó'], [/Ã¨/g, 'è'], [/Ã /g, 'à'],
    // Limpiar Ã solitarios que quedaron (vocales mayúsculas)
    [/ÃÃ¡/g, 'Á'], [/ÃÃ©/g, 'É'], [/ÃÃ­/g, 'Í'], [/ÃÃ³/g, 'Ó'], [/ÃÃº/g, 'Ú'],
];

let totalFixes = 0;
for (const [pattern, replacement] of fixes) {
    const count = (src.match(pattern) || []).length;
    if (count > 0) {
        src = src.replace(pattern, replacement);
        totalFixes += count;
        if (count > 0) console.log(`  ${count}x ${pattern.source} → ${replacement}`);
    }
}

fs.writeFileSync(FILE, src, 'utf8');
console.log(`\n✅ ${totalFixes} correcciones aplicadas en server.js`);
console.log(`   Tamaño: ${before} → ${src.length} bytes`);
