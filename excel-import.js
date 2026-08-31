/**
 * FIX PRO MAX — Módulo de Importación de Inventario desde Excel
 * excel-import.js — Módulo independiente. NO modifica ninguna función existente.
 *
 * Requiere: SheetJS (XLSX) cargado antes de este script.
 * Se integra con: data, persist(), generateId(), showToast(), renderAll(),
 *                 generateAlerts(), navigateTo()
 *
 * Funciones expuestas al window:
 *   openExcelImportModal, openImportHistoryModal, downloadImportTemplate
 *   handleFileSelect, executeImport (compatibilidad con código existente)
 */
(function ExcelImportModule() {
    'use strict';

    /* ══════════════════════════════════════════════════════════════
       ESTADO DEL MÓDULO
       ══════════════════════════════════════════════════════════════ */
    let _state = {
        step: 1,
        file: null,
        workbook: null,
        selectedSheet: null,
        headers: [],
        rawRows: [],
        mapping: {},
        stockMode: 'replace',      // 'replace' | 'add'
        duplicateMode: 'update',   // 'update' | 'create' | 'ignore'
        validated: [],
        errors: [],
        duplicatesInFile: [],
        importId: null,
        snapshotIds: []            // IDs de productos creados en esta importación (para deshacer)
    };

    /* ══════════════════════════════════════════════════════════════
       DICCIONARIO DE MAPEO AUTOMÁTICO (ampliado)
       ══════════════════════════════════════════════════════════════ */
    const FIELD_MAP = {
        // Nombre
        'nombre': 'name', 'producto': 'name', 'item': 'name',
        'articulo': 'name', 'artículo': 'name', 'nombre del producto': 'name',
        'descripcion del articulo': 'name', 'descripción del artículo': 'name',
        // SKU / Código
        'sku': 'sku', 'codigo': 'sku', 'código': 'sku',
        'codigo de producto': 'sku', 'código de producto': 'sku',
        'clave': 'sku', 'referencia': 'sku', 'ref': 'sku',
        // Código de barras
        'codigo de barras': 'barcode', 'código de barras': 'barcode',
        'barcode': 'barcode', 'ean': 'barcode', 'upc': 'barcode', 'gtin': 'barcode',
        // Código interno
        'codigo interno': 'internalCode', 'código interno': 'internalCode',
        'internal code': 'internalCode', 'cod interno': 'internalCode',
        // Descripción
        'descripcion': 'description', 'descripción': 'description',
        'detalle': 'description', 'obs': 'description', 'observacion': 'description',
        // Marca
        'marca': 'brand', 'brand': 'brand', 'fabricante': 'brand',
        'modelo': 'brand',
        // Categoría
        'categoria': 'category', 'categoría': 'category',
        'familia': 'category', 'tipo': 'category', 'grupo': 'category',
        'linea': 'category', 'línea': 'category',
        // Subcategoría
        'subcategoria': 'subcategory', 'subcategoría': 'subcategory',
        'subfamilia': 'subcategory',
        // Proveedor
        'proveedor': 'supplier', 'supplier': 'supplier',
        'vendedor': 'supplier', 'distribuidor': 'supplier',
        // Costo
        'costo': 'cost', 'precio costo': 'cost', 'precio de costo': 'cost',
        'costo unitario': 'cost', 'precio compra': 'cost', 'precio de compra': 'cost',
        'cost': 'cost',
        // Precio de venta
        'precio': 'price', 'precio venta': 'price', 'precio de venta': 'price',
        'pvp': 'price', 'precio publico': 'price', 'precio público': 'price',
        'valor': 'price', 'price': 'price', 'precio minorista': 'price',
        // Precio mayorista
        'precio mayorista': 'wholesalePrice', 'mayorista': 'wholesalePrice',
        'precio por mayor': 'wholesalePrice', 'wholesale': 'wholesalePrice',
        // Stock / Cantidad
        'stock': 'stock', 'existencia': 'stock', 'existencias': 'stock',
        'inventario': 'stock', 'cantidad': 'stock', 'qty': 'stock',
        'unidades': 'stock', 'disponible': 'stock', 'saldo': 'stock',
        // Stock mínimo
        'stock minimo': 'minStock', 'stock mínimo': 'minStock',
        'minimo': 'minStock', 'mínimo': 'minStock', 'min stock': 'minStock',
        'punto de reorden': 'minStock',
        // Stock máximo
        'stock maximo': 'maxStock', 'stock máximo': 'maxStock',
        'maximo': 'maxStock', 'máximo': 'maxStock', 'max stock': 'maxStock',
        // Impuesto
        'impuesto': 'tax', 'iva': 'tax', 'tax': 'tax', 'iva %': 'tax',
        'porcentaje iva': 'tax', '% iva': 'tax',
        // Unidad
        'unidad': 'unit', 'unidad de medida': 'unit', 'um': 'unit',
        'uom': 'unit', 'medida': 'unit',
        // Almacén
        'almacen': 'warehouse', 'almacén': 'warehouse', 'bodega': 'warehouse',
        'deposito': 'warehouse', 'depósito': 'warehouse', 'warehouse': 'warehouse',
        // Ubicación
        'ubicacion': 'location', 'ubicación': 'location', 'pasillo': 'location',
        'estante': 'location', 'posicion': 'location', 'posición': 'location',
        // Lote
        'lote': 'lot', 'batch': 'lot', 'numero lote': 'lot', 'número lote': 'lot',
        // Fecha vencimiento
        'vencimiento': 'expiryDate', 'fecha vencimiento': 'expiryDate',
        'expiry': 'expiryDate', 'vence': 'expiryDate', 'caducidad': 'expiryDate',
        'fecha caducidad': 'expiryDate',
        // Serial
        'serial': 'serialNumber', 'numero serie': 'serialNumber',
        'número serie': 'serialNumber', 'serie': 'serialNumber', 'ns': 'serialNumber',
        // Estado
        'estado': 'status', 'estatus': 'status', 'activo': 'status',
        // Notas
        'notas': 'notes', 'nota': 'notes', 'comentario': 'notes',
        'observaciones': 'notes',
        // URL imagen
        'imagen': 'image', 'url imagen': 'image', 'foto': 'image',
        'image': 'image', 'image url': 'image', 'url foto': 'image',
        // Descuento
        'descuento': 'discount', 'dto': 'discount', 'discount': 'discount',
        // Utilidad / Ganancia
        'utilidad':         'profit',
        'ganancia':         'profit',
        'profit':           'profit',
        'margen':           'profit',
        'utilidad unitaria':'profit',
        'ganancia unitaria':'profit',
        'utilidad por unidad':'profit',
        // ── Moneda (VES/EUR) ──
        'moneda':          'currency',
        'divisa':          'currency',
        'currency':        'currency',
        'codigo moneda':   'currency',
        'código moneda':   'currency',
        'cod moneda':      'currency',
        'tipo moneda':     'currency',
        'tipo de moneda':  'currency',
        'curr':            'currency',
    };

    /* ══════════════════════════════════════════════════════════════
       OPCIONES DE CAMPOS PARA EL UI DE MAPEO
       ══════════════════════════════════════════════════════════════ */
    const FIELD_OPTIONS = [
        { value: 'ignore',        label: '— Ignorar —' },
        { value: 'name',          label: 'Nombre del producto *' },
        { value: 'sku',           label: 'SKU / Código *' },
        { value: 'barcode',       label: 'Código de barras' },
        { value: 'internalCode',  label: 'Código interno' },
        { value: 'brand',         label: 'Marca' },
        { value: 'category',      label: 'Categoría' },
        { value: 'subcategory',   label: 'Subcategoría' },
        { value: 'supplier',      label: 'Proveedor' },
        { value: 'description',   label: 'Descripción' },
        { value: 'cost',          label: 'Precio de costo' },
        { value: 'price',         label: 'Precio de venta *' },
        { value: 'wholesalePrice', label: 'Precio mayorista' },
        { value: 'currency',      label: '💱 Moneda (VES/EUR)' },
        { value: 'tax',           label: 'Impuesto (%)' },
        { value: 'stock',         label: 'Stock / Cantidad' },
        { value: 'minStock',      label: 'Stock mínimo' },
        { value: 'maxStock',      label: 'Stock máximo' },
        { value: 'unit',          label: 'Unidad de medida' },
        { value: 'warehouse',     label: 'Almacén' },
        { value: 'location',      label: 'Ubicación' },
        { value: 'lot',           label: 'Lote' },
        { value: 'expiryDate',    label: 'Fecha de vencimiento' },
        { value: 'serialNumber',  label: 'Número de serie' },
        { value: 'status',        label: 'Estado' },
        { value: 'image',         label: 'URL de imagen' },
        { value: 'discount',      label: 'Descuento (%)' },
        { value: 'profit',        label: '💰 Utilidad / Ganancia' },
        { value: 'notes',         label: 'Notas' },
    ];

    /* ══════════════════════════════════════════════════════════════
       HELPERS DE PARSING
       ══════════════════════════════════════════════════════════════ */

    /**
     * Limpia y parsea un valor numérico de celda.
     * Maneja: "$10.50", "USD 10.50", "1,000.50", "1.000,50", "25 unidades"
     */
    function _parseNumber(raw) {
        if (raw === null || raw === undefined || raw === '') return null;
        let s = String(raw).trim();
        // Quitar símbolos de moneda y texto no numérico al inicio/fin
        s = s.replace(/^[^0-9\-\+]+/, '').replace(/[^0-9\.\,\-]+$/, '');
        // Detectar formato europeo (1.000,50) vs americano (1,000.50)
        const commaPos = s.lastIndexOf(',');
        const dotPos   = s.lastIndexOf('.');
        if (commaPos > dotPos) {
            // Formato europeo: coma es decimal
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            // Formato americano o sin separador de miles
            s = s.replace(/,/g, '');
        }
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
    }

    /** Normaliza texto quitando tildes y pasando a minúsculas */
    function _norm(str) {
        return String(str || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }

    /** Busca categoría por nombre (crea si no existe) */
    function _resolveCategory(name) {
        if (!name) return null;
        const n = _norm(name);
        let cat = data.categories.find(c => _norm(c.name) === n);
        if (!cat) {
            cat = { id: generateId(), name: String(name).trim() };
            data.categories.push(cat);
        }
        return cat.id;
    }

    /** Busca proveedor por nombre (crea si no existe) */
    function _resolveSupplier(name) {
        if (!name) return null;
        const n = _norm(name);
        let s = data.suppliers.find(x => _norm(x.name) === n);
        if (!s) {
            s = { id: generateId(), name: String(name).trim(), email: '', phone: '', balance: 0 };
            data.suppliers.push(s);
        }
        return s.id;
    }

    /** Busca almacén por nombre */
    function _resolveWarehouse(name) {
        if (!name) return data.warehouses[0]?.id || null;
        const n = _norm(name);
        const w = data.warehouses.find(x => _norm(x.name) === n);
        return w ? w.id : (data.warehouses[0]?.id || null);
    }

    /**
     * Normaliza un código de moneda desde Excel.
     * Acepta: USD, $, dolar, dollar → 'USD'
     *         VES, BS, BS., bolivar  → 'VES'
     *         EUR, €, euro           → 'EUR'
     * Fallback: USD (moneda base del sistema).
     */
    function _resolveCurrency(raw) {
        if (!raw) return 'USD';
        const s = String(raw).trim().toUpperCase();
        if (s === 'USD' || s === '$' || s === 'DOLAR' || s === 'DÓLAR' || s === 'DOLLAR' || s === 'DOLARES' || s === 'DÓLARES') return 'USD';
        if (s === 'VES' || s === 'BS' || s === 'BS.' || s === 'BOLIVAR' || s === 'BOLÍVAR' || s === 'BOLIVARES' || s === 'BOLÍVARES') return 'VES';
        if (s === 'EUR' || s === '€'  || s === 'EURO' || s === 'EUROS') return 'EUR';
        // Fallback: USD (moneda base del sistema)
        return 'USD';
    }

    /* ══════════════════════════════════════════════════════════════
       MAPEO AUTOMÁTICO DE COLUMNAS
       ══════════════════════════════════════════════════════════════ */
    function _autoMap(headers) {
        const mapping = {};
        headers.forEach(h => {
            const n = _norm(h);
            let matched = false;

            // 1. Coincidencia exacta (máxima prioridad)
            if (FIELD_MAP[n]) {
                mapping[h] = FIELD_MAP[n];
                matched = true;
            }
            // 2. El header contiene la clave como subcadena exacta
            if (!matched) {
                for (const key of Object.keys(FIELD_MAP)) {
                    if (n.includes(key)) {
                        mapping[h] = FIELD_MAP[key];
                        matched = true;
                        break;
                    }
                }
            }
            // 3. La clave contiene el header (solo si header >= 4 chars para evitar falsos)
            if (!matched && n.length >= 4) {
                for (const key of Object.keys(FIELD_MAP)) {
                    if (key.includes(n)) {
                        mapping[h] = FIELD_MAP[key];
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) mapping[h] = 'ignore';
        });
        return mapping;
    }

    /* ══════════════════════════════════════════════════════════════
       VALIDACIÓN DE FILAS
       ══════════════════════════════════════════════════════════════ */
    function _validateRows(rawRows, headers, mapping) {
        const valid   = [];
        const errors  = [];
        const seenSku = new Set();

        // Detectar índice de columna de nombre (incluyendo columnas sin encabezado con texto)
        let nameColIdx = -1;
        const mappedToName = headers.findIndex(h => mapping[h] === 'name');
        if (mappedToName >= 0) {
            nameColIdx = mappedToName;
        } else {
            // Buscar primera columna con texto no numérico en las primeras filas
            for (let i = 0; i < headers.length; i++) {
                const samples = rawRows.slice(0, 5).map(r => String(r[i] ?? '').trim()).filter(v => v);
                if (samples.some(v => isNaN(parseFloat(v)))) { nameColIdx = i; break; }
            }
        }

        rawRows.forEach((row, idx) => {
            const rowNum = idx + 2;
            const obj    = {};
            const errs   = [];

            // Mapear valores de columnas reconocidas
            headers.forEach((h, i) => {
                const field = mapping[h];
                if (!field || field === 'ignore') return;
                let val = (row[i] !== undefined && row[i] !== null) ? String(row[i]).trim() : '';
                if (['cost','price','wholesalePrice','tax','stock',
                     'minStock','maxStock','discount','profit'].includes(field)) {
                    val = _parseNumber(val);
                } else if (field === 'expiryDate' && val) {
                    const d = new Date(val);
                    val = isNaN(d.getTime()) ? val : d.toISOString().slice(0, 10);
                }
                obj[field] = val;
            });

            // Fallback nombre: usar columna sin encabezado si no se mapeó ninguna a 'name'
            if (!obj.name && nameColIdx >= 0) {
                obj.name = String(row[nameColIdx] ?? '').trim();
            }

            // Ignorar filas que son totales o completamente vacías
            if (!obj.name || /^total/i.test(obj.name.trim())) return;

            // SKU: es opcional — si no viene, se auto-genera al importar
            if (!obj.sku) obj._autoSku = true;

            // Si precio vacío pero hay costo, usar costo
            if ((obj.price === null || obj.price === undefined) && obj.cost != null && obj.cost >= 0) {
                obj.price = obj.cost;
            }

            // ── Validaciones ──
            if (!obj.name || obj.name === '') errs.push('Falta nombre');
            if (obj.price !== null && obj.price !== undefined && !isNaN(obj.price) && obj.price < 0)
                errs.push('Precio negativo');
            if (obj.cost  !== null && obj.cost  !== undefined && !isNaN(obj.cost)  && obj.cost  < 0)
                errs.push('Costo negativo');
            if (obj.stock !== null && obj.stock !== undefined && !isNaN(obj.stock) && obj.stock < 0)
                errs.push('Stock negativo');

            // Duplicado en el mismo archivo (por SKU, si existe)
            if (obj.sku && seenSku.has(String(obj.sku).toLowerCase())) {
                errs.push('SKU duplicado en el archivo');
            } else if (obj.sku) {
                seenSku.add(String(obj.sku).toLowerCase());
            }

            if (errs.length > 0) {
                errors.push({ row: rowNum, fields: errs.join(', '), data: obj });
            } else {
                // Buscar si ya existe en la base de datos por SKU o por nombre
                const existingProduct = obj.sku
                    ? data.products.find(p => p.sku && _norm(p.sku) === _norm(obj.sku))
                    : data.products.find(p => p.name && _norm(p.name) === _norm(obj.name));
                if (existingProduct) {
                    obj._action       = 'duplicate';
                    obj._existingId   = existingProduct.id;
                    obj._existingName = existingProduct.name;
                } else {
                    obj._action = 'new';
                }
                obj._row = rowNum;
                valid.push(obj);
            }
        });

        return { valid, errors };
    }

    /* ══════════════════════════════════════════════════════════════
       CSS DEL MÓDULO (inyectado una sola vez)
       ══════════════════════════════════════════════════════════════ */
    function _injectStyles() {
        if (document.getElementById('excel-import-styles')) return;
        const style = document.createElement('style');
        style.id = 'excel-import-styles';
        style.textContent = `
        /* ── Modal de importación ── */
        #eiModal { display:none; position:fixed; inset:0; z-index:9990;
            background:rgba(0,0,0,.65); align-items:center; justify-content:center;
            padding:12px; overflow-y:auto; }
        #eiModal.open { display:flex; }
        #eiBox { background:var(--surface, #1e293b); border:1px solid var(--border, #334155);
            border-radius:14px; width:100%; max-width:760px; max-height:92vh;
            overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.5);
            display:flex; flex-direction:column; }
        #eiHeader { display:flex; justify-content:space-between; align-items:center;
            padding:18px 22px; border-bottom:1px solid var(--border,#334155); flex-shrink:0; }
        #eiHeader h2 { font-size:16px; font-weight:700; color:var(--text,#f1f5f9); margin:0; }
        #eiBody { padding:20px 22px; flex:1; overflow-y:auto; }
        #eiFooter { display:flex; justify-content:flex-end; gap:10px;
            padding:14px 22px; border-top:1px solid var(--border,#334155); flex-shrink:0; flex-wrap:wrap; }
        /* Pasos */
        .ei-steps { display:flex; gap:0; margin-bottom:22px; }
        .ei-step-ind { flex:1; text-align:center; font-size:11px; font-weight:600;
            padding:8px 4px; border-bottom:2px solid var(--border,#334155);
            color:var(--text-3,#94a3b8); transition:.2s; }
        .ei-step-ind.active { border-color:var(--primary,#4f46e5); color:var(--primary,#4f46e5); }
        .ei-step-ind.done { border-color:var(--success,#10b981); color:var(--success,#10b981); }
        /* Drop zone */
        .ei-drop { border:2px dashed var(--border,#334155); border-radius:12px;
            padding:36px; text-align:center; cursor:pointer;
            transition:.2s; color:var(--text-2,#94a3b8); }
        .ei-drop:hover, .ei-drop.over { border-color:var(--primary,#4f46e5);
            background:var(--primary-light,#1e1b4b); }
        .ei-drop .ei-drop-icon { font-size:40px; margin-bottom:10px; }
        .ei-drop .ei-drop-title { font-size:15px; font-weight:600; color:var(--text,#f1f5f9); }
        .ei-drop .ei-drop-sub { font-size:12px; margin-top:4px; }
        /* File info */
        .ei-file-info { background:var(--surface-2,#263348); border-radius:10px;
            padding:14px 16px; margin-top:14px; display:none; }
        .ei-file-info.visible { display:flex; gap:16px; flex-wrap:wrap; align-items:center; }
        .ei-file-info .ei-fi-name { font-weight:700; font-size:14px; color:var(--text,#f1f5f9); }
        .ei-file-info .ei-fi-meta { font-size:12px; color:var(--text-2,#94a3b8); }
        /* Hojas */
        .ei-sheets { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
        .ei-sheet-btn { padding:7px 14px; border-radius:8px; border:1px solid var(--border,#334155);
            background:var(--surface-2,#263348); color:var(--text-2,#94a3b8);
            font-size:13px; cursor:pointer; transition:.15s; }
        .ei-sheet-btn.active { background:var(--primary,#4f46e5); color:#fff; border-color:var(--primary,#4f46e5); }
        /* Mapeo */
        .ei-map-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; }
        .ei-map-row { display:flex; align-items:center; gap:8px; background:var(--surface-2,#263348);
            border-radius:8px; padding:8px 12px; }
        .ei-map-label { flex:1; font-size:13px; color:var(--text,#f1f5f9); font-weight:500; overflow:hidden;
            text-overflow:ellipsis; white-space:nowrap; min-width:0; }
        .ei-map-arrow { color:var(--text-3,#475569); font-size:16px; flex-shrink:0; }
        .ei-map-sel { flex:1.2; min-width:0; padding:6px 10px; border-radius:6px;
            border:1px solid var(--border,#334155); background:var(--bg,#0f172a);
            color:var(--text,#f1f5f9); font-size:12px; outline:none; }
        `;
        document.head.appendChild(style);
    }

    function _injectStyles2() {
        if (document.getElementById('excel-import-styles2')) return;
        const style = document.createElement('style');
        style.id = 'excel-import-styles2';
        style.textContent = `
        /* Opciones de importación */
        .ei-options { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; }
        .ei-option-group label { display:block; font-size:12px; font-weight:600;
            color:var(--text-2,#94a3b8); margin-bottom:6px; }
        .ei-option-group select { width:100%; padding:8px 12px; border-radius:8px;
            border:1px solid var(--border,#334155); background:var(--bg,#0f172a);
            color:var(--text,#f1f5f9); font-size:13px; outline:none; }
        /* Resumen de validación */
        .ei-summary { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
        .ei-stat { flex:1; min-width:80px; background:var(--surface-2,#263348);
            border-radius:10px; padding:12px; text-align:center; }
        .ei-stat .ei-st-num { font-size:24px; font-weight:800; }
        .ei-stat .ei-st-lbl { font-size:11px; color:var(--text-2,#94a3b8); margin-top:3px; }
        .ei-stat.ok .ei-st-num { color:var(--success,#10b981); }
        .ei-stat.warn .ei-st-num { color:var(--warning,#f59e0b); }
        .ei-stat.err .ei-st-num { color:var(--danger,#ef4444); }
        .ei-stat.info .ei-st-num { color:var(--primary,#4f46e5); }
        /* Tabla de previsualización */
        .ei-preview-wrap { overflow-x:auto; max-height:280px; overflow-y:auto;
            border:1px solid var(--border,#334155); border-radius:8px; margin-top:10px; }
        .ei-preview-wrap table { width:100%; border-collapse:collapse; font-size:12px; }
        .ei-preview-wrap thead th { background:var(--surface-2,#263348); padding:8px 10px;
            text-align:left; font-weight:600; color:var(--text-2,#94a3b8); white-space:nowrap;
            position:sticky; top:0; }
        .ei-preview-wrap tbody td { padding:7px 10px; border-bottom:1px solid var(--border,#334155);
            color:var(--text,#f1f5f9); white-space:nowrap; max-width:160px;
            overflow:hidden; text-overflow:ellipsis; }
        .ei-preview-wrap tbody tr.err-row td { background:rgba(239,68,68,.08); }
        .ei-preview-wrap tbody tr.dup-row td { background:rgba(245,158,11,.08); }
        .ei-preview-wrap tbody tr.new-row td { background:rgba(16,185,129,.04); }
        /* Badge de estado en preview */
        .ei-badge { display:inline-block; padding:2px 8px; border-radius:20px;
            font-size:10px; font-weight:700; }
        .ei-badge-new  { background:rgba(16,185,129,.2); color:#6ee7b7; }
        .ei-badge-dup  { background:rgba(245,158,11,.2); color:#fcd34d; }
        .ei-badge-err  { background:rgba(239,68,68,.2);  color:#fca5a5; }
        /* Tabla de errores */
        .ei-err-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
        .ei-err-table th { text-align:left; padding:7px 10px; font-size:11px;
            color:var(--text-2,#94a3b8); background:var(--surface-2,#263348); }
        .ei-err-table td { padding:7px 10px; border-bottom:1px solid var(--border,#334155);
            color:var(--text,#f1f5f9); }
        /* Barra de progreso */
        .ei-progress { background:var(--surface-2,#263348); border-radius:100px;
            height:12px; overflow:hidden; margin:16px 0; }
        .ei-progress-fill { height:100%; border-radius:100px;
            background:linear-gradient(90deg,var(--primary,#4f46e5),var(--success,#10b981));
            transition:width .3s ease; width:0%; }
        .ei-progress-text { text-align:center; font-size:13px; color:var(--text-2,#94a3b8); }
        /* Resultado final */
        .ei-result-summary { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px; }
        .ei-result-title { font-size:18px; font-weight:700; color:var(--success,#10b981);
            margin-bottom:12px; }
        /* Historial */
        .ei-history-table { width:100%; border-collapse:collapse; font-size:12px; }
        .ei-history-table th { padding:8px 12px; text-align:left; font-size:11px;
            color:var(--text-2,#94a3b8); background:var(--surface-2,#263348);
            font-weight:600; text-transform:uppercase; letter-spacing:.4px; }
        .ei-history-table td { padding:9px 12px; border-bottom:1px solid var(--border,#334155);
            color:var(--text,#f1f5f9); }
        .ei-history-table tbody tr:hover td { background:var(--surface-2,#263348); }
        @media(max-width:600px){
            .ei-map-grid { grid-template-columns:1fr; }
            .ei-options { grid-template-columns:1fr; }
        }
        `;
        document.head.appendChild(style);
    }

    /* ══════════════════════════════════════════════════════════════
       CONSTRUCCIÓN DEL MODAL HTML
       ══════════════════════════════════════════════════════════════ */
    function _buildModal() {
        if (document.getElementById('eiModal')) return;
        const div = document.createElement('div');
        div.id = 'eiModal';
        div.setAttribute('role', 'dialog');
        div.setAttribute('aria-modal', 'true');
        div.setAttribute('aria-label', 'Importar inventario desde Excel');
        div.innerHTML = `
        <div id="eiBox">
          <div id="eiHeader">
            <h2 id="eiTitle">📥 Importar inventario desde Excel</h2>
            <button id="eiCloseBtn" onclick="window.closeExcelImportModal()"
              aria-label="Cerrar" style="background:none;border:none;cursor:pointer;
              font-size:18px;color:var(--text-2,#94a3b8);padding:4px 8px;">✕</button>
          </div>
          <!-- Indicadores de paso -->
          <div style="padding:0 22px;padding-top:16px;">
            <div class="ei-steps" id="eiStepsBar">
              <div class="ei-step-ind active" data-step="1">1. Archivo</div>
              <div class="ei-step-ind" data-step="2">2. Hoja</div>
              <div class="ei-step-ind" data-step="3">3. Mapeo</div>
              <div class="ei-step-ind" data-step="4">4. Opciones</div>
              <div class="ei-step-ind" data-step="5">5. Vista previa</div>
              <div class="ei-step-ind" data-step="6">6. Resultado</div>
            </div>
          </div>
          <div id="eiBody"></div>
          <div id="eiFooter"></div>
        </div>`;
        document.body.appendChild(div);
        // Cerrar al pulsar fuera del cuadro
        div.addEventListener('click', e => {
            if (e.target === div) window.closeExcelImportModal();
        });
    }

    /* ══════════════════════════════════════════════════════════════
       NAVEGACIÓN ENTRE PASOS
       ══════════════════════════════════════════════════════════════ */
    function _goToStep(n) {
        _state.step = n;
        // Actualizar indicadores
        document.querySelectorAll('.ei-step-ind').forEach(el => {
            const s = parseInt(el.dataset.step);
            el.classList.remove('active','done');
            if (s === n) el.classList.add('active');
            else if (s < n) el.classList.add('done');
        });
        const body   = document.getElementById('eiBody');
        const footer = document.getElementById('eiFooter');
        if (!body || !footer) return;

        switch(n) {
            case 1: _renderStep1(body, footer); break;
            case 2: _renderStep2(body, footer); break;
            case 3: _renderStep3(body, footer); break;
            case 4: _renderStep4(body, footer); break;
            case 5: _renderStep5(body, footer); break;
            case 6: _renderStep6(body, footer); break;
        }
    }

    /* ══════════════════════════════════════════════════════════════
       PASO 1: SELECCIONAR ARCHIVO
       ══════════════════════════════════════════════════════════════ */
    function _renderStep1(body, footer) {
        body.innerHTML = `
        <h3 style="font-size:14px;font-weight:700;margin-bottom:14px;
            color:var(--text,#f1f5f9);">Paso 1 — Seleccionar archivo</h3>
        <div class="ei-drop" id="eiDropZone"
             onclick="document.getElementById('eiFileInput').click()"
             role="button" tabindex="0"
             aria-label="Seleccionar archivo Excel">
          <div class="ei-drop-icon">📂</div>
          <div class="ei-drop-title">Arrastra tu archivo aquí o haz clic para seleccionar</div>
          <div class="ei-drop-sub">Formatos admitidos: .xlsx, .xls, .csv</div>
          <input type="file" id="eiFileInput" accept=".xlsx,.xls,.csv"
                 style="display:none" aria-hidden="true"/>
        </div>
        <div class="ei-file-info" id="eiFileInfo">
          <div>
            <div class="ei-fi-name" id="eiFileName"></div>
            <div class="ei-fi-meta" id="eiFileMeta"></div>
          </div>
          <span id="eiFileOk" style="font-size:20px;">✅</span>
        </div>
        <p style="font-size:12px;color:var(--text-3,#475569);margin-top:12px;">
          Límite recomendado: 10,000 filas. Archivos más grandes se procesan por lotes.
        </p>`;

        footer.innerHTML = `
        <button class="btn" onclick="window.closeExcelImportModal()">Cancelar</button>
        <button class="btn" onclick="window.downloadImportTemplate()" title="Descargar plantilla Excel">
          📄 Plantilla Excel</button>
        <button class="btn btn-primary" id="eiNext1" disabled onclick="window._eiNext1()">
          Siguiente →</button>`;

        // Drag & drop
        const drop = document.getElementById('eiDropZone');
        const inp  = document.getElementById('eiFileInput');
        drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', e => {
            e.preventDefault(); drop.classList.remove('over');
            if (e.dataTransfer.files.length) _processFile(e.dataTransfer.files[0]);
        });
        drop.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') inp.click(); });
        inp.addEventListener('change', e => { if (e.target.files.length) _processFile(e.target.files[0]); });
    }

    function _processFile(file) {
        // Validar extensión
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx','xls','csv'].includes(ext)) {
            _eiAlert('El archivo no tiene un formato compatible. Usa .xlsx, .xls o .csv');
            return;
        }
        // Validar tamaño (máx 50 MB)
        const maxBytes = 50 * 1024 * 1024;
        if (file.size > maxBytes) {
            _eiAlert('El archivo es demasiado grande. Máximo permitido: 50 MB');
            return;
        }
        _state.file = file;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                if (ext === 'csv') {
                    // Detectar encoding del CSV:
                    // Si tiene BOM UTF-8 (EF BB BF) → UTF-8
                    // Si tiene BOM UTF-16 LE (FF FE) → UTF-16
                    // Sin BOM → intentar UTF-8, fallback a Windows-1252
                    const rawBytes = new Uint8Array(e.target.result);
                    let text;
                    if (rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF) {
                        // BOM UTF-8 — decodificar sin el BOM
                        text = new TextDecoder('utf-8').decode(rawBytes.slice(3));
                    } else if (rawBytes[0] === 0xFF && rawBytes[1] === 0xFE) {
                        // BOM UTF-16 LE
                        text = new TextDecoder('utf-16le').decode(rawBytes.slice(2));
                    } else {
                        // Sin BOM: intentar UTF-8 primero, luego Windows-1252
                        try {
                            // TextDecoder con fatal:true lanza error si no es UTF-8 válido
                            text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
                        } catch {
                            // Fallback a Windows-1252 (encoding de Excel en Windows)
                            text = new TextDecoder('windows-1252').decode(rawBytes);
                        }
                    }
                    const wb = XLSX.read(text, { type: 'string' });
                    _state.workbook = wb;
                } else {
                    const arr = new Uint8Array(e.target.result);
                    _state.workbook = XLSX.read(arr, { type: 'array', cellDates: true });
                }
                // Mostrar info del archivo
                const info = document.getElementById('eiFileInfo');
                if (info) {
                    info.classList.add('visible');
                    document.getElementById('eiFileName').textContent = file.name;
                    const kb = (file.size / 1024).toFixed(1);
                    const sheets = _state.workbook.SheetNames.length;
                    document.getElementById('eiFileMeta').textContent =
                        `${kb} KB · ${sheets} hoja${sheets !== 1 ? 's' : ''}`;
                }
                const btn = document.getElementById('eiNext1');
                if (btn) btn.disabled = false;
                // Auto-seleccionar primera hoja
                _state.selectedSheet = _state.workbook.SheetNames[0];
                _loadSheet(_state.selectedSheet);
            } catch (err) {
                _eiAlert('No se pudo leer el archivo. Verifica que no esté corrupto o protegido.');
                console.error('[ExcelImport]', err);
            }
        };
        reader.onerror = () => _eiAlert('Error al leer el archivo.');
        reader.readAsArrayBuffer(file);
    }

    function _loadSheet(name) {
        if (!_state.workbook) return;
        const sheet = _state.workbook.Sheets[name];
        if (!sheet) return;
        const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

        // Filtrar filas completamente vacías
        const nonEmpty = allRows.filter(r => r.some(c => String(c).trim() !== ''));
        if (nonEmpty.length < 2) {
            showToast('⚠️', `La hoja "${name}" está vacía o no tiene datos.`);
            return;
        }

        // ── Detección inteligente de la fila de encabezados ──
        // Busca la fila con mayor puntuación: campos reconocidos + palabras clave típicas
        const HEADER_KEYWORDS = /producto|nombre|item|articulo|cantidad|stock|precio|costo|sku|codigo|descripcion|marca|proveedor|unidad|categoria/i;
        let headerRowIdx = 0;
        let bestScore = -1;
        for (let i = 0; i < Math.min(nonEmpty.length, 10); i++) {
            const row = nonEmpty[i];
            const nonEmptyCells = row.filter(c => String(c).trim() !== '');
            if (nonEmptyCells.length < 1) continue;
            let score = 0;
            row.forEach(c => {
                const s = String(c).trim();
                if (!s) return;
                if (_autoMap([s])[s] && _autoMap([s])[s] !== 'ignore') { score += 3; return; }
                if (HEADER_KEYWORDS.test(s)) score += 1;
            });
            if (score > bestScore) { bestScore = score; headerRowIdx = i; }
        }

        let headers = nonEmpty[headerRowIdx].map(h => String(h).trim());
        let dataRows = nonEmpty.slice(headerRowIdx + 1);

        // ── Eliminar fila de TOTAL al final ──
        if (dataRows.length > 0) {
            const last = dataRows[dataRows.length - 1];
            const isTotal = last.some(c => /^total$/i.test(String(c).trim()) || /^gran\s*total$/i.test(String(c).trim()));
            if (isTotal) dataRows = dataRows.slice(0, -1);
        }

        _state.selectedSheet = name;
        _state.headers  = headers;
        _state.rawRows  = dataRows;
        _state.mapping  = _autoMap(headers);
    }

    window._eiNext1 = function() {
        if (!_state.workbook) return;
        const sheets = _state.workbook.SheetNames;
        if (sheets.length === 1) {
            _loadSheet(sheets[0]);
            _goToStep(3); // Saltar paso 2 si solo hay una hoja
        } else {
            _goToStep(2);
        }
    };

    /* ══════════════════════════════════════════════════════════════
       PASO 2: SELECCIONAR HOJA
       ══════════════════════════════════════════════════════════════ */
    function _renderStep2(body, footer) {
        const sheets = _state.workbook ? _state.workbook.SheetNames : [];
        body.innerHTML = `
        <h3 style="font-size:14px;font-weight:700;margin-bottom:14px;
            color:var(--text,#f1f5f9);">Paso 2 — Seleccionar hoja</h3>
        <p style="font-size:13px;color:var(--text-2,#94a3b8);margin-bottom:14px;">
          El archivo tiene ${sheets.length} hojas. Selecciona la que contiene el inventario.
        </p>
        <div class="ei-sheets" id="eiSheetsContainer">
          ${sheets.map(s => `
            <button class="ei-sheet-btn ${s===_state.selectedSheet?'active':''}"
                    onclick="window._eiSelectSheet('${s.replace(/'/g,"\\'")}')">
              📋 ${s}
            </button>`).join('')}
        </div>
        <div id="eiSheetPreview" style="margin-top:14px;font-size:12px;
            color:var(--text-2,#94a3b8);"></div>`;

        footer.innerHTML = `
        <button class="btn" onclick="window.closeExcelImportModal()">Cancelar</button>
        <button class="btn" onclick="window._eiGoStep(1)">← Atrás</button>
        <button class="btn btn-primary" id="eiNext2" onclick="window._eiGoStep(3)">
          Siguiente →</button>`;

        _updateSheetPreview();
    }

    window._eiSelectSheet = function(name) {
        _loadSheet(name);
        document.querySelectorAll('.ei-sheet-btn').forEach(b => {
            b.classList.toggle('active', b.textContent.trim().replace('📋 ','') === name);
        });
        _updateSheetPreview();
    };

    function _updateSheetPreview() {
        const el = document.getElementById('eiSheetPreview');
        if (!el || !_state.rawRows) return;
        el.textContent = `✅ Hoja "${_state.selectedSheet}" — ${_state.rawRows.length} filas · ${_state.headers.length} columnas`;
    }

    /* ══════════════════════════════════════════════════════════════
       PASO 3: MAPEO DE COLUMNAS
       ══════════════════════════════════════════════════════════════ */
    function _renderStep3(body, footer) {
        const headers = _state.headers;
        const mapping = _state.mapping;

        // Advertencia si no hay columna de moneda mapeada
        const hasCurrencyCol = Object.values(mapping).includes('currency');
        const defCurr        = 'USD';
        const currWarning    = hasCurrencyCol ? '' : `
        <div style="background:#0c1a0c;border:1px solid #166534;border-radius:8px;padding:10px 14px;
                    margin-bottom:14px;font-size:12px;color:#86efac;line-height:1.6;">
            ✅ No se detectó columna de <strong>Moneda</strong>. Los precios del Excel se importarán
            como <strong>🇺🇸 USD (Dólares)</strong> — moneda base del sistema.<br>
            Si tus precios están en VES o EUR, agrega una columna <strong>Moneda</strong>
            con valores <code>VES</code>, <code>EUR</code> o <code>USD</code>.
        </div>`;

        const opts = FIELD_OPTIONS.map(f =>
            `<option value="${f.value}">${f.label}</option>`
        ).join('');

        const rows = headers.map(h => {
            const cur = mapping[h] || 'ignore';
            const autoTag = cur !== 'ignore'
                ? `<span style="font-size:10px;background:rgba(16,185,129,.2);color:#6ee7b7;
                    border-radius:20px;padding:1px 6px;margin-left:4px;">auto</span>`
                : '';
            return `
            <div class="ei-map-row">
              <span class="ei-map-label" title="${h}">${h}${autoTag}</span>
              <span class="ei-map-arrow">→</span>
              <select class="ei-map-sel"
                      onchange="window._eiUpdateMap('${h.replace(/'/g,"\\'")}', this.value)">
                ${FIELD_OPTIONS.map(f =>
                    `<option value="${f.value}" ${f.value===cur?'selected':''}>${f.label}</option>`
                ).join('')}
              </select>
            </div>`;
        }).join('');

        body.innerHTML = `
        <h3 style="font-size:14px;font-weight:700;margin-bottom:4px;
            color:var(--text,#f1f5f9);">Paso 3 — Mapear columnas</h3>
        <p style="font-size:12px;color:var(--text-2,#94a3b8);margin-bottom:14px;">
          El sistema detectó las columnas automáticamente. Verifica y ajusta si es necesario.<br>
          Los campos con <span style="color:#6ee7b7;font-weight:600;">auto</span>
          fueron reconocidos. Las columnas con "— Ignorar —" no se importarán.
        </p>
        ${currWarning}
        <div class="ei-map-grid">${rows}</div>`;

        footer.innerHTML = `
        <button class="btn" onclick="window.closeExcelImportModal()">Cancelar</button>
        <button class="btn" onclick="window._eiGoStep(${_state.workbook.SheetNames.length>1?2:1})">
          ← Atrás</button>
        <button class="btn btn-primary" onclick="window._eiGoStep(4)">Siguiente →</button>`;
    }

    window._eiUpdateMap = function(header, value) {
        _state.mapping[header] = value;
    };

    /* ══════════════════════════════════════════════════════════════
       PASO 4: OPCIONES DE IMPORTACIÓN
       ══════════════════════════════════════════════════════════════ */
    function _renderStep4(body, footer) {
        body.innerHTML = `
        <h3 style="font-size:14px;font-weight:700;margin-bottom:14px;
            color:var(--text,#f1f5f9);">Paso 4 — Opciones de importación</h3>
        <div class="ei-options">
          <div class="ei-option-group">
            <label>¿Cómo actualizar el stock de productos existentes?</label>
            <select id="eiStockMode" onchange="window._eiSetStockMode(this.value)">
              <option value="replace" ${_state.stockMode==='replace'?'selected':''}>
                Reemplazar (usar valor del Excel)</option>
              <option value="add"     ${_state.stockMode==='add'?'selected':''}>
                Sumar al stock actual</option>
            </select>
          </div>
          <div class="ei-option-group">
            <label>¿Qué hacer con productos duplicados (SKU ya existe)?</label>
            <select id="eiDupMode" onchange="window._eiSetDupMode(this.value)">
              <option value="update" ${_state.duplicateMode==='update'?'selected':''}>
                Actualizar el producto existente</option>
              <option value="create" ${_state.duplicateMode==='create'?'selected':''}>
                Crear como producto nuevo</option>
              <option value="ignore" ${_state.duplicateMode==='ignore'?'selected':''}>
                Ignorar (no importar duplicados)</option>
            </select>
          </div>
        </div>
        <div style="background:var(--surface-2,#263348);border-radius:10px;padding:14px;
            font-size:12px;color:var(--text-2,#94a3b8);margin-top:8px;">
          <strong style="color:var(--text,#f1f5f9);">ℹ️ Información</strong><br>
          • Las categorías y proveedores nuevos se crearán automáticamente.<br>
          • Las URLs de imagen se guardan tal como están en el Excel.<br>
          • Los campos vacíos en el Excel NO sobreescriben datos existentes.<br>
          • Podrás deshacer la importación desde el Historial si es necesario.
        </div>`;

        footer.innerHTML = `
        <button class="btn" onclick="window.closeExcelImportModal()">Cancelar</button>
        <button class="btn" onclick="window._eiGoStep(3)">← Atrás</button>
        <button class="btn btn-primary" onclick="window._eiGoStep(5)">Ver vista previa →</button>`;
    }

    window._eiSetStockMode = function(v) { _state.stockMode = v; };
    window._eiSetDupMode   = function(v) { _state.duplicateMode = v; };

    /* ══════════════════════════════════════════════════════════════
       PASO 5: VISTA PREVIA Y VALIDACIÓN
       ══════════════════════════════════════════════════════════════ */
    function _renderStep5(body, footer) {
        // Correr validación
        const { valid, errors } = _validateRows(_state.rawRows, _state.headers, _state.mapping);
        _state.validated = valid;
        _state.errors    = errors;

        const total  = _state.rawRows.length;
        const newCount   = valid.filter(r => r._action === 'new').length;
        const dupCount   = valid.filter(r => r._action === 'duplicate').length;
        const errCount   = errors.length;
        const validTotal = valid.length;

        // Columnas visibles (las que están mapeadas, máx 8)
        // Siempre incluir 'profit' si está mapeado; si no, añadirlo al final como calculado
        const mappedFields = [...new Set(
            Object.values(_state.mapping).filter(v => v && v !== 'ignore')
        )];
        const hasProfitMapped = mappedFields.includes('profit');
        // Reservar slot para profit y limitar el resto a 7
        const otherFields = mappedFields.filter(f => f !== 'profit').slice(0, 7);
        const visibleFields = hasProfitMapped
            ? [...otherFields.slice(0, 7), 'profit']
            : [...otherFields, '_calcProfit']; // columna calculada siempre visible

        const fieldLabels = {};
        FIELD_OPTIONS.forEach(f => { fieldLabels[f.value] = f.label.replace(' *',''); });
        fieldLabels['_calcProfit'] = '💰 Utilidad';

        // Construir filas de previsualización (máx 200 para el DOM)
        const previewRows = valid.slice(0, 200).map(r => {
            const cls = r._action === 'duplicate' ? 'dup-row' : 'new-row';
            const badge = r._action === 'duplicate'
                ? `<span class="ei-badge ei-badge-dup">Actualizar</span>`
                : `<span class="ei-badge ei-badge-new">Nuevo</span>`;
            const cells = visibleFields.map(f => {
                // Columna de utilidad calculada (cuando no viene en el Excel)
                if (f === '_calcProfit') {
                    const calc = Number(r.price || 0) - Number(r.cost || 0);
                    const col  = calc > 0 ? '#6ee7b7' : calc < 0 ? '#fca5a5' : '#94a3b8';
                    return `<td style="color:${col};font-weight:600;">$${calc.toFixed(2)}</td>`;
                }
                const v = r[f];
                if (v === null || v === undefined || v === '') return '<td>—</td>';
                if (f === 'profit') {
                    const pv  = Number(v);
                    const col = pv > 0 ? '#6ee7b7' : pv < 0 ? '#fca5a5' : '#94a3b8';
                    return `<td style="color:${col};font-weight:600;">$${pv.toFixed(2)} <span style="font-size:9px;opacity:.7;">Excel</span></td>`;
                }
                if (['cost','price','wholesalePrice'].includes(f))
                    return `<td>$${Number(v).toFixed(2)}</td>`;
                if (f === 'stock')
                    return `<td>${Math.round(Number(v))}</td>`;
                return `<td>${String(v).slice(0,40)}</td>`;
            }).join('');
            return `<tr class="${cls}"><td>${badge}</td>${cells}</tr>`;
        }).join('');

        // Filas con error
        const errRows = errors.slice(0, 50).map(e => `
            <tr class="err-row">
              <td style="color:var(--danger,#ef4444);font-weight:700;">Fila ${e.row}</td>
              <td>${e.data.name||'(sin nombre)'}</td>
              <td>${e.data.sku||'(sin SKU)'}</td>
              <td style="color:var(--danger,#ef4444);">❌ ${e.fields}</td>
            </tr>`).join('');

        body.innerHTML = `
        <h3 style="font-size:14px;font-weight:700;margin-bottom:14px;
            color:var(--text,#f1f5f9);">Paso 5 — Vista previa</h3>
        <div class="ei-summary">
          <div class="ei-stat info"><div class="ei-st-num">${total}</div>
            <div class="ei-st-lbl">Total filas</div></div>
          <div class="ei-stat ok"><div class="ei-st-num">${validTotal}</div>
            <div class="ei-st-lbl">Válidos</div></div>
          <div class="ei-stat ok"><div class="ei-st-num">${newCount}</div>
            <div class="ei-st-lbl">Nuevos</div></div>
          <div class="ei-stat warn"><div class="ei-st-num">${dupCount}</div>
            <div class="ei-st-lbl">Duplicados</div></div>
          <div class="ei-stat err"><div class="ei-st-num">${errCount}</div>
            <div class="ei-st-lbl">Errores</div></div>
        </div>
        ${dupCount > 0 ? `<p style="font-size:12px;color:var(--warning,#f59e0b);
            background:rgba(245,158,11,.1);border-radius:8px;padding:8px 12px;margin-bottom:12px;">
            ⚠️ ${dupCount} producto(s) ya existen en el inventario.
            Se aplicará la acción seleccionada: <strong>${
                _state.duplicateMode==='update'?'Actualizar':
                _state.duplicateMode==='create'?'Crear nuevo':'Ignorar'}</strong>.
        </p>` : ''}
        ${validTotal === 0 ? `<p style="color:var(--danger,#ef4444);font-weight:600;">
            ⚠️ No hay productos válidos para importar.</p>` : ''}
        <!-- Tabla de previsualización -->
        <p style="font-size:12px;font-weight:600;color:var(--text-2,#94a3b8);margin-bottom:6px;">
          Productos válidos (mostrando máx. 200 de ${validTotal}):
        </p>
        <div class="ei-preview-wrap">
          <table>
            <thead><tr>
              <th>Estado</th>
              ${visibleFields.map(f=>`<th>${fieldLabels[f]||f}</th>`).join('')}
            </tr></thead>
            <tbody>${previewRows || '<tr><td colspan="20" style="text-align:center;padding:20px;color:var(--text-3)">Sin datos válidos</td></tr>'}</tbody>
          </table>
        </div>
        ${errCount > 0 ? `
        <p style="font-size:12px;font-weight:600;color:var(--danger,#ef4444);margin-top:14px;margin-bottom:6px;">
          Filas con errores (${errCount}) — no se importarán:
        </p>
        <div class="ei-preview-wrap">
          <table>
            <thead><tr><th>Fila</th><th>Nombre</th><th>SKU</th><th>Error</th></tr></thead>
            <tbody>${errRows}</tbody>
          </table>
        </div>` : ''}`;

        footer.innerHTML = `
        <button class="btn" onclick="window.closeExcelImportModal()">Cancelar</button>
        <button class="btn" onclick="window._eiGoStep(4)">← Volver a opciones</button>
        <button class="btn btn-success" id="eiImportBtn"
          ${validTotal === 0 ? 'disabled' : ''}
          onclick="window._eiRunImport()">
          📥 Importar ${validTotal} producto${validTotal!==1?'s':''}</button>`;
    }

    /* ══════════════════════════════════════════════════════════════
       PASO 6: EJECUCIÓN Y RESULTADO
       ══════════════════════════════════════════════════════════════ */
    window._eiRunImport = function() {
        const validated = _state.validated || [];
        if (validated.length === 0) { showToast('⚠️', 'No hay datos válidos'); return; }

        const body   = document.getElementById('eiBody');
        const footer = document.getElementById('eiFooter');
        _goToStep(6);

        body.innerHTML = `
        <h3 style="font-size:14px;font-weight:700;margin-bottom:14px;
            color:var(--text,#f1f5f9);">Importando…</h3>
        <div class="ei-progress"><div class="ei-progress-fill" id="eiProgFill"></div></div>
        <p class="ei-progress-text" id="eiProgText">Preparando importación…</p>`;
        footer.innerHTML = '';

        // Asignar ID a esta importación para deshacer
        _state.importId     = generateId();
        _state.snapshotIds  = [];

        let processed = 0, created = 0, updated = 0, ignored = 0;
        const total   = validated.length;
        const BATCH   = 100;

        function processBatch() {
            const slice = validated.slice(processed, processed + BATCH);

            slice.forEach(item => {
                try {
                    if (item._action === 'new') {
                        _createProduct(item);
                        created++;
                    } else if (item._action === 'duplicate') {
                        if (_state.duplicateMode === 'update') {
                            _updateProduct(item);
                            updated++;
                        } else if (_state.duplicateMode === 'create') {
                            // Crear con SKU modificado para evitar conflicto
                            const clone = Object.assign({}, item);
                            clone._action = 'new';
                            clone.sku = (clone.sku || '') + '_IMP';
                            _createProduct(clone);
                            created++;
                        } else {
                            ignored++;
                        }
                    } else {
                        ignored++;
                    }
                } catch (e) {
                    console.error('[ExcelImport] error procesando fila', item._row, e);
                    ignored++;
                }
            });

            processed += slice.length;
            const pct = Math.min(100, Math.round((processed / total) * 100));
            const fill = document.getElementById('eiProgFill');
            const txt  = document.getElementById('eiProgText');
            if (fill) fill.style.width = pct + '%';
            if (txt)  txt.textContent =
                `Procesados ${processed} de ${total} (${pct}%) · Creados: ${created} · Actualizados: ${updated}`;

            if (processed < total) {
                setTimeout(processBatch, 10);
            } else {
                _onImportComplete(total, created, updated, ignored);
            }
        }
        processBatch();
    };

    function _createProduct(item) {
        const catId  = _resolveCategory(item.category);
        const supId  = _resolveSupplier(item.supplier);
        const whId   = _resolveWarehouse(item.warehouse);

        // Auto-generar SKU si no viene del Excel
        const sku = (item.sku && String(item.sku).trim())
            ? String(item.sku).trim()
            : String(item.name || '').toUpperCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                .replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-')
                .replace(/^-|-$/g, '').slice(0, 25);

        const prod = {
            id:            generateId(),
            name:          String(item.name || '').trim(),
            sku,
            barcode:       String(item.barcode       || ''),
            internalCode:  String(item.internalCode  || ''),
            categoryId:    catId,
            subcategory:   String(item.subcategory   || ''),
            brand:         String(item.brand         || ''),
            description:   String(item.description   || ''),
            supplierId:    supId,
            cost:          Number(item.cost          ?? 0),
            price:         Number(item.price         ?? 0),
            wholesalePrice:Number(item.wholesalePrice?? 0),
            profit:        item.profit != null ? Number(item.profit) : null,
            tax:           Number(item.tax           ?? 0),
            stock:         Math.round(Number(item.stock ?? 0)),
            minStock:      Math.round(Number(item.minStock  ?? 0)),
            maxStock:      Math.round(Number(item.maxStock  ?? 0)),
            unit:          String(item.unit          || 'unidad'),
            warehouseId:   whId,
            location:      String(item.location      || ''),
            lot:           String(item.lot           || ''),
            expiryDate:    String(item.expiryDate    || ''),
            serialNumber:  String(item.serialNumber  || ''),
            status:        String(item.status        || 'activo'),
            image:         String(item.image         || ''),
            notes:         String(item.notes         || ''),
            currency:      _resolveCurrency(item.currency),  // USD por defecto si no viene en Excel
            _importId:     _state.importId
        };
        data.products.push(prod);
        _state.snapshotIds.push(prod.id);

        if (prod.stock > 0) {
            data.inventoryMovements.push({
                id: generateId(), productId: prod.id, productName: prod.name,
                type: 'Entrada', quantity: prod.stock, warehouseId: prod.warehouseId,
                date: new Date().toISOString(), user: 'admin',
                reason: 'Importación Excel', notes: 'Stock inicial desde importación',
                previousStock: 0, newStock: prod.stock
            });
        }
    }

    function _updateProduct(item) {
        const existing = data.products.find(p => p.id === item._existingId);
        if (!existing) return;

        const oldStock = existing.stock;
        // Solo sobreescribir si el valor del Excel no está vacío
        const upd = (cur, val) => (val !== null && val !== undefined && val !== '') ? val : cur;

        existing.name        = upd(existing.name,        item.name);
        existing.barcode     = upd(existing.barcode,     item.barcode);
        existing.internalCode= upd(existing.internalCode,item.internalCode);
        existing.brand       = upd(existing.brand,       item.brand);
        existing.description = upd(existing.description, item.description);
        existing.image       = upd(existing.image,       item.image);
        existing.notes       = upd(existing.notes,       item.notes);
        existing.unit        = upd(existing.unit,        item.unit);
        existing.location    = upd(existing.location,    item.location);
        existing.lot         = upd(existing.lot,         item.lot);
        existing.expiryDate  = upd(existing.expiryDate,  item.expiryDate);
        existing.serialNumber= upd(existing.serialNumber,item.serialNumber);
        existing.status      = upd(existing.status,      item.status);
        existing.subcategory = upd(existing.subcategory, item.subcategory);

        if (item.cost  !== null && item.cost  !== undefined) existing.cost  = Number(item.cost);
        if (item.price !== null && item.price !== undefined) existing.price = Number(item.price);
        if (item.wholesalePrice !== null && item.wholesalePrice !== undefined)
            existing.wholesalePrice = Number(item.wholesalePrice);
        if (item.profit    !== null && item.profit    !== undefined) existing.profit    = Number(item.profit);
        if (item.tax       !== null && item.tax       !== undefined) existing.tax       = Number(item.tax);
        if (item.minStock  !== null && item.minStock  !== undefined) existing.minStock  = Math.round(Number(item.minStock));
        if (item.maxStock  !== null && item.maxStock  !== undefined) existing.maxStock  = Math.round(Number(item.maxStock));
        // Actualizar currency si viene explícitamente en el Excel
        if (item.currency) existing.currency = _resolveCurrency(item.currency);

        if (item.category) {
            const cid = _resolveCategory(item.category);
            if (cid) existing.categoryId = cid;
        }
        if (item.supplier) {
            const sid = _resolveSupplier(item.supplier);
            if (sid) existing.supplierId = sid;
        }
        if (item.warehouse) {
            const wid = _resolveWarehouse(item.warehouse);
            if (wid) existing.warehouseId = wid;
        }

        // Stock
        if (item.stock !== null && item.stock !== undefined) {
            const newStock = _state.stockMode === 'add'
                ? oldStock + Number(item.stock)
                : Number(item.stock);
            existing.stock = Math.max(0, Math.round(newStock));
            if (oldStock !== existing.stock) {
                const diff = existing.stock - oldStock;
                data.inventoryMovements.push({
                    id: generateId(), productId: existing.id, productName: existing.name,
                    type: diff > 0 ? 'Entrada' : 'Salida', quantity: diff,
                    warehouseId: existing.warehouseId,
                    date: new Date().toISOString(), user: 'admin',
                    reason: 'Importación Excel',
                    notes: `Stock ${_state.stockMode==='add'?'sumado':'reemplazado'} desde Excel (${oldStock} → ${existing.stock})`,
                    previousStock: oldStock, newStock: existing.stock
                });
            }
        }
        existing._importId = _state.importId;
    }

    function _onImportComplete(total, created, updated, ignored) {
        // Guardar en historial
        data.importHistory = data.importHistory || [];
        const histEntry = {
            id:       _state.importId,
            date:     new Date().toISOString(),
            file:     _state.file ? _state.file.name : 'Excel',
            sheet:    _state.selectedSheet || '',
            records:  total,
            created,
            updated,
            ignored,
            errors:   _state.errors.length,
            status:   'Completada',
            stockMode:     _state.stockMode,
            duplicateMode: _state.duplicateMode,
            createdIds:    _state.snapshotIds.slice()
        };
        data.importHistory.push(histEntry);
        persist();
        generateAlerts();
        renderAll();

        // Mostrar resultado
        const body   = document.getElementById('eiBody');
        const footer = document.getElementById('eiFooter');
        if (!body) return;

        body.innerHTML = `
        <div class="ei-result-title">✅ Importación completada</div>
        <div class="ei-result-summary">
          <div class="ei-stat info"><div class="ei-st-num">${total}</div>
            <div class="ei-st-lbl">Total filas</div></div>
          <div class="ei-stat ok"><div class="ei-st-num">${created}</div>
            <div class="ei-st-lbl">Creados</div></div>
          <div class="ei-stat warn"><div class="ei-st-num">${updated}</div>
            <div class="ei-st-lbl">Actualizados</div></div>
          <div class="ei-stat err"><div class="ei-st-num">${ignored}</div>
            <div class="ei-st-lbl">Ignorados</div></div>
          <div class="ei-stat err"><div class="ei-st-num">${_state.errors.length}</div>
            <div class="ei-st-lbl">Errores</div></div>
        </div>
        <p style="font-size:13px;color:var(--text-2,#94a3b8);">
          Los productos están disponibles en el inventario y en el punto de venta.
        </p>
        ${_state.errors.length > 0 ? `
        <p style="font-size:12px;font-weight:600;color:var(--danger,#ef4444);margin-top:12px;">
          Filas con errores (no importadas):</p>
        <div class="ei-preview-wrap" style="max-height:180px;">
          <table>
            <thead><tr><th>Fila</th><th>Nombre</th><th>SKU</th><th>Error</th></tr></thead>
            <tbody>${_state.errors.slice(0,30).map(e=>`
              <tr><td style="color:var(--danger,#ef4444);">Fila ${e.row}</td>
              <td>${e.data.name||'—'}</td><td>${e.data.sku||'—'}</td>
              <td style="color:var(--danger,#ef4444);">❌ ${e.fields}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
        <p style="margin-top:14px;font-size:12px;color:var(--text-3,#475569);">
          ID de importación: <code>${_state.importId}</code> —
          puedes deshacerla desde el historial de importaciones.
        </p>`;

        footer.innerHTML = `
        <button class="btn btn-danger btn-sm" onclick="window._eiUndo('${_state.importId}')">
          ↩️ Deshacer esta importación</button>
        <button class="btn" onclick="window.closeExcelImportModal()">Cerrar</button>
        <button class="btn btn-primary"
          onclick="window.closeExcelImportModal(); navigateTo('inventory')">
          Ir al inventario</button>`;

        showToast('✅', `Importación: ${created} creados, ${updated} actualizados`);
    }

    /* ══════════════════════════════════════════════════════════════
       DESHACER IMPORTACIÓN
       ══════════════════════════════════════════════════════════════ */
    window._eiUndo = function(importId) {
        if (!confirm(`¿Deshacer la importación ${importId}?\n\nEsto eliminará los productos creados y revertirá los stocks actualizados.`)) return;

        const entry = (data.importHistory || []).find(h => h.id === importId);
        if (!entry) { showToast('⚠️', 'Importación no encontrada'); return; }

        let deletedCount   = 0;
        let revertedCount  = 0;

        // Eliminar productos creados por esta importación
        if (entry.createdIds && entry.createdIds.length > 0) {
            const before = data.products.length;
            data.products = data.products.filter(p => !entry.createdIds.includes(p.id));
            deletedCount = before - data.products.length;
            // Eliminar movimientos de esos productos
            data.inventoryMovements = data.inventoryMovements.filter(
                m => !entry.createdIds.includes(m.productId)
            );
        }

        // Revertir movimientos de productos actualizados
        const importMovs = data.inventoryMovements.filter(
            m => m.reason === 'Importación Excel' &&
                 new Date(m.date) >= new Date(entry.date) &&
                 new Date(m.date) <= new Date(new Date(entry.date).getTime() + 60000)
        );
        importMovs.forEach(m => {
            const prod = data.products.find(p => p.id === m.productId);
            if (prod) {
                prod.stock = m.previousStock;
                revertedCount++;
            }
        });
        // Eliminar esos movimientos
        const movIds = new Set(importMovs.map(m => m.id));
        data.inventoryMovements = data.inventoryMovements.filter(m => !movIds.has(m.id));

        // Marcar historial como deshecha
        entry.status = 'Deshecha';
        persist();
        renderAll();
        generateAlerts();
        showToast('↩️', `Deshecha: ${deletedCount} eliminados, ${revertedCount} revertidos`);
        window.closeExcelImportModal();
    };

    /* ══════════════════════════════════════════════════════════════
       HISTORIAL DE IMPORTACIONES (modal separado)
       ══════════════════════════════════════════════════════════════ */
    window.openImportHistoryModal = function() {
        _injectStyles();
        _injectStyles2();
        // Reusar eiModal para historial
        if (!document.getElementById('eiModal')) _buildModal();
        const modal = document.getElementById('eiModal');
        const title = document.getElementById('eiTitle');
        const steps = document.getElementById('eiStepsBar');
        const body  = document.getElementById('eiBody');
        const footer= document.getElementById('eiFooter');

        title.textContent = '📋 Historial de importaciones';
        if (steps) steps.style.display = 'none';

        const history = (data.importHistory || []).slice().reverse();

        body.innerHTML = history.length === 0 ? `
            <p style="text-align:center;padding:40px;color:var(--text-2,#94a3b8);">
              📭 No hay importaciones registradas.</p>` : `
        <div style="overflow-x:auto;">
          <table class="ei-history-table">
            <thead><tr>
              <th>Fecha</th><th>Archivo</th><th>Hoja</th>
              <th>Total</th><th>Creados</th><th>Actualizados</th>
              <th>Errores</th><th>Estado</th><th>Acción</th>
            </tr></thead>
            <tbody>
              ${history.map(h => `
              <tr>
                <td>${new Date(h.date).toLocaleString()}</td>
                <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                    title="${h.file}">${h.file || 'Excel'}</td>
                <td>${h.sheet || '—'}</td>
                <td>${h.records}</td>
                <td style="color:var(--success,#10b981);">${h.created}</td>
                <td style="color:var(--warning,#f59e0b);">${h.updated}</td>
                <td style="color:${h.errors>0?'var(--danger,#ef4444)':'var(--text-2,#94a3b8)'};">${h.errors}</td>
                <td><span class="ei-badge ${h.status==='Completada'?'ei-badge-new':h.status==='Deshecha'?'ei-badge-err':'ei-badge-dup'}">
                    ${h.status}</span></td>
                <td>${h.status==='Completada'?
                    `<button class="btn btn-sm btn-danger" onclick="window._eiUndo('${h.id}')">
                     ↩️ Deshacer</button>`:'—'}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

        footer.innerHTML = `
        <button class="btn btn-danger btn-sm"
          onclick="if(confirm('¿Limpiar todo el historial?')){data.importHistory=[];persist();window.openImportHistoryModal();}">
          🗑️ Limpiar historial</button>
        <button class="btn" onclick="window.closeExcelImportModal()">Cerrar</button>`;

        modal.classList.add('open');
    };

    /* ══════════════════════════════════════════════════════════════
       PLANTILLA DE EXCEL PARA DESCARGAR
       ══════════════════════════════════════════════════════════════ */
    window.downloadImportTemplate = function() {
        if (typeof XLSX === 'undefined') {
            alert('La librería XLSX no está disponible.');
            return;
        }
        const headers = [
            'SKU', 'Código de barras', 'Nombre', 'Descripción',
            'Marca', 'Categoría', 'Subcategoría', 'Proveedor',
            'Costo', 'Precio', 'Precio mayorista', 'Utilidad', 'Impuesto (%)',
            'Stock', 'Stock mínimo', 'Stock máximo',
            'Unidad', 'Almacén', 'Ubicación',
            'Lote', 'Fecha vencimiento', 'Número serie',
            'Estado', 'URL imagen', 'Notas'
        ];
        const example = [
            'SKU-001', '7501234567890', 'Producto de ejemplo', 'Descripción del producto',
            'Marca', 'Categoría', 'Subcategoría', 'Proveedor S.A.',
            '10.00', '19.99', '17.50', '9.99', '0',
            '50', '5', '200',
            'unidad', 'Principal', 'Estante A1',
            '', '', '',
            'activo', '', ''
        ];

        const ws = XLSX.utils.aoa_to_sheet([headers, example]);
        // Ajustar anchos de columna
        ws['!cols'] = headers.map(() => ({ wch: 20 }));
        // Estilo de encabezado (solo funciona en XLSX completo)
        for (let i = 0; i < headers.length; i++) {
            const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
            if (!ws[cellRef]) ws[cellRef] = { v: headers[i], t: 's' };
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Inventario');
        XLSX.writeFile(wb, 'plantilla_inventario_fixpromax.xlsx');
        showToast('📥', 'Plantilla descargada');
    };

    /* ══════════════════════════════════════════════════════════════
       API PÚBLICA DEL MÓDULO
       ══════════════════════════════════════════════════════════════ */

    /** Abre el modal del wizard de importación */
    window.openExcelImportModal = function() {
        _injectStyles();
        _injectStyles2();
        _buildModal();
        // Resetear estado
        _state = {
            step: 1, file: null, workbook: null, selectedSheet: null,
            headers: [], rawRows: [], mapping: {},
            stockMode: 'replace', duplicateMode: 'update',
            validated: [], errors: [], duplicatesInFile: [],
            importId: null, snapshotIds: []
        };
        const modal = document.getElementById('eiModal');
        const title = document.getElementById('eiTitle');
        const steps = document.getElementById('eiStepsBar');
        title.textContent = '📥 Importar inventario desde Excel';
        if (steps) steps.style.display = '';
        modal.classList.add('open');
        _goToStep(1);
    };

    window.closeExcelImportModal = function() {
        const modal = document.getElementById('eiModal');
        if (modal) modal.classList.remove('open');
    };

    /** Navegación global entre pasos */
    window._eiGoStep = function(n) { _goToStep(n); };

    /* ── Compatibilidad con las funciones existentes en index.html ── */

    /**
     * openImportModal() ya existe en la app y llama openModal('import').
     * Aquí la redefinimos para que abra el nuevo wizard.
     * Se hace en DOMContentLoaded para asegurar que la app ya definió la suya.
     */
    function _overrideExisting() {
        // Sobreescribir funciones de importación anteriores con el nuevo wizard
        window.openImportModal        = window.openExcelImportModal;
        window.openImportCSVModal     = window.openExcelImportModal; // unificado
        // openImportHistoryModal ya fue definida por este módulo como window.openImportHistoryModal

        // handleFileSelect (compatibilidad con código antiguo en index.html)
        window.handleFileSelect = function(event) {
            if (event && event.target && event.target.files && event.target.files[0]) {
                _processFile(event.target.files[0]);
            }
        };

        // importStep / executeImport (compatibilidad con código antiguo)
        window.importStep    = function() {};   // no-op: el nuevo wizard maneja la navegación
        window.executeImport = window._eiRunImport;

        // downloadTemplate (compatibilidad con código antiguo)
        window.downloadTemplate = window.downloadImportTemplate;
    }

    /* ── Inicialización ── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _overrideExisting);
    } else {
        // DOM ya listo (script cargado después del HTML)
        setTimeout(_overrideExisting, 0);
    }

    /* ── Alerta si XLSX no está disponible ── */
    window.addEventListener('load', () => {
        if (typeof XLSX === 'undefined') {
            console.warn('[ExcelImport] SheetJS (XLSX) no detectado. La importación Excel no funcionará. ' +
                'Asegúrate de cargar xlsx.full.min.js ANTES de excel-import.js.');
        }
    });

    /* ══════════════════════════════════════════════════════════════
       HELPER INTERNO: ALERTA NO BLOQUEANTE
       ══════════════════════════════════════════════════════════════ */
    function _eiAlert(msg) {
        if (typeof showToast === 'function') {
            showToast('⚠️', msg);
        } else {
            alert(msg);
        }
    }

})(); // fin ExcelImportModule
