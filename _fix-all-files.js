'use strict';
const fs = require('fs');

// Tabla completa de reemplazos para tildes y caracteres especiales
const CHAR_TABLE = [
    // [bytes UTF-8 del mojibake] → [bytes UTF-8 del char correcto]
    // Tildes doble-encoded (Ã¡ = C3 83 C2 A1 → á = C3 A1)
    // Detectamos el patrón C3 83 + siguiente secuencia
];

// Función para reconstruir un char desde su representación mojibake
// El patrón de tildes: cada byte UTF-8 original fue leído como Latin-1 y re-codificado
// á = C3 A1 → leído como Latin-1: Ã ¡ → UTF-8: C3 83 C2 A1
// é = C3 A9 → leído como Latin-1: Ã © → UTF-8: C3 83 C2 A9
// etc.

function fixBuffer(buf) {
    const result = [];
    let i = 0;
    let fixes = 0;
    
    while (i < buf.length) {
        // Patrón de tilde mojibake: C3 83 C2 XX (2-byte UTF-8 char doble-encoded)
        // Donde C3 A1 = á → C3 83 C2 A1
        if (buf[i] === 0xC3 && buf[i+1] === 0x83 && buf[i+2] === 0xC2) {
            const origByte = buf[i+3];
            // El char original era C3 XX donde XX = origByte
            result.push(0xC3, origByte);
            i += 4; fixes++;
            continue;
        }
        
        // Patrón para chars como ñ (C3 B1): C3 83 C2 B1
        // Ya cubierto arriba si origByte = B1
        
        // Patrón Â¿ (¿) = C2 BF → leído como: Â ¿ → C3 82 C2 BF
        if (buf[i] === 0xC3 && buf[i+1] === 0x82 && buf[i+2] === 0xC2) {
            const origByte = buf[i+3];
            result.push(0xC2, origByte);
            i += 4; fixes++;
            continue;
        }

        // Patrón emoji 4-byte: C3 B0 C5 B8 ... (ðŸ...)
        if (buf[i] === 0xC3 && buf[i+1] === 0xB0 && buf[i+2] === 0xC5 && buf[i+3] === 0xB8) {
            // Decodificar byte3 del emoji
            let byte3 = null, byte4 = null, consumed = 4;
            
            const decode2 = (offset) => {
                const b0 = buf[i + consumed + offset];
                const b1 = buf[i + consumed + offset + 1];
                if (b0 === 0xC2 && b1 >= 0x80) return { val: b1, len: 2 };
                if (b0 === 0xC3 && b1 >= 0x80) return { val: b1 + 0x40, len: 2 };
                if (b0 === 0xC5 && b1 === 0xB8) return { val: 0x9F, len: 2 };
                if (b0 === 0xC5 && b1 === 0xA1) return { val: 0x9A, len: 2 };
                if (b0 === 0xC5 && b1 === 0xBD) return { val: 0x8E, len: 2 };
                if (b0 === 0xC6 && b1 === 0x92) return { val: 0x83, len: 2 };
                if (b0 === 0xCB && b1 === 0x86) return { val: 0x88, len: 2 };
                if (b0 === 0xCB && b1 === 0x9C) return { val: 0x98, len: 2 };
                if (b0 === 0xC5 && b1 === 0x8D) return { val: 0x8D, len: 2 };
                if (b0 === 0xE2 && b1 === 0x80) {
                    const b2 = buf[i + consumed + offset + 2];
                    const MAP = {0x98:0x91,0x99:0x92,0x9A:0x9A,0x9B:0x9B,0x9C:0x93,0x9D:0x94,
                                 0x9E:0x9E,0x9F:0x9F,0xA0:0x80,0xA1:0x81,0xA2:0x82,0xA3:0x83,
                                 0xA4:0x84,0xA5:0x85,0xA6:0x86,0xA7:0x87,0xA8:0x88,0xA9:0x89,
                                 0xAA:0x8A,0xAB:0x8B,0xAC:0x8C,0xAD:0x8D,0xAE:0x8E,0xAF:0x8F,
                                 0xB0:0x90,0xB1:0x91,0xB2:0x92,0xB3:0x93,0xB4:0x94,0xB5:0x95,
                                 0xB6:0x96,0xB7:0x97,0xB8:0x98,0xB9:0x99,0xBA:0x9A,0xBB:0x9B,
                                 0xBC:0x9C,0xBD:0x9D,0xBE:0x9E,0xBF:0x9F,
                                 0x20:0x20,0xA0:0x80};
                    return { val: MAP[b2] || b2, len: 3 };
                }
                if (b0 === 0xE2 && b1 === 0x80 + 0x21) { return { val: 0x81, len: 3 }; }
                if (b0 === 0xE2 && b1 === 0xAC) { return { val: 0xAC, len: 3 }; }
                // E2 81 XX (superscript etc)
                if (b0 === 0xE2 && b1 === 0x81) return { val: 0x81, len: 3 };
                if (b0 === 0xE2 && b1 === 0x82) return { val: 0x82, len: 3 };
                if (b0 === 0xE2 && b1 === 0xAD) return { val: 0xAD, len: 3 };
                return null;
            };
            
            const r3 = decode2(0);
            if (r3 !== null) {
                consumed += r3.len;
                byte3 = r3.val;
                const r4 = decode2(0);
                if (r4 !== null) {
                    consumed += r4.len;
                    byte4 = r4.val;
                }
            }
            
            if (byte3 !== null && byte4 !== null) {
                const emojiBytes = Buffer.from([0xF0, 0x9F, byte3, byte4]);
                const emojiStr = emojiBytes.toString('utf8');
                if (!emojiStr.includes('\uFFFD')) {
                    for (const b of emojiBytes) result.push(b);
                    i += consumed; fixes++;
                    continue;
                }
            }
        }
        
        result.push(buf[i++]);
    }
    
    return { buf: Buffer.from(result), fixes };
}

const files = ['auth.js', 'subscription.js', 'currency.js'];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const orig = fs.readFileSync(file);
    const { buf: fixed, fixes } = fixBuffer(orig);
    fs.writeFileSync(file, fixed);
    
    // Verificar resultado
    const check = fixed.toString('utf8');
    const remaining = (check.match(/Ã¡|Ã©|Ã­|Ã³|Ãº|Â¿|Â¡|ðŸ/g)||[]).length;
    console.log(`✅ ${file}: ${fixes} correcciones, ${remaining} mojibake restantes`);
}
