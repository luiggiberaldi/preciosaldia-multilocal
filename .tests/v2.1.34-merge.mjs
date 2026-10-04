function mergeUserCatalog(localUsers, doc) {
    const local = Array.isArray(localUsers) ? localUsers : [];
    const remoteUsers = doc && Array.isArray(doc.users) ? doc.users : [];
    const deletedIds = new Set(
        (doc && Array.isArray(doc.deleted) ? doc.deleted : [])
            .map(d => d && d.id)
            .filter(id => id != null)
    );

    const localByUid = new Map();
    const localById = new Map();
    for (const u of local) {
        if (!u) continue;
        if (u.uid) localByUid.set(u.uid, u);
        if (u.id != null) localById.set(u.id, u);
    }
    let nextId = local.reduce((m, u) => Math.max(m, Number(u?.id) || 0), 0);
    // Ids numéricos ocupados (locales + asignados en este merge): jamás se
    // reutilizan dentro del merge para no pisar a otro usuario.
    const takenIds = new Set(localById.keys());
    const seenRemoteIds = new Set();
    const mergedById = new Map();

    const pushMerged = (u) => {
        if (!u || u.id == null) return;
        mergedById.set(u.id, u);
        takenIds.add(u.id);
    };

    const allocId = (preferred) => {
        let id = preferred;
        while (id == null || takenIds.has(id)) {
            nextId += 1;
            id = nextId;
        }
        return id;
    };

    for (const r of remoteUsers) {
        if (!r || r.id == null || deletedIds.has(r.id) || seenRemoteIds.has(r.id)) continue;
        seenRemoteIds.add(r.id);

        // 1) Match por uid: es el mismo usuario aunque lo hayan renombrado.
        //    El PIN local se conserva; nombre/rol/requirePin remotos ganan.
        const byUid = (r.uid && localByUid.get(r.uid)) || null;
        if (byUid) {
            pushMerged({
                ...byUid,
                nombre: typeof r.nombre === 'string' ? r.nombre : byUid.nombre,
                rol: typeof r.rol === 'string' ? r.rol : byUid.rol,
                requirePin: r.requirePin !== false,
            });
            continue;
        }

        // 2) Fallback legacy (sin uid en ningún lado): solo si id + nombre
        //    coinciden se considera el mismo usuario.
        if (!r.uid) {
            const byId = localById.get(r.id);
            if (byId && !byId.uid && byId.nombre === r.nombre && !mergedById.has(byId.id)) {
                pushMerged({
                    ...byId,
                    rol: typeof r.rol === 'string' ? r.rol : byId.rol,
                    requirePin: r.requirePin !== false,
                });
                continue;
            }
        }

        // 2b) Fallback equipo nuevo: el usuario local (creado por defecto con
        //     uid aleatorio) y el remoto son el mismo si coinciden nombre+rol
        //     y el local aún no fue fusionado. Adopta el uid remoto para que
        //     futuros merges lo reconozcan por uid.
        if (r.uid) {
            const byNameRol = local.find(u =>
                u && u.id != null &&
                !mergedById.has(u.id) &&
                u.nombre === r.nombre &&
                u.rol === r.rol
            );
            if (byNameRol) {
                pushMerged({
                    ...byNameRol,
                    uid: r.uid,
                    nombre: typeof r.nombre === 'string' ? r.nombre : byNameRol.nombre,
                    rol: typeof r.rol === 'string' ? r.rol : byNameRol.rol,
                    requirePin: r.requirePin !== false,
                });
                continue;
            }
        }

        // 3) Usuario nuevo para este equipo: entra con `pinPendiente: true`.
        //    Si su id numérico ya está ocupado, se le asigna uno libre
        //    (el uid lo identifica de forma estable entre equipos).
        pushMerged({
            id: allocId(r.id),
            ...(r.uid ? { uid: r.uid } : {}),
            nombre: r.nombre,
            rol: r.rol,
            requirePin: r.requirePin !== false,
            pin: null,
            pinPendiente: true,
        });
    }

    for (const u of local) {
        if (!u || u.id == null) continue;
        if (deletedIds.has(u.id)) continue;      // borrado propagado
        if (mergedById.has(u.id)) continue;      // ya fusionado arriba
        pushMerged(u);                           // creación local aún no vista
    }

    return [...mergedById.values()];
}

function buildBusinessRegistryDoc(negocios) {
    const list = Array.isArray(negocios) ? negocios : [];
    return {
        businesses: list
            .filter(n => n && typeof n.id === 'string' && n.id)
            .map(n => ({
                id: n.id,
                nombre: String(n.nombre ?? '').trim() || 'Mi negocio',
                rif: String(n.rif ?? '').trim(),
                direccion: String(n.direccion ?? '').trim(),
                telefono: String(n.telefono ?? '').trim(),
                createdAt: n.createdAt || null,
            })),
        updatedAt: new Date().toISOString(),
    };
}

function isValidBusinessRegistryDoc(doc) {
    if (!doc || typeof doc !== 'object') return false;
    if (!Array.isArray(doc.businesses)) return false;
    return doc.businesses.every(b =>
        b && typeof b.id === 'string' && b.id &&
        typeof b.nombre === 'string'
    );
}

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

const local = [
  { id: 1, uid: 'local-aaa', nombre: 'Administrador', rol: 'administrador', pin: 'hash1' },
  { id: 2, uid: 'local-bbb', nombre: 'Cajero', rol: 'cajero', pin: 'hash2' },
];
const doc = { users: [
  { id: 1, uid: 'nube-xxx', nombre: 'Administrador', rol: 'administrador' },
  { id: 2, uid: 'nube-yyy', nombre: 'Cajero', rol: 'cajero' },
], deleted: [] };
const m1 = mergeUserCatalog(local, doc);
console.log('T1 fusiona 2 no 4:', m1.length === 2 ? 'PASS' : 'FAIL(' + m1.length + ')');
console.log('T1 adopta uid nube:', m1[0].uid === 'nube-xxx' ? 'PASS' : 'FAIL');
console.log('T1 conserva PIN:', m1[0].pin === 'hash1' ? 'PASS' : 'FAIL');
const m2 = mergeUserCatalog(local, { users: [{ id: 5, uid: 'nube-zzz', nombre: 'Pedro', rol: 'cajero' }], deleted: [] });
console.log('T2 agrega distinto:', m2.length === 3 ? 'PASS' : 'FAIL');
const m3 = mergeBusinessRegistry([{ id: 'neg-1', nombre: 'Bodega' }],
  { businesses: [{ id: 'neg-1', nombre: 'Bodega' }, { id: 'neg-2', nombre: 'Cosméticos', rif: 'J-123' }] });
console.log('T3 descubre sede:', m3.length === 2 && m3[1].rif === 'J-123' ? 'PASS' : 'FAIL');
const built = buildBusinessRegistryDoc([{ id: 'neg-1', nombre: 'Bodega', pin: 'secreto' }]);
console.log('T4 válido:', isValidBusinessRegistryDoc(built) ? 'PASS' : 'FAIL');
console.log('T4 sin secretos:', JSON.stringify(built).includes('secreto') ? 'FAIL' : 'PASS');
const m5 = mergeUserCatalog(
  [{ id: 1, uid: 'u1', nombre: 'Admin', rol: 'administrador', pin: 'h' }],
  { users: [{ id: 1, uid: 'u1', nombre: 'Jefe', rol: 'administrador' }], deleted: [] });
console.log('T5 renombrado por uid:', m5.length === 1 && m5[0].nombre === 'Jefe' ? 'PASS' : 'FAIL');
