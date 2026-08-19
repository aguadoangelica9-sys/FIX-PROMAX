'use strict';
const fs = require('fs');

// Tabla de reemplazos: secuencia mojibake exacta → emoji correcto
// Construida analizando los bytes C3 B0 C5 B8 + resto
const TABLE = [
    // Emojis de planes y métodos de pago (los más críticos visualmente)
    ["ðŸ\"¦",  "📦"],   // plan básico
    ["ðŸ\u2019\u017d", "💎"],   // plan semestral (diamond)
    ["ðŸ\u201c\u2039", "📋"],   // clipboard
    ["ðŸ\u2019\u00b5", "💵"],   // billete
    ["ðŸ\u2019\u00b3", "💳"],   // tarjeta
    ["ðŸ\u201c\u00b1", "📱"],   // teléfono
    ["ðŸ\u008f\u00a6", "🏦"],   // banco
    ["ðŸ\u008f\u00a2", "🏢"],   // edificio
    ["ðŸ\u2019\u2018", "👤"],   // persona
    ["ðŸ\u2019\u00a5", "👥"],   // personas
    ["ðŸ\u2018\u2018", "👑"],   // corona  
    ["ðŸ\u201d\u2018", "🔑"],   // llave
    ["ðŸ\u201d\u0090", "📐"],   // regla (puede variar)
    ["ðŸ\u201d\u00b4", "🔴"],   // círculo rojo
    ["ðŸ\u201c\u00a6", "📦"],   // también caja (mismo que plan basic)
    ["ðŸ\u2019\u00b0", "💰"],   // dinero
    ["ðŸ\u2018\u00a4", "👤"],   // persona alt
    ["ðŸ\u2018\u00a5", "👥"],   // personas alt
    ["ðŸ\u008d\u0192", "🏃"],   // corriendo (o similar)
    ["ðŸ\u00a7\u00be", "🧾"],   // recibo
    ["ðŸ\u00b7\u201d", "🏷️"],  // etiqueta
    ["ðŸ\u201c\u201a", "📂"],   // carpeta abierta
    ["ðŸ\u201d\u201d", "📔"],   // libreta
    ["ðŸ\u201d\u009e", "📜"],   // pergamino
    ["ðŸ\u0161\u00a8", "🚨"],   // alerta
    ["ðŸ\u201d\u00b4", "🔴"],   // rojo
    ["ðŸ\u2020\u201d", "🆓"],   // free
    ["ðŸ\u2019\u00b8", "💸"],   // dinero volando
    ["ðŸ\u017d\u00ab", "🎫"],   // ticket
    ["ðŸ\u201c\u00a6", "📦"],   // caja 
];

// Estrategia alternativa: reemplazar a nivel de BYTES
// Los bytes del mojibake para emoji 4-byte son siempre:
// [C3 B0] [C5 B8] [XX YY] [XX YY] donde los últimos 4 bytes son los bytes 2,3,4 del emoji + prefijo
// 
// La forma más confiable: buscar el patrón de bytes C3 B0 C5 B8 en el buffer
// y reconstruir el emoji original a partir de los bytes siguientes

const rawBuf = fs.readFileSync('server.js');
let fixedBuf = Buffer.from(rawBuf);

// Buscar el patrón C3 B0 C5 B8 (= "ðŸ" en UTF-8) y reconstruir el emoji
// El emoji original F0 9F XX YY se convirtió en:
//   F0 → C3 B0 (ð en latin1)
//   9F → C5 B8 (Ÿ con tilde en latin1, pero esto depende de la codepage)
//
// En realidad el patrón es:
// Byte F0 en latin1 → UTF-8: C3 B0
// Byte 9F en Windows-1252 → U+0178 → UTF-8: C5 B8  
// Byte XX en latin1 → depende del valor
//   80-BF → C2 XX (para bytes sin char especial en Windows-1252)
//   Para los bytes 80-9F Windows-1252 tiene chars especiales
//
// Vamos a hacer el reemplazo directo byte a byte

let pos = 0;
const result = [];
let replacements = 0;

while (pos < fixedBuf.length) {
    // Detectar el patrón: C3 B0 (= ð) seguido de C5 B8 (= Ÿ/0x178)
    if (fixedBuf[pos] === 0xC3 && fixedBuf[pos+1] === 0xB0 &&
        fixedBuf[pos+2] === 0xC5 && fixedBuf[pos+3] === 0xB8) {
        
        // Tenemos el inicio de un emoji mojibake
        // Los próximos bytes son la codificación UTF-8 de los bytes 3 y 4 del emoji original
        // Necesitamos decodificar esos bytes
        
        // Byte 3 del emoji (2do byte del sufijo, después de F0 9F)
        // En el mojibake, cada byte original XX del rango 80-BF se convierte en C2 XX
        // Los bytes del rango C0-FF se convierten en C3 (XX-40)
        // Los bytes del rango 80-9F (Windows-1252) tienen conversiones especiales
        
        // Decodificar el tercer byte del emoji original
        let byte3, byte4, consumed;
        
        // Leer los siguientes bytes UTF-8
        const remaining = fixedBuf.slice(pos + 4);
        let offset = 0;
        
        // Decodificar primer char (byte3)
        if (remaining[offset] === 0xC2 && remaining[offset+1] >= 0x80) {
            byte3 = remaining[offset+1];
            offset += 2;
        } else if (remaining[offset] === 0xC3 && remaining[offset+1] >= 0x80) {
            byte3 = remaining[offset+1] + 0x40;
            offset += 2;
        } else if (remaining[offset] === 0xE2 && remaining[offset+1] === 0x80) {
            // Rango especial Windows-1252 (bytes 80-9F)
            const third = remaining[offset+2];
            const WIN1252_MAP = {
                0x9A: 0x9A, 0x9C: 0x93, 0x9D: 0x94, 0x9E: 0x9E, 0x9F: 0x9F,
                0xA0: 0x80, 0xA1: 0x81, 0xA2: 0x82, 0xA3: 0x83, 0xA4: 0x84,
                0xA5: 0x85, 0xA6: 0x86, 0xA7: 0x87, 0xA8: 0x88, 0xA9: 0x89,
                0xAA: 0x8A, 0xAC: 0x8C, 0xB0: 0x90, 0xB1: 0x91, 0xB2: 0x92,
                0xB3: 0x93, 0xB4: 0x94, 0xB5: 0x95, 0xB6: 0x96, 0xB7: 0x97,
                0xB8: 0x98, 0xB9: 0x99, 0xBA: 0x9A, 0xBC: 0x9C, 0xBD: 0x9D,
                0xBE: 0x9E, 0xBF: 0x9F,
                // E2 80 98 = ' (left single quote) = byte 91 en Win1252
                0x98: 0x91, 0x99: 0x92, 0x9B: 0x9B,
                // E2 80 9C = " = byte 93
                0x9C: 0x93,
                // E2 80 9D = " = byte 94
            };
            // Mapear E2 80 XX a byte Windows-1252
            if (third === 0x98) byte3 = 0x91;  // '
            else if (third === 0x99) byte3 = 0x92;  // '
            else if (third === 0x9C) byte3 = 0x93;  // "
            else if (third === 0x9D) byte3 = 0x94;  // "
            else if (third === 0xA0) byte3 = 0x80;  // €
            else if (third === 0xA1) byte3 = 0x81;
            else if (third === 0xA2) byte3 = 0x82;  // ‚
            else if (third === 0xA3) byte3 = 0x83;  // ƒ
            else if (third === 0xA4) byte3 = 0x84;  // „
            else if (third === 0xA5) byte3 = 0x85;  // …
            else if (third === 0xA6) byte3 = 0x86;  // †
            else if (third === 0xA7) byte3 = 0x87;  // ‡
            else if (third === 0xA8) byte3 = 0x88;  // ˆ
            else if (third === 0xA9) byte3 = 0x89;  // ‰
            else if (third === 0xAA) byte3 = 0x8A;
            else if (third === 0xAC) byte3 = 0x8C;
            else if (third === 0xAE) byte3 = 0x8E;
            else if (third === 0xB0) byte3 = 0x90;
            else if (third === 0xB1) byte3 = 0x91;
            else if (third === 0xB2) byte3 = 0x92;
            else if (third === 0xB3) byte3 = 0x93;  // "
            else if (third === 0xB4) byte3 = 0x94;  // "
            else if (third === 0xB5) byte3 = 0x95;  // •
            else if (third === 0xB6) byte3 = 0x96;  // –
            else if (third === 0xB7) byte3 = 0x97;  // —
            else if (third === 0xB8) byte3 = 0x98;  // ˜
            else if (third === 0xB9) byte3 = 0x99;  // ™
            else if (third === 0xBA) byte3 = 0x9A;
            else if (third === 0xBC) byte3 = 0x9C;
            else if (third === 0xBD) byte3 = 0x9D;
            else if (third === 0xBE) byte3 = 0x9E;
            else if (third === 0xBF) byte3 = 0x9F;
            else byte3 = third;
            offset += 3;
        } else if (remaining[offset] === 0xC5 && remaining[offset+1] === 0xA1) {
            byte3 = 0x9A; // š
            offset += 2;
        } else if (remaining[offset] === 0xC5 && remaining[offset+1] === 0xBD) {
            byte3 = 0x8E; // Ž
            offset += 2;
        } else if (remaining[offset] === 0xC5 && remaining[offset+1] === 0xB8) {
            byte3 = 0x9F; // Ÿ
            offset += 2;
        } else if (remaining[offset] === 0xC6 && remaining[offset+1] === 0x92) {
            byte3 = 0x83; // ƒ
            offset += 2;
        } else if (remaining[offset] === 0xCB && remaining[offset+1] === 0x86) {
            byte3 = 0x88; // ˆ
            offset += 2;
        } else if (remaining[offset] === 0xCB && remaining[offset+1] === 0x9C) {
            byte3 = 0x98; // ˜
            offset += 2;
        } else {
            // No reconocido, saltar
            result.push(fixedBuf[pos]);
            pos++;
            continue;
        }
        
        // Decodificar segundo char (byte4)
        if (remaining[offset] === 0xC2 && remaining[offset+1] >= 0x80) {
            byte4 = remaining[offset+1];
            offset += 2;
        } else if (remaining[offset] === 0xC3 && remaining[offset+1] >= 0x80) {
            byte4 = remaining[offset+1] + 0x40;
            offset += 2;
        } else if (remaining[offset] === 0xE2 && remaining[offset+1] === 0x80) {
            const third = remaining[offset+2];
            if (third === 0x98) byte4 = 0x91;
            else if (third === 0x99) byte4 = 0x92;
            else if (third === 0x9C) byte4 = 0x93;
            else if (third === 0x9D) byte4 = 0x94;
            else if (third === 0xA0) byte4 = 0x80;
            else if (third === 0xA2) byte4 = 0x82;
            else if (third === 0xA6) byte4 = 0x86;
            else if (third === 0xA9) byte4 = 0x89;
            else if (third === 0xB9) byte4 = 0x99;
            else if (third === 0xB0) byte4 = 0x90;
            else byte4 = third;
            offset += 3;
        } else if (remaining[offset] === 0xC5 && remaining[offset+1] === 0xBD) {
            byte4 = 0x8E; offset += 2;
        } else if (remaining[offset] === 0xC5 && remaining[offset+1] === 0xA1) {
            byte4 = 0x9A; offset += 2;
        } else {
            result.push(fixedBuf[pos]);
            pos++;
            continue;
        }
        
        // Reconstruir el emoji: F0 9F byte3 byte4
        const emojiBytes = Buffer.from([0xF0, 0x9F, byte3, byte4]);
        const emojiStr = emojiBytes.toString('utf8');
        
        // Verificar que es un emoji válido (no replacement char)
        if (!emojiStr.includes('\uFFFD')) {
            for (const b of emojiBytes) result.push(b);
            replacements++;
            pos += 4 + offset;
            // Log
            process.stdout.write(`✅ bytes[${pos}] → ${emojiStr} (F0 9F ${byte3.toString(16)} ${byte4.toString(16)})\n`);
        } else {
            result.push(fixedBuf[pos]);
            pos++;
        }
    } else {
        result.push(fixedBuf[pos]);
        pos++;
    }
}

const newBuf = Buffer.from(result);
fs.writeFileSync('server.js', newBuf);
console.log(`\n✅ ${replacements} emojis reconstruidos en server.js`);
console.log(`Tamaño: ${rawBuf.length} → ${newBuf.length} bytes`);

// Verificar
const check = fs.readFileSync('server.js', 'utf8');
const remaining = (check.match(/ðŸ/g) || []).length;
console.log(`Mojibake 'ðŸ' restantes: ${remaining}`);
