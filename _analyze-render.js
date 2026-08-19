'use strict';
const https = require('https');
const fs    = require('fs');

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'Accept-Encoding': 'identity' } }, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                resolve({ body: buf.toString('utf8'), ct: res.headers['content-type'], bytes: buf });
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log('Descargando HTML de Render...');
    const { body, ct, bytes } = await fetch('https://fixpromax-erp.onrender.com/');
    console.log(`Content-Type: ${ct}`);
    console.log(`Tamaño: ${body.length} chars / ${bytes.length} bytes`);

    // Guardar para análisis
    fs.writeFileSync('_render-output.html', bytes);
    console.log('Guardado en _render-output.html');

    // Buscar mojibake
    const bad = ['Ã¡','Ã©','Ã­','Ã³','Ãº','Ã±','Â¿','Â¡','ðŸ','δŸ','ÁÂ'];
    let foundAny = false;
    for (const p of bad) {
        const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const m = body.match(re);
        if (m) {
            const idx = body.indexOf(p);
            const ctx = body.slice(Math.max(0,idx-20), idx+40);
            console.log(`❌ '${p}' ×${m.length} → ...${ctx}...`);
            foundAny = true;
        }
    }

    // Buscar chars correctos
    const good = ['¿Cerrar','sesión','¡Hola','🟢','🟡','ó','á','é','í'];
    for (const p of good) {
        const count = (body.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        console.log(`${count > 0 ? '✅' : '❌'} '${p}' → ${count}`);
    }

    if (!foundAny) console.log('\n✅ Sin mojibake en el HTML servido por Render');
}

main().catch(console.error);
