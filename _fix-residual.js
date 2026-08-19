'use strict';
const fs = require('fs');

// auth.js
let a = fs.readFileSync('auth.js', 'utf8');
a = a.replace(/RECUPERACI\u00c3\u201cN DE CONTRASE\u00c3\u2018A/g, 'RECUPERACIÓN DE CONTRASEÑA');
// ðŸ™ˆ → 🙈
const buf99 = Buffer.from([0xF0,0x9F,0x99,0x88]);
a = a.replace('ðŸ™ˆ', buf99.toString('utf8'));
fs.writeFileSync('auth.js', a, 'utf8');
const remA = (a.match(/\u00c3|\u00f0\u0178/g)||[]).length;
console.log('auth.js residual:', remA);

// currency.js
let cur = fs.readFileSync('currency.js', 'utf8');
// FUNCIONES NÚCLEO PÚBLICAS
cur = cur.replace(/FUNCIONES N\u00c3\u0161CLEO P\u00c3\u0161BLICAS/g, 'FUNCIONES NÚCLEO PÚBLICAS');
// ðŸ"Š → 📊
const buf8A = Buffer.from([0xF0,0x9F,0x93,0x8A]);
cur = cur.replace('ðŸ\u201cŠ', buf8A.toString('utf8'));
cur = cur.replace('ðŸ"Š', buf8A.toString('utf8'));
fs.writeFileSync('currency.js', cur, 'utf8');

// Verificación final de todos los archivos
console.log('\n=== VERIFICACIÓN FINAL ===');
const files = ['server.js', 'auth.js', 'subscription.js', 'currency.js', 'admin.html'];
for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const s = fs.readFileSync(f, 'utf8');
    // Buscar cualquier secuencia que empiece con ð seguida de Ÿ (indicador de emoji corrupto)
    const emojiMojibake = (s.match(/ð[\u0100-\u017f]/g)||[]).length;
    // Buscar tildes corrupts: Ã seguido de char de control
    const tildeMojibake = (s.match(/\u00c3[\u0080-\u009f\u0100-\u017f]/g)||[]).length;
    // Buscar Â seguido de punctuation
    const accentMojibake = (s.match(/\u00c2[\u00a0-\u00bf]/g)||[]).length;
    const total = emojiMojibake + tildeMojibake + accentMojibake;
    console.log(`${total === 0 ? '✅' : '❌'} ${f}: emojis=${emojiMojibake} tildes=${tildeMojibake} acentos=${accentMojibake}`);
}
