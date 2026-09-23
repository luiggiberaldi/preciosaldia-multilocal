# Rotación de Secretos — Procedimiento

> **Issue:** INFRA-001 / SEC-002
>
> Procedimiento para rotar las tres credenciales que estaban comprometidas en el
> historial del repositorio (anon key de Supabase, token de Google Script, key de
> Exchangerate). **Ejecutar este documento cada vez que se sospeche un leak o como
> parte de la rotación periódica (recomendado: cada 6 meses).

---

## 0. Pre-requisitos

- `git` ≥ 2.30 y [`git-filter-repo`](https://github.com/newren/git-filter-repo) instalado:
  ```bash
  pipx install git-filter-repo
  # o
  pip install --user git-filter-repo
  ```
- Acceso admin a los respectivos dashboards:
  - Supabase → `https://supabase.com/dashboard/project/<project-id>/settings/api`
  - Google Apps Script → `https://script.google.com/home/projects/<script-id>/`
  - Exchangerate.host (o similar) → panel de la API key
- Coordinación con los usuarios activos del POS: la rotación invalida todas las
  sesiones y obliga a redesplegar y reconfigurar cada dispositivo.

---

## 1. Rotación Supabase anon key (Proyectos `fgzwmwrugerptfqfrsjd`, `ewwszyzzvoweudholmbf`, `jjbzevntreoxpuofgkyi`)

> El JWT de la `anon key` tiene `exp` 10 años. Aunque sea pública por diseño
> (RLS debe proteger los datos), la rotamos porque previamente estuvo acompañada
> de políticas `USING(true)` que exponían todo.

1. **Aplicar el hardening de RLS PRIMERO** (sin esto, la nueva anon key queda igual
   de expuesta que la anterior). Ejecutar en orden en el SQL Editor de Supabase:
   - `supabase_cloud_schema.sql` (en el proyecto cloud `ewwszyzzvoweudholmbf`)
   - `supabase_rls_hardening.sql` (sección A en el cloud, sección B en `jjbzevntreoxpuofgkyi`)
   - `db_estacion_maestra_setup.sql` (en el proyecto de licencias)
2. **Rotar la anon key** en `Dashboard → Settings → API → "Rotate anon key"`.
3. **Actualizar `.env`** local y los secretos de Cloudflare (`wrangler secret put`):
   ```bash
   wrangler secret put VITE_SUPABASE_ANON_KEY
   wrangler secret put VITE_SUPABASE_CLOUD_KEY
   ```
4. **Redesplegar**:
   ```bash
   bun run build && wrangler deploy
   ```
5. **Verificar** que un `SELECT * FROM sync_documents` con la nueva anon key sin
   auth devuelve `[]` (RLS bloquea). Si devuelve datos, las políticas siguen
   abiertas — revisar paso 1.

---

## 2. Rotación del token de Google Apps Script

> El Apps Script alimenta `/api/rates` desde una hoja con tasas BCV. El token
> `Lvbp1994` estaba en `vite.config.js` y en `.env.example`.

1. Abrir el proyecto de Apps Script → `Configuración → Propiedades del script`.
2. Cambiar la propiedad `TOKEN` (o equivalente) por un nuevo valor aleatorio:
   ```bash
   NEW_TOKEN=$(openssl rand -hex 24)
   echo "Nuevo token: $NEW_TOKEN"
   ```
3. Actualizar la hoja de cálculo / Apps Script para que valide contra el nuevo
   token.
4. Actualizar `VITE_GOOGLE_SCRIPT_URL` en `.env` (local) y en Cloudflare:
   ```bash
   wrangler secret put VITE_GOOGLE_SCRIPT_URL
   ```
5. Redesplegar worker y web.

---

## 3. Rotación de Exchangerate key

1. En el panel del proveedor (exchangerate.host / open.er-api.com / similar):
   revocar la key actual y generar una nueva.
2. Actualizar `VITE_EXCHANGERATE_KEY` en `.env` y en Cloudflare:
   ```bash
   wrangler secret put VITE_EXCHANGERATE_KEY
   ```
3. Probar: `curl "https://api.exchangerate.host/live?access_key=$NEW_KEY&source=USD"`

---

## 4. Purgar el historial de git (OBLIGATORIO la primera vez)

> Aunque `.env.example` ya está sanitizado, los commits antiguos siguen
> conteniendo los secretos. Cualquiera que clone el repo los puede leer con
> `git log -p`. Este paso reescribe el historial.

**⚠️ AVISO:** Esto reescribe todos los commits y cambia todos los hashes. Coordina
con el equipo: tendrán que hacer `git fetch && git reset --hard origin/main`
después del force push. Las PRs abiertas pueden quedar en estado inconsistente.

```bash
# 1. Hacer backup completo del repo (por si acaso):
cp -r /path/to/preciosaldia-bodega /path/to/preciosaldia-bodega.bak

# 2. Clonar fresh para evitar conflicto con worktrees:
cd /tmp
git clone --mirror <repo-url> preciosaldia-bodega.git
cd preciosaldia-bodega.git

# 3. Crear un archivo de patrones a purgar:
cat > /tmp/secrets-to-purge.txt <<'EOF'
.gitignore
.env.example
EOF

# 4. Reescribir el historial borrando el path completo (todas las versiones):
git filter-repo --invert-paths --path .env.example --force

# 5. (Alternativa) Reemplazar strings específicos en todos los commits:
#    Útil si la key aparece en vite.config.js u otros archivos que sí queremos
#    conservar en el historial.
git filter-repo --replace-text <(echo \
  'Lvbp1994==>REDACTED_TOKEN
   F1a3af26247a97a33ee5ad90==>REDACTED_EXCHANGERATE_KEY
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9==>REDACTED_SUPABASE_ANON_JWT')

# 6. Forzar el push:
git push --force --mirror

# 7. En el repo de trabajo local:
cd /path/to/preciosaldia-bodega
git fetch origin
git reset --hard origin/main
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Para auditoría binaria (PDFs, .xls, videos — INFRA-023), ver
`scripts/purge-history.sh`.

---

## 5. Verificación final

```bash
# A) Confirmar que no quedan secretos en el historial:
git log --all -p | grep -E 'Lvbp1994|F1a3af26247a97a33ee5ad90|fgzwmwrugerptfqfrsjd' || echo "OK: limpio"

# B) Confirmar que .env.example no tiene valores reales:
grep -E '(Lvbp1994|F1a3af26|eyJ)' .env.example && echo "FAIL: secretos en .env.example" || echo "OK"

# C) Confirmar que el worker responde con la nueva config:
curl -s https://<worker-domain>/api/rates | jq .bcv.price
```

---

## 6. Comunicación

- Avisar a todos los operadores del POS que la app se actualizará y que si tienen
  sesión abierta, deberán re-autenticarse.
- Documentar la fecha de rotación en el CHANGELOG interno.
- Programar la siguiente rotación en el calendario (6 meses).
