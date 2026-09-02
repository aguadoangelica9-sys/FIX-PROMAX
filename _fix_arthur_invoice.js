/**
 * Script para restaurar la factura INV-461946 de Arthur Moura
 * en la cuenta isuzuimport2025@gmail.com (companyId: 8defc0952f47c9c6855a479)
 *
 * La factura fue anulada accidentalmente. La venta sigue activa (Crédito).
 * Este script cambia el status de "Anulada" a "Pendiente" y la
 * agrega también como accountMovement si no existe.
 */

require('dotenv').config();
const DB = require('./db-mongo');

const COMPANY_ID  = '8defc0952f47c9c6855a479';
const INV_NUMBER  = 'INV-461946';
const CUSTOMER_ID = 'mtfywtff2t6s'; // ARTHUR MOURA
const SALE_ID     = 'mtjegz7eu87m';

async function main() {
    await DB.connectDB();
    console.log('✅ Conectado a MongoDB');

    const db = await DB.readCompanyDB(COMPANY_ID);

    // ── 1. Buscar la factura ──────────────────────────────────────────────────
    const invIdx = (db.invoices || []).findIndex(i => i.number === INV_NUMBER);

    if (invIdx === -1) {
        // La factura no existe — crearla desde la venta
        console.log('⚠️  Factura no encontrada, creando desde la venta...');
        const sale = (db.sales || []).find(s => s.id === SALE_ID);
        if (!sale) { console.error('❌ Venta tampoco encontrada'); process.exit(1); }

        const newInv = {
            id:          'mtjegz7mjx13',
            number:      INV_NUMBER,
            customerId:  CUSTOMER_ID,
            date:        '2026-09-02',
            dueDate:     '2026-10-02',
            items:       sale.items || [],
            subtotal:    sale.subtotal || sale.total || 0,
            lineDiscount:    sale.lineDiscount    || 0,
            generalDiscount: sale.generalDiscount || 0,
            discount:    sale.discount    || 0,
            discountPct: sale.discountPct || 0,
            discountType: sale.discountType || 'pct',
            tax:         sale.tax   || 0,
            total:       sale.total || 2422,
            paid:        sale.paid  || 0,
            notes:       'Venta POS',
            source:      'pos',
            status:      'Pendiente',
            currency:    'USD',
            createdAt:   '2026-09-02T01:11:01.954Z',
            updatedAt:   new Date().toISOString(),
        };
        if (!Array.isArray(db.invoices)) db.invoices = [];
        db.invoices.push(newInv);
        console.log('✅ Factura creada con status Pendiente');
    } else {
        // La factura existe — restaurar status
        const inv = db.invoices[invIdx];
        console.log(`📄 Factura encontrada: status actual = "${inv.status}"`);
        if (inv.status === 'Anulada') {
            db.invoices[invIdx].status    = 'Pendiente';
            db.invoices[invIdx].updatedAt = new Date().toISOString();
            console.log('✅ Status cambiado: Anulada → Pendiente');
        } else {
            console.log(`ℹ️  Status ya es "${inv.status}", no se modifica`);
        }
    }

    // ── 2. Verificar/crear accountMovement para CxC ───────────────────────────
    if (!Array.isArray(db.accountMovements)) db.accountMovements = [];

    const movExists = db.accountMovements.some(
        m => m.type === 'receivable' && (m.invoiceId === 'mtjegz7mjx13' || m.reference === INV_NUMBER)
    );

    if (!movExists) {
        db.accountMovements.push({
            id:          'mtjegz7mjx13_mov',
            type:        'receivable',
            entityId:    CUSTOMER_ID,
            legacyId:    'mtjegz7mjx13',
            invoiceId:   'mtjegz7mjx13',
            number:      INV_NUMBER,
            date:        '2026-09-02',
            dueDate:     '2026-10-02',
            concept:     'Venta POS - Crédito',
            description: '',
            reference:   INV_NUMBER,
            amount:      2422,
            currency:    'USD',
            paid:        0,
            status:      'Pendiente',
            notes:       'Venta POS a crédito — ARTHUR MOURA',
            source:      'pos',
            createdAt:   '2026-09-02T01:11:01.954Z',
            updatedAt:   new Date().toISOString(),
            payments:    [],
        });
        console.log('✅ AccountMovement CxC creado para Arthur Moura');
    } else {
        console.log('ℹ️  AccountMovement ya existe');
    }

    // ── 3. Guardar en MongoDB ─────────────────────────────────────────────────
    await DB.writeCompanyDB(COMPANY_ID, db);
    console.log('✅ Datos guardados en MongoDB');

    // ── 4. Verificación final ─────────────────────────────────────────────────
    const dbCheck = await DB.readCompanyDB(COMPANY_ID);
    const invCheck = (dbCheck.invoices || []).find(i => i.number === INV_NUMBER);
    const movCheck = (dbCheck.accountMovements || []).find(m => m.reference === INV_NUMBER);
    console.log('\n=== VERIFICACIÓN FINAL ===');
    console.log(`Factura ${INV_NUMBER}: status=${invCheck?.status ?? 'NO ENCONTRADA'}`);
    console.log(`AccountMovement: ${movCheck ? 'EXISTE' : 'NO ENCONTRADO'}`);
    console.log('==========================\n');

    process.exit(0);
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
