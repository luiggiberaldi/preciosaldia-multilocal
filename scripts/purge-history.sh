#!/usr/bin/env bash
# scripts/purge-history.sh — Purga de binarios y PII del historial de git.
#
# ISSUES cubiertos: INFRA-023 / INFRA-001
#
# Este script NO toca el working tree (los archivos siguen existiendo
# localmente). Solo reescribe el historial de git para eliminar los
# binarios (~13 MB de PDFs, .xls, .mp4, frames/, verify_financials.py)
# y los secretos comprometidos previamente.
#
# ⚠️ AVISO: Reescribe todos los commits y cambia todos los hashes.
# Coordina con el equipo: tras el force-push, cada clon debe hacer:
#   git fetch origin && git reset --hard origin/main
# Las PRs abiertas pueden quedar en estado inconsistente.

set -euo pipefail

REPO_DIR="${1:-.}"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "ERROR: $REPO_DIR no es un repo git." >&2
  exit 1
fi

cd "$REPO_DIR"

# 0. Verificar que git-filter-repo esté instalado.
if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "ERROR: git-filter-repo no está instalado." >&2
  echo "Instálalo con:" >&2
  echo "  pipx install git-filter-repo   (recomendado)" >&2
  echo "  pip install --user git-filter-repo" >&2
  exit 1
fi

# 1. Backup de seguridad (por si acaso).
BACKUP_DIR="$(realpath "$REPO_DIR").bak.$(date +%Y%m%d%H%M%S)"
echo "→ Creando backup en $BACKUP_DIR ..."
cp -r "$REPO_DIR" "$BACKUP_DIR"

# 2. Lista de paths a eliminar completamente del historial.
#    (Estos archivos están en .gitignore pero siguen en commits antiguos.)
PATHS_TO_REMOVE=(
  "cierre_2026-03-25.pdf"
  "inventario 23.xls"
  "WhatsApp Video 2026-03-23 at 5.42.44 PM.mp4"
  "frames/"
  "verify_financials.py"
  "check_discrepancies.py"
  "extract_frames.py"
  "find_numbers.py"
  "modularize_settings.py"
  "parse_pdf.py"
  "cierre_text.txt"
  "dir_output.txt"
  "logo .png"
  "logodark (2).png"
  "Manual Completo de Usuario _ TasasAlDía Business VIP.json"
  "TERMINOS_Y_CONDICIONES.md"
)

# 3. Strings a redactar en cualquier archivo que se conserve en el historial.
#    (Secretos comprometidos — INFRA-001.)
SECRETS_FILE="$(mktemp)"
cat > "$SECRETS_FILE" <<'EOF'
Lvbp1994==>REDACTED_GOOGLE_SCRIPT_TOKEN
F1a3af26247a97a33ee5ad90==>REDACTED_EXCHANGERATE_KEY
fgzwmwrugerptfqfrsjd==>REDACTED_SUPABASE_PROJECT
ewwszyzzvoweudholmbf==>REDACTED_SUPABASE_PROJECT
jjbzevntreoxpuofgkyi==>REDACTED_SUPABASE_PROJECT
EOF

echo "→ Eliminando paths del historial: ${PATHS_TO_REMOVE[*]}"
git filter-repo \
  --invert-paths \
  --path "${PATHS_TO_REMOVE[@]/#/--path }" \
  --replace-text "$SECRETS_FILE" \
  --force

rm -f "$SECRETS_FILE"

# 4. Garbage collection agresiva para liberar espacio.
echo "→ Ejecutando gc agresivo ..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 5. Verificación final.
echo ""
echo "✓ Historial reescrito. Verificación:"
echo ""
echo "  A) Buscar secretos restantes:"
if git log --all -p | grep -E 'Lvbp1994|F1a3af26247a97a33ee5ad90|fgzwmwrugerptfqfrsjd|ewwszyzzvoweudholmbf|jjbzevntreoxpuofgkyi'; then
  echo "  ⚠️  Aún hay secretos en el historial — revisar manualmente."
else
  echo "  ✓ OK: ningún secreto encontrado."
fi

echo ""
echo "  B) Buscar binarios restantes:"
if git log --all --name-only | grep -E '\.(pdf|xls|mp4|mov)$|^frames/'; then
  echo "  ⚠️  Aún hay binarios en el historial — revisar manualmente."
else
  echo "  ✓ OK: ningún binario encontrado."
fi

echo ""
echo "  C) Tamaño del repo:"
du -sh .git

echo ""
echo "Próximos pasos:"
echo "  1. Revisar el backup en $BACKUP_DIR por si necesitas recuperar algo."
echo "  2. Forzar el push al remoto:"
echo "       git push --force --mirror"
echo "  3. Cada clon del equipo debe hacer:"
echo "       git fetch origin && git reset --hard origin/main"
echo "  4. Una vez confirmado, borrar el backup:"
echo "       rm -rf $BACKUP_DIR"
