const http = require('http');
const fs   = require('fs');
const PORT = 3000;

function req(method, path, body, token) {
    return new Promise(resolve => {
        const b = body ? JSON.stringify(body) : '';
        const h = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) };
        if (token) h['Authorization'] = 'Bearer ' + token;
        const r = http.request({ hostname: 'localhost', port: PORT, path, method, headers: h }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve({ st: res.statusCode, j: JSON.parse(d) }); } catch { resolve({ st: res.statusCode, j: {} }); } });
        });
        r.on('error', e => resolve({ st: 0, j: { error: e.message } }));
        if (b) r.write(b); r.end();
    });
}
const log = (ok, label, detail) => console.log((ok?'✅':'❌')+' '+label+(detail?' — '+detail:''));

async function run() {
    console.log('\n🧪 TEST SISTEMA MULTIUSUARIO\n' + '─'.repeat(55));

    // Login propietario (admin)
    const L = await req('POST', '/api/auth/login', { email: 'aguadoangelica9@gmail.com', password: '123456' });
    log(L.j.ok, 'Login propietario', L.j.ok ? 'companyId='+L.j.data?.user?.companyId : L.j.error);
    const ownerTok = L.j.data?.token;
    const companyId = L.j.data?.user?.companyId;
    if (!ownerTok) { console.log('Sin token, abortando'); process.exit(1); }

    // Ver empresa
    const C = await req('GET', '/api/team/company', null, ownerTok);
    log(C.j.ok, 'GET /api/team/company', C.j.ok ? `${C.j.data.memberCount}/${C.j.data.maxMembers} miembros` : C.j.error);

    // Ver equipo actual
    const T = await req('GET', '/api/team/members', null, ownerTok);
    log(T.j.ok, 'GET /api/team/members', T.j.ok ? T.j.data.count+' miembros' : T.j.error);
    const initialCount = T.j.data?.count || 0;

    // Invitar empleado nuevo
    const emp1Email = 'emp_test_'+Date.now()+'@test.com';
    const I = await req('POST', '/api/team/invite', { name:'Empleado Test', email: emp1Email, password:'emp123456', permissions: null }, ownerTok);
    log(I.j.ok, 'Invitar empleado', I.j.ok ? 'id='+I.j.data.id : I.j.error);
    const empId = I.j.data?.id;

    // Login empleado
    const EL = await req('POST', '/api/auth/login', { email: emp1Email, password: 'emp123456' });
    log(EL.j.ok, 'Login empleado', EL.j.ok ? 'teamRole='+EL.j.data?.user?.teamRole : EL.j.error);
    const empTok = EL.j.data?.token;

    // Empleado no puede invitar (sin permisos)
    const EA = await req('POST', '/api/team/invite', { name:'X', email:'x@x.com', password:'123456' }, empTok);
    log(!EA.j.ok && EA.st===403, 'Empleado bloqueado de invitar (403)', 'st='+EA.st);

    // Empleado no puede ver /api/team/devices
    const ED = await req('GET', '/api/team/devices', null, empTok);
    log(!ED.j.ok && ED.st===403, 'Empleado bloqueado de ver dispositivos (403)', 'st='+ED.st);

    // Propietario ve dispositivos (sesiones del equipo)
    const DEV = await req('GET', '/api/team/devices', null, ownerTok);
    log(DEV.j.ok, 'Propietario ve dispositivos', DEV.j.ok ? DEV.j.data.length+' sesiones' : DEV.j.error);

    // Actualizar permisos del empleado
    if (empId) {
        const UP = await req('PUT', `/api/team/members/${empId}/permissions`,
            { inventory:{view:true,create:true,edit:false,delete:false,import:false}, sales:{view:true,create:true,edit:false,cancel:false}, invoices:{view:false,create:false,edit:false,cancel:false}, expenses:{view:true,create:false,edit:false,delete:false}, reports:{view:true,export:false}, accounting:{view:false,edit:false}, users:{view:false,create:false,edit:false} },
            ownerTok);
        log(UP.j.ok, 'Actualizar permisos empleado', UP.j.ok ? 'OK' : UP.j.error);
    }

    // Suspender empleado
    if (empId) {
        const S = await req('POST', `/api/team/members/${empId}/action`, { action:'suspend' }, ownerTok);
        log(S.j.ok, 'Suspender empleado', S.j.ok ? 'active='+S.j.data.active : S.j.error);

        // Intentar login del empleado suspendido
        const ELS = await req('POST', '/api/auth/login', { email: emp1Email, password: 'emp123456' });
        // El login puede fallar con "cuenta desactivada" o funcionar (el servidor revoca sesiones)
        log(!ELS.j.ok || ELS.st !== 200, 'Empleado suspendido no puede acceder', 'st='+ELS.st+' ok='+ELS.j.ok);

        // Reactivar
        const R = await req('POST', `/api/team/members/${empId}/action`, { action:'reactivate' }, ownerTok);
        log(R.j.ok, 'Reactivar empleado', R.j.ok ? 'OK' : R.j.error);
    }

    // Verificar límite de 5 usuarios
    // Contar el equipo actual y ver si el límite aplica
    const T2 = await req('GET', '/api/team/members', null, ownerTok);
    log(T2.j.ok, 'Ver equipo actualizado', T2.j.ok ? T2.j.data.count+'/'+T2.j.data.max+' miembros' : T2.j.error);

    // Eliminar empleado de prueba
    if (empId) {
        const RM = await req('POST', `/api/team/members/${empId}/action`, { action:'remove' }, ownerTok);
        log(RM.j.ok, 'Eliminar empleado de prueba', RM.j.ok ? 'OK' : RM.j.error);
    }

    // Verificar que la BD de la empresa existe
    const dbExists = fs.existsSync(`db_${companyId}.json`);
    log(dbExists, 'BD de empresa existe: db_'+companyId+'.json');

    // Verificar que GET /api/db ahora requiere auth
    const DB = await req('GET', '/api/db');
    log(DB.st === 401, 'GET /api/db requiere auth (401)', 'st='+DB.st);

    // Verificar que el propietario puede leer su BD
    const DB2 = await req('GET', '/api/db', null, ownerTok);
    log(DB2.j.ok, 'Propietario lee su BD (autenticado)', DB2.j.ok ? 'productos='+DB2.j.data?.products?.length : DB2.j.error);

    // Actividad
    const ACT = await req('GET', '/api/team/activity', null, ownerTok);
    log(ACT.j.ok, 'Actividad del equipo', ACT.j.ok ? ACT.j.data.length+' entradas' : ACT.j.error);

    console.log('\n' + '─'.repeat(55));
    console.log('✅ Tests completados');
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
