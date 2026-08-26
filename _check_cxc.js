const { MongoClient } = require("mongodb");
const uri = "mongodb+srv://1ng3l2c1_db_user:fixpromax2026@fixpromax.xlbpzsu.mongodb.net/fixpromax?appName=FIXPROMAX";

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  console.log("Conectado a MongoDB");
  const db = client.db("fixpromax");
  
  const cols = await db.listCollections().toArray();
  console.log("Colecciones:", cols.map(c => c.name).join(", "));
  
  const doc = await db.collection("databases").findOne({ companyId: "msuuifzwc1tx" });
  if (!doc) {
    console.log("No encontrado con companyId msuuifzwc1tx");
    await client.close();
    return;
  }
  
  const customers = doc.customers || [];
  const receivables = (doc.accountMovements || []).filter(m => m.type === "receivable");
  const custIds = customers.map(c => String(c.id));
  
  console.log("Clientes: " + customers.length);
  console.log("CXC total: " + receivables.length);
  
  const orphans = receivables.filter(r => !custIds.includes(String(r.entityId)));
  console.log("CXC huerfanas (entityId sin cliente): " + orphans.length);
  orphans.forEach(r => console.log("  " + r.number + " | id=" + r.id + " | entityId=" + r.entityId + " | monto=" + r.amount));
  
  const empty = customers.filter(c => {
    const fn = (c.firstName || "").trim();
    const ln = (c.lastName || "").trim();
    return fn === "" && ln === "";
  });
  console.log("Clientes con nombre completamente vacio: " + empty.length);
  empty.forEach(c => console.log("  id=" + c.id + " phone=" + c.phone));
  
  await client.close();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
