"""Build private offline stock baselines for the isolated AtomicSale sandbox.

This tool never connects to a service, writes operational data, or selects a
Cosméticos snapshot by timestamp. It accepts Cosméticos only when every saved
stock-map document agrees exactly. Output contains product IDs and stock values;
keep it private and outside the repository.
"""
import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_SCRIPT = ROOT / "scripts" / "reconcile_backups_readonly.py"
EVIDENCE_SPEC = importlib.util.spec_from_file_location("reconcile_backups_readonly", EVIDENCE_SCRIPT)
evidence = importlib.util.module_from_spec(EVIDENCE_SPEC)
EVIDENCE_SPEC.loader.exec_module(evidence)

ID_PATTERN = evidence.re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
MICRO_UNITS = Decimal(1_000_000)
BODEGA_ID = "neg-1"
COSMETICS_ID = "neg-fac22061"
ACCOUNT_ID = "offline-baseline-audit"


class BaselineError(ValueError):
    """Safe error token; never embed source data in an error."""


def input_hash(path):
    return evidence.file_hash(path)


def stock_units(value, *, allow_negative=False):
    if isinstance(value, bool) or value is None:
        raise BaselineError("invalid_stock_value")
    try:
        quantity = Decimal(str(value))
        scaled = quantity * MICRO_UNITS
    except (InvalidOperation, ValueError, TypeError):
        raise BaselineError("invalid_stock_value") from None
    if (not quantity.is_finite() or (quantity < 0 and not allow_negative)
            or scaled != scaled.to_integral_value()):
        raise BaselineError("stock_out_of_range_or_precision")
    return str(int(scaled))


def safe_product_id(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise BaselineError("invalid_product_id")
    product_id = str(value)
    if not ID_PATTERN.fullmatch(product_id):
        raise BaselineError("unsupported_product_id_format")
    return product_id


def backup_bodega_stock(backup):
    if not isinstance(backup, dict) or not isinstance(backup.get("data"), dict):
        raise BaselineError("unsupported_backup")
    if backup.get("appName") not in {None, "TasasAlDia_Bodegas", "TasasAlDia_Bodegas_Cloud"}:
        raise BaselineError("foreign_app_backup_not_allowed")
    data = backup["data"]
    idb = data.get("idb", data if backup.get("version") != "2.0" else None)
    if not isinstance(idb, dict):
        raise BaselineError("missing_backup_idb")
    candidates = []
    for key, value in idb.items():
        namespace, base_key = evidence.namespaced_key(key)
        if base_key != "bodega_products_v1":
            continue
        if namespace not in (None, BODEGA_ID):
            continue
        value = evidence.decoded(value)
        if not isinstance(value, list):
            raise BaselineError("invalid_bodega_catalog")
        candidates.append((namespace, value))
    if not candidates:
        raise BaselineError("bodega_products_not_found")
    if len(candidates) != 1:
        raise BaselineError("ambiguous_bodega_backup_catalog")
    namespace, products = candidates[0]
    stock = {}
    for product in products:
        if not isinstance(product, dict) or "id" not in product or "stock" not in product:
            raise BaselineError("bodega_product_missing_id_or_stock")
        product_id = safe_product_id(product["id"])
        if product_id in stock:
            raise BaselineError("duplicate_bodega_product_id")
        stock[product_id] = stock_units(product["stock"], allow_negative=True)
    if not stock:
        raise BaselineError("empty_bodega_baseline")
    return stock, {"mapping": "owner_asserted_backup_is_bodega", "namespacePresent": namespace is not None,
                   "productCount": len(stock), "sourceKey": "bodega_products_v1"}


def cosmetics_consensus_stock(rows):
    by_device = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("collection") != "store":
            continue
        doc_id = row.get("doc_id")
        namespace, key = evidence.namespaced_key(doc_id)
        if namespace != COSMETICS_ID or key != "bodega_stock_v1":
            continue
        device_id = row.get("device_id")
        if not isinstance(device_id, str) or not device_id:
            raise BaselineError("cosmetics_stock_missing_device")
        if device_id in by_device:
            raise BaselineError("duplicate_cosmetics_stock_document_per_device")
        envelope = row.get("data")
        if not isinstance(envelope, dict) or envelope.get("schemaVersion", 1) != 1:
            raise BaselineError("invalid_cosmetics_stock_envelope")
        payload = envelope.get("payload")
        if not isinstance(payload, dict) or not payload:
            raise BaselineError("invalid_or_empty_cosmetics_stock_map")
        stock = {}
        for product_id, value in payload.items():
            stock[safe_product_id(product_id)] = stock_units(value)
        by_device[device_id] = stock
    if len(by_device) < 2:
        raise BaselineError("insufficient_cosmetics_stock_replicas")
    device_maps = list(by_device.values())
    reference = device_maps[0]
    if any(stock != reference for stock in device_maps[1:]):
        raise BaselineError("cosmetics_stock_snapshots_disagree_no_baseline_selected")
    return reference, {"mapping": "unanimous_saved_supabase_stock_maps", "replicaCount": len(by_device),
                      "uniqueSnapshotCount": 1, "productCount": len(reference),
                      "selection": "exact_map_agreement_not_timestamp"}


def make_baselines(backup, backup_path, dump_path, dump_rows):
    bodega_stock, bodega_evidence = backup_bodega_stock(backup)
    cosmetics_stock, cosmetics_evidence = cosmetics_consensus_stock(dump_rows)
    backup_fingerprint = input_hash(backup_path)
    dump_fingerprint = input_hash(dump_path)
    baselines = [
        {"version": 1, "accountId": ACCOUNT_ID, "businessId": BODEGA_ID,
         "epochId": "backup-" + backup_fingerprint[:16], "stockUnits": bodega_stock},
        {"version": 1, "accountId": ACCOUNT_ID, "businessId": COSMETICS_ID,
         "epochId": "supabase-copy-" + dump_fingerprint[:16], "stockUnits": cosmetics_stock},
    ]
    return {"format": "PDA-Offline-Stock-Baselines", "version": 1,
            "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "unitScale": 1_000_000,
            "stockPolicies": {BODEGA_ID: "allowNegative=true to preserve the designated backup exactly; owner review required",
                              COSMETICS_ID: "negative stock rejected"},
            "policy": "private offline sandbox input only; no production restore or cloud writes",
            "sources": [{"kind": "user-designated-bodega-backup", "bytes": backup_path.stat().st_size,
                         "sha256": backup_fingerprint},
                        {"kind": "saved-supabase-custom-dump", "bytes": dump_path.stat().st_size,
                         "sha256": dump_fingerprint}],
            "evidence": {"bodega": bodega_evidence, "cosmeticos": cosmetics_evidence},
            "baselines": baselines}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--dump", required=True, type=Path)
    parser.add_argument("--pg-restore", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    created_output = None
    try:
        paths = [args.backup.resolve(strict=True), args.dump.resolve(strict=True), args.pg_restore.resolve(strict=True)]
        backup_path, dump_path, pg_restore = paths
        output = args.output.resolve()
        if output == ROOT or ROOT in output.parents:
            raise BaselineError("private_output_must_be_outside_checkout")
        if output.exists():
            raise BaselineError("output_exists_choose_new_path")
        if output in backup_path.parents or output in dump_path.parents:
            raise BaselineError("output_overlaps_input")
        if not pg_restore.is_file():
            raise BaselineError("pg_restore_not_file")
        before = {path: input_hash(path) for path in (backup_path, dump_path)}
        backup = evidence.read_json(backup_path)
        rows = evidence.dump_rows(dump_path, pg_restore)
        report = make_baselines(backup, backup_path, dump_path, rows)
        if any(input_hash(path) != digest for path, digest in before.items()):
            raise BaselineError("input_changed_during_analysis")
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8", newline="\n") as target:
            created_output = output
            target.write(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
            target.flush()
            os.fsync(target.fileno())
        try:
            output.chmod(0o600)
        except OSError:
            pass
        summary = {business: {"productCount": details["productCount"], **{
            key: value for key, value in details.items() if key in {"replicaCount", "uniqueSnapshotCount", "mapping", "selection"}}}
            for business, details in report["evidence"].items()}
        print(json.dumps({"status": "offline_baselines_created_not_applied", "outputBytes": output.stat().st_size,
                          "inputIntegrityVerified": True, "evidence": summary}, ensure_ascii=True))
        return 0
    except (BaselineError, evidence.EvidenceError, OSError, ValueError, TypeError) as error:
        if created_output is not None:
            try:
                created_output.unlink()
            except OSError:
                pass
        reason = str(error) if isinstance(error, (BaselineError, evidence.EvidenceError)) else "local_input_or_output_failed"
        print(json.dumps({"status": "failed", "reason": reason}, ensure_ascii=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())