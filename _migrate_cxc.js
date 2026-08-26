/**
 * Migración de facturas POS con customerId null:
 * 1. Vincula cada factura POS a su cliente (tomándolo de data.sales)
 * 2. Crea accountMovement receivable para las ventas a crédito que no tienen CxC aún
 * NO elimina nada — solo agrega y actualiza customerId en facturas POS sin cliente.
 */
const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://1ng3l2c1_db_user:fixpromax2026@fixpromax.xlbpzsu.mongodb.net/fixpromax?appName=FIXPROMAX';

function generateId() {
    return Math.random().toString(36).slice(2, 6) + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function main() {
    const client = new MongoClient(uri);
    await client.connect();
    console.log('Conectado a MongoDB');

    const db = client.db('fixpromax');
    const col = db.collection('databases');

    // Leer el documento completo del usuario
    const doc = await col.findOne({ companyId: 'msuuifzwc1tx' });
    if (!doc) { console.log('Empresa no encontrada'); await client.close(); return; }

    const invoices        = doc.invoices        || [];
    const sales           = doc.sales           || [];
    const customers       = doc.customers       || [];
    const accountMovements = doc.accountMovements || [];

    console.log(`Estado inicial:`);
    console.log(`  Facturas:          ${invoices.length}`);
    console.log(`  Ventas:            ${sales.length}`);
    console.log(`  Clientes:          ${customers.length}`);
    console.log(`  AccountMovements:  ${accountMovements.length}`);

    // IDs de CxC ya existentes (por invoiceId o reference)
    const existingInvoiceIds = new Set(
        accountMovements
            .filter(m => m.type === 'receivable')
            .map(m => m.invoiceId || m.reference)
            .filter(Boolean)
    );

    // Facturas POS sin cliente (customerId null/vacío, notes='Venta POS')
    const orphanInvoices = invoices.filter(inv =>
        (inv.customerId === null || inv.customerId === '' || inv.customerId === undefined) &&
        inv.notes === 'Venta POS' &&
        inv.status !== 'Anulada'
    );

    console.log(`\nFacturas POS sin cliente: ${orphanInvoices.length}`);

    let fixedCount    = 0;
    let newCxcCount   = 0;
    let skippedCount  = 0;

    for (const inv of orphanInvoices) {
        // Buscar la venta POS correspondiente por número de factura
        const sale = sales.find(s => s.invoice === inv.number);

        if (!sale) {
            console.log(`  [SKIP] Factura ${inv.number} — no se encontró venta POS asociada`);
            skippedCount++;
            continue;
        }

        const custId = sale.customerId || null;
        const cust   = custId ? customers.find(c => c.id === custId) : null;
        const custName = cust ? `${cust.firstName} ${cust.lastName}`.trim() : '(sin cliente)';
        const isCredit = sale.isCredit === true || sale.method === 'CREDITO' || sale.status === 'Crédito';

        // 1. Actualizar customerId en la factura
        inv.customerId = custId;
        inv.updatedAt  = new Date().toISOString();
        fixedCount++;

        // 2. Si es venta a crédito con cliente y no tiene CxC aún → crear accountMovement
        if (isCredit && custId && !existingInvoiceIds.has(inv.id) && !existingInvoiceIds.has(inv.number)) {
            const saldo = (Number(inv.total) || 0) - (Number(inv.paid) || 0);
            if (saldo > 0.001) {
                const cxcSeq = accountMovements.filter(m => m.type === 'receivable').length + 1;
                const cxcNum = `CXC-${String(cxcSeq).padStart(6, '0')}`;
                const newMov = {
                    id:          generateId(),
                    type:        'receivable',
                    entityId:    custId,
                    number:      cxcNum,
                    date:        inv.date || inv.createdAt?.slice(0,10) || new Date().toISOString().slice(0,10),
                    dueDate:     inv.dueDate || new Date(Date.now() + 30*86400000).toISOString().slice(0,10),
                    concept:     `Venta POS ${inv.number}`,
                    description: '',
                    reference:   inv.number,
                    invoiceId:   inv.id,
                    amount:      Number(inv.total) || 0,
                    currency:    inv.currency || 'USD',
                    paid:        Number(inv.paid) || 0,
                    status:      Number(inv.paid) >= Number(inv.total) ? 'Pagado' : 'Pendiente',
                    notes:       'Migrado automáticamente desde venta POS a crédito',
                    source:      'pos',
                    createdAt:   inv.createdAt || new Date().toISOString(),
                    updatedAt:   new Date().toISOString(),
                    payments:    [],
                };
                accountMovements.push(newMov);
                existingInvoiceIds.add(inv.id);
                newCxcCount++;
                console.log(`  [CXC]  ${inv.number} → cliente: ${custName} | monto: ${inv.total} ${inv.currency || 'USD'} → ${cxcNum}`);
            } else {
                console.log(`  [OK-PAID] ${inv.number} → cliente: ${custName} | ya pagado, no se crea CxC`);
            }
        } else if (!isCredit) {
            console.log(`  [FIX]  ${inv.number} → cliente: ${custName || 'sin cliente'} | venta contado, solo se fija customerId`);
        } else if (existingInvoiceIds.has(inv.id) || existingInvoiceIds.has(inv.number)) {
            console.log(`  [SKIP-CXC] ${inv.number} → ya tiene CxC registrada`);
        }
    }

    console.log(`\nResumen:`);
    console.log(`  Facturas corregidas (customerId):  ${fixedCount}`);
    console.log(`  CxC nuevas creadas:                ${newCxcCount}`);
    console.log(`  Facturas sin venta asociada:       ${skippedCount}`);
    console.log(`  AccountMovements total ahora:      ${accountMovements.length}`);

    if (fixedCount === 0 && newCxcCount === 0) {
        console.log('\nNada que migrar, todos los datos ya están correctos.');
        await client.close();
        return;
    }

    // Guardar todo de vuelta — solo se modificaron invoices y accountMovements
    const result = await col.updateOne(
        { companyId: 'msuuifzwc1tx' },
        { $set: {
            invoices:         invoices,
            accountMovements: accountMovements,
            updatedAt:        new Date().toISOString(),
        }}
    );

    console.log(`\nMongoDB actualizado: matched=${result.matchedCount} modified=${result.modifiedCount}`);
    console.log('Migración completada exitosamente.');
    await client.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
