'use strict';
const fs   = require('fs');
const path = require('path');

// Tabla directa de todas las secuencias mojibake conocidas → carácter correcto
// Orden: primero los más largos (triple encoding) luego los dobles
const TABLE = [
    // Triple encoding (ÃƒÂ¡ etc)
    ['ÃƒÂ¡','á'],['ÃƒÂ©','é'],['ÃƒÂ­','í'],['ÃƒÂ³','ó'],['ÃƒÂº','ú'],
    ['ÃƒÂ±','ñ'],['ÃƒÂ¼','ü'],
    ['Ãƒ\u201a','Á'],['ÃƒÂ‰','É'],['ÃƒÂ','Í'],['Ãƒ\u201c','Ó'],['Ãƒ\u0161','Ú'],['Ãƒ\u2018','Ñ'],
    // Doble encoding con Á (resultado de corrección parcial)
    ['ÁÂ¡','á'],['ÁÂ©','é'],['ÁÂ­','í'],['ÁÂ³','ó'],['ÁÂº','ú'],
    ['ÁÂ±','ñ'],['ÁÂ¼','ü'],
    ['Á¡','á'],['Á©','é'],['Á­','í'],['Á³','ó'],['Áº','ú'],['Á±','ñ'],['Á¼','ü'],
    // Doble encoding estándar
    ['Ã¡','á'],['Ã©','é'],['Ã­','í'],['Ã³','ó'],['Ãº','ú'],
    ['Ã±','ñ'],['Ã¼','ü'],['Ã‡','Ç'],
    ['Ã','Á'],['Ã‰','É'],['Ã‹','Ë'],['Ã"','Ó'],['Ã›','Ú'],['Ã'','Ñ'],
    // Puntuación
    ['Â·','·'],['Â°','°'],['Â¿','¿'],['Â¡','¡'],['Â©','©'],['Â®','®'],['Â½','½'],
    ['â€"','—'],['â€™',"'"],['â€œ','"'],['â€\u009d','"'],['â€¢','•'],
    // GonzÁ¡lez pattern específico
    ['GonzÁ¡lez','González'],['MarÁÂ­a','María'],['MarÁ­a','María'],
    ['RodrÁÂ­guez','Rodríguez'],['RodrÁ­guez','Rodríguez'],['MartÁÂ­nez','Martínez'],['MartÁ­nez','Martínez'],
    ['MartÁÂ¡nez','Martánez'],['HernÁÂ¡ndez','Hernández'],['SÁÂ¡nchez','Sánchez'],
    ['JimÁÂ©nez','Jiménez'],['PÁÂ©rez','Pérez'],['LÁÂ³pez','López'],
    ['GarcÁÂ­a','García'],['GonzÁÂ¡lez','González'],
    // Patrones generales residuales ÁÂX
    ['ÁÂ¡','á'],['ÁÂ©','é'],['ÁÂ­','í'],['ÁÂ³','ó'],['ÁÂº','ú'],['ÁÂ±','ñ'],
];

function fixStr(s) {
    for (const [bad, good] of TABLE) {
        while (s.includes(bad)) s = s.split(bad).join(good);
    }
    return s;
}

function fixVal(v) {
    if (typeof v === 'string') return fixStr(v);
    if (Array.isArray(v))      return v.map(fixVal);
    if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v)) o[k] = fixVal(v[k]);
        return o;
    }
    return v;
}

const ROOT = __dirname;
const files = fs.readdirSync(ROOT).filter(f =>
    f.endsWith('.json') && !f.startsWith('package') && f !== 'node_modules'
);

let fixed = 0;
for (const file of files) {
    try {
        const raw = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^\uFEFF/, '');
        if (!/Ã|ÁÂ|Á¡|Á©|Á­|GonzÁ|MarÁ|RodrÁ/.test(raw)) continue;
        const data = JSON.parse(raw);
        const out  = fixVal(data);
        fs.writeFileSync(path.join(ROOT, file), JSON.stringify(out, null, 2), 'utf8');
        // Muestra
        const sample = JSON.stringify(out).match(/[áéíóúñüÁÉÍÓÚÑ]/);
        console.log(`✅ ${file}${sample ? ' — ' + sample[0] + ' OK' : ''}`);
        fixed++;
    } catch(e) { console.log(`⚠️  ${file}: ${e.message}`); }
}
console.log(`\n✅ ${fixed} archivos corregidos`);
