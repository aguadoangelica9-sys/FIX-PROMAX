/**
 * Generador de íconos PNG para FIX PRO MAX PWA
 * Genera PNGs puros usando solo módulos nativos de Node.js (zlib + Buffer)
 * Diseño: fondo degradado índigo, letra ⚡ y texto FIX PRO en blanco
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const ICON_DIR = path.join(__dirname, 'icons');

if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });

// ── PNG encoder puro ──────────────────────────────────────────────────────────
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = makeCRCTable();
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
let _crcTable = null;
function makeCRCTable() {
    if (_crcTable) return _crcTable;
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        _crcTable[n] = c;
    }
    return _crcTable;
}

function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const combined = Buffer.concat([typeBytes, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(combined));
    return Buffer.concat([len, typeBytes, data, crc]);
}

function encodePNG(width, height, pixels) {
    // pixels: Uint8Array de largo width*height*4 (RGBA)
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width,  0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8]  = 8;  // bit depth
    ihdr[9]  = 2;  // color type RGB
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    // Convert RGBA → RGB scan lines with filter byte 0
    const scanlines = Buffer.alloc((1 + width * 3) * height);
    for (let y = 0; y < height; y++) {
        scanlines[y * (1 + width * 3)] = 0; // filter none
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 4;
            const dst = y * (1 + width * 3) + 1 + x * 3;
            scanlines[dst]     = pixels[src];
            scanlines[dst + 1] = pixels[src + 1];
            scanlines[dst + 2] = pixels[src + 2];
        }
    }
    const compressed = zlib.deflateSync(scanlines, { level: 9 });

    return Buffer.concat([
        sig,
        chunk('IHDR', ihdr),
        chunk('IDAT', compressed),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// ── Dibujador ─────────────────────────────────────────────────────────────────
function drawIcon(size) {
    const pixels = new Uint8Array(size * size * 4);

    // Colores del degradado (índigo oscuro → púrpura)
    const C1 = [79, 70, 229];   // #4F46E5 índigo
    const C2 = [124, 58, 237];  // #7C3AED púrpura

    // Paso 1: fondo degradado radial
    const cx = size / 2, cy = size / 2;
    const maxR = size * 0.707;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const dx = x - cx, dy = y - cy;
            const t = Math.min(1, Math.sqrt(dx*dx + dy*dy) / maxR);
            pixels[idx]     = Math.round(C1[0] * (1-t) + C2[0] * t);
            pixels[idx + 1] = Math.round(C1[1] * (1-t) + C2[1] * t);
            pixels[idx + 2] = Math.round(C1[2] * (1-t) + C2[2] * t);
            pixels[idx + 3] = 255;
        }
    }

    // Paso 2: círculo blanco semitransparente de fondo (aro)
    const r1 = size * 0.42, r2 = size * 0.38;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - cx, dy = y - cy;
            const r = Math.sqrt(dx*dx + dy*dy);
            if (r >= r2 && r <= r1) {
                const idx = (y * size + x) * 4;
                const blend = 0.15;
                pixels[idx]     = Math.round(pixels[idx]     * (1-blend) + 255 * blend);
                pixels[idx + 1] = Math.round(pixels[idx + 1] * (1-blend) + 255 * blend);
                pixels[idx + 2] = Math.round(pixels[idx + 2] * (1-blend) + 255 * blend);
            }
        }
    }

    // Paso 3: rayo ⚡ (polígono blanco)
    // Dibujamos el rayo como un conjunto de rectángulos inclinados
    const s = size;
    function setPixel(px, py, alpha) {
        const ix = Math.round(px), iy = Math.round(py);
        if (ix < 0 || iy < 0 || ix >= s || iy >= s) return;
        const idx = (iy * s + ix) * 4;
        const a = alpha / 255;
        pixels[idx]     = Math.round(pixels[idx]     * (1-a) + 255 * a);
        pixels[idx + 1] = Math.round(pixels[idx + 1] * (1-a) + 255 * a);
        pixels[idx + 2] = Math.round(pixels[idx + 2] * (1-a) + 255 * a);
    }

    // Rayo simplificado: línea gruesa diagonal
    const boltPts = [
        // Parte superior del rayo (hacia abajo-izquierda)
        [0.55, 0.15], [0.38, 0.48],
        // Parte media (paso horizontal)
        [0.50, 0.45],
        // Parte inferior (hacia abajo-derecha)
        [0.38, 0.48], [0.45, 0.85],
        // Cierre
        [0.62, 0.52], [0.50, 0.55],
        [0.55, 0.15]
    ].map(([fx, fy]) => [fx * s, fy * s]);

    // Rellenar el polígono del rayo usando scanline
    const minY = Math.min(...boltPts.map(p => p[1]));
    const maxY = Math.max(...boltPts.map(p => p[1]));

    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const intersects = [];
        for (let i = 0; i < boltPts.length - 1; i++) {
            const [x0, y0] = boltPts[i];
            const [x1, y1] = boltPts[i+1];
            if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
                const t = (y - y0) / (y1 - y0);
                intersects.push(x0 + t * (x1 - x0));
            }
        }
        intersects.sort((a,b) => a-b);
        for (let k = 0; k < intersects.length - 1; k += 2) {
            const xStart = Math.floor(intersects[k]);
            const xEnd   = Math.ceil(intersects[k+1]);
            for (let x = xStart; x <= xEnd; x++) {
                setPixel(x, y, 255);
            }
        }
    }

    // Paso 4: borde redondeado (esquinas negras para simular border-radius)
    const borderR = size * 0.18;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Distancia al borde más cercano en esquinas
            const dx = Math.min(x, size-1-x);
            const dy = Math.min(y, size-1-y);
            if (dx < borderR && dy < borderR) {
                const cornerDx = borderR - dx;
                const cornerDy = borderR - dy;
                if (Math.sqrt(cornerDx*cornerDx + cornerDy*cornerDy) > borderR) {
                    const idx = (y * size + x) * 4;
                    pixels[idx] = pixels[idx+1] = pixels[idx+2] = 0;
                    pixels[idx+3] = 0;
                }
            }
        }
    }

    return pixels;
}

// ── Generar todos los tamaños ─────────────────────────────────────────────────
console.log('Generando íconos...');
for (const size of SIZES) {
    const pixels = drawIcon(size);
    const png    = encodePNG(size, size, pixels);
    const output = path.join(ICON_DIR, `icon-${size}.png`);
    fs.writeFileSync(output, png);
    console.log(`  ✅ icon-${size}.png  (${(png.length/1024).toFixed(1)} KB)`);
}

// ── Screenshots placeholder (PNG gris con texto) ─────────────────────────────
function makeScreenshot(w, h, label) {
    const pixels = new Uint8Array(w * h * 4);
    // Fondo oscuro índigo
    for (let i = 0; i < w * h; i++) {
        pixels[i*4]   = 30;
        pixels[i*4+1] = 27;
        pixels[i*4+2] = 75;
        pixels[i*4+3] = 255;
    }
    return encodePNG(w, h, pixels);
}

fs.writeFileSync(path.join(ICON_DIR, 'screenshot-wide.png'),   makeScreenshot(1280, 720, 'wide'));
fs.writeFileSync(path.join(ICON_DIR, 'screenshot-mobile.png'), makeScreenshot(390, 844, 'mobile'));
console.log('  ✅ screenshot-wide.png');
console.log('  ✅ screenshot-mobile.png');
console.log('\n✅ Todos los íconos generados en /icons/');
