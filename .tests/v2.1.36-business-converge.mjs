function mergeBusinessRegistry(localNegocios, doc) {
    const local = Array.isArray(localNegocios) ? localNegocios : [];
    const remote = doc && Array.isArray(doc.businesses) ? doc.businesses : [];

    const byId = new Map();
    for (const n of local) {
        if (n && n.id) byId.set(n.id, { ...n });
    }
    for (const r of remote) {
        if (!r || !r.id) continue;
        const existing = byId.get(r.id);
        if (existing) {
            // El remoto actualiza datos descriptivos; se conserva createdAt local.
            byId.set(r.id, {
                ...existing,
                nombre: typeof r.nombre === 'string' && r.nombre.trim() ? r.nombre.trim() : existing.nombre,
                rif: typeof r.rif === 'string' ? r.rif : (existing.rif ?? ''),
                direccion: typeof r.direccion === 'string' ? r.direccion : (existing.direccion ?? ''),
                telefono: typeof r.telefono === 'string' ? r.telefono : (existing.telefono ?? ''),
            });
        } else {
            // Sede nueva descubierta por este equipo.
            byId.set(r.id, {
                id: r.id,
                nombre: r.nombre,
                rif: r.rif ?? '',
                direccion: r.direccion ?? '',
                telefono: r.telefono ?? '',
                createdAt: r.createdAt || new Date().toISOString(),
            });
        }
    }
    return [...byId.values()];
}
let cloudDoc = null;
const push = (negocios) => { cloudDoc = { businesses: negocios.map(n => ({ id: n.id, nombre: n.nombre })) }; };
let A = [{ id: 'neg-1', nombre: 'Bodega' }, { id: 'neg-2', nombre: 'Cosméticos' }];
let B = [{ id: 'neg-1', nombre: 'Bodega' }];
push(A);
B = mergeBusinessRegistry(B, cloudDoc);
console.log('T1 B descubre cosméticos:', B.length === 2 ? 'PASS' : 'FAIL');
push(B);
const A2 = mergeBusinessRegistry(A, cloudDoc);
console.log('T2 A sin cambios:', A2.length === 2 ? 'PASS' : 'FAIL');
console.log('T3 convergen:', A2.length === 2 && B.length === 2 ? 'PASS' : 'FAIL');
const same = (a, b) => a.length === b.length && b.every(m => a.some(n => n.id === m.id));
console.log('T4 sin ping-pong:', same(A2, mergeBusinessRegistry(A2, cloudDoc)) ? 'PASS' : 'FAIL');
