"""F3 offline evidence comparison; never connects, imports, restores or merges data.

Inputs: app backup JSON, sync row JSON, or pg_dump custom archive via pg_restore
--file=- (no database). Reports must be outside the checkout. Standard library only.
"""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUSINESSES = {"neg-1": "Bodega", "neg-fac22061": "Cosméticos", "neg-856cdc73": "Eliminada"}
RETIRED = "neg-856cdc73"
MAX_INPUT_BYTES = 256 * 1024 * 1024
ARRAY_DOMAINS = {
    "bodega_products_v1": "catalog", "bodega_sales_v1": "sales",
    "bodega_customer_ledger_v1": "ledger", "bodega_accounts_v2": "accounts",
    "bodega_employees_v1": "employees", "bodega_users_catalog_v1": "users",
    "bodega_customers_v1": "customers", "bodega_supplier_invoices_v1": "invoices",
    "bodega_suppliers_v1": "suppliers", "bodega_payment_methods_v1": "payment_methods",
}
RECORD_BUSINESS_FIELDS = ("negocioId", "sedeId", "businessId", "business_id")


class EvidenceError(ValueError):
    """Safe error code only: input contents must never enter console/logs."""


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ref(value):
    return "sha256:" + digest(value)


def parse_json(text):
    try:
        return json.loads(text, parse_constant=lambda _value: (_ for _ in ()).throw(EvidenceError("non_finite_json")))
    except (ValueError, TypeError, RecursionError) as error:
        raise EvidenceError("invalid_json") from error


def read_json(path):
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise EvidenceError("input_too_large")
    return parse_json(path.read_text(encoding="utf-8-sig"))


def decoded(value):
    return parse_json(value) if isinstance(value, str) else value


def copy_unescape(value):
    """Decode PostgreSQL COPY text, not SQL; preserve JSON backslash escapes."""
    if value == r"\N":
        return None
    escapes = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}
    pattern = r"\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)"
    def replace(match):
        token = match[1]
        if token in escapes:
            return escapes[token]
        if token.startswith("x") and len(token) > 1:
            return chr(int(token[1:], 16))
        if token[0] in "01234567":
            return chr(int(token, 8))
        return token
    return re.sub(pattern, replace, value)


def parse_sync_copy(lines):
    columns = None
    found = False
    for line in lines:
        line = line.rstrip("\r\n")
        if columns is None:
            match = re.fullmatch(r"COPY public\.sync_documents \(([^)]+)\) FROM stdin;", line)
            if match:
                if found:
                    raise EvidenceError("duplicate_copy_table")
                found = True
                columns = [part.strip().strip('"') for part in match[1].split(",")]
                if not {"device_id", "collection", "doc_id", "data", "updated_at"}.issubset(columns):
                    raise EvidenceError("unexpected_copy_columns")
            continue
        if line == r"\.":
            columns = None
            continue
        values = line.split("\t")
        if len(values) != len(columns):
            raise EvidenceError("invalid_copy_row")
        row = dict(zip(columns, map(copy_unescape, values)))
        # Parse only the data column used by the application; never fallback to
        # legacy payload silently or interpret executable SQL from the archive.
        row["data"] = parse_json(row["data"]) if row["data"] is not None else None
        yield row
    if not found or columns is not None:
        raise EvidenceError("missing_or_incomplete_sync_copy")


def dump_rows(path, executable):
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise EvidenceError("input_too_large")
    command = [str(executable), "--data-only", "--table=sync_documents", "--file=-", str(path)]
    # No --dbname, connection URL, psql, shell or restore target is ever used.
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               text=True, encoding="utf-8")
    try:
        consumed = 0
        def lines():
            nonlocal consumed
            for line in process.stdout:
                consumed += len(line.encode("utf-8"))
                if consumed > MAX_INPUT_BYTES:
                    raise EvidenceError("extracted_table_too_large")
                yield line
        yield from parse_sync_copy(lines())
        if process.wait(timeout=30) != 0:
            raise EvidenceError("pg_restore_extraction_failed")
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.kill()
            process.wait()


def namespaced_key(key):
    match = re.fullmatch(r"nb_([^:]+):(.+)", key) if isinstance(key, str) else None
    return (match[1], match[2]) if match else (None, key)


def safe_business(value):
    return value if value in BUSINESSES else ("unassigned" if value is None else "unknown:" + digest(value))


def voided(record):
    return (record.get("status") == "ANULADA" or record.get("estado") == "ANULADA"
            or record.get("voidedAt") is not None or record.get("tipo") == "ANULACION")


class Reconciler:
    def __init__(self):
        self.sources = []
        self.observations = defaultdict(list)
        self.datasets = {}
        self.issues = []
        self.documents = []
        self.pending = []
        self.registry = defaultdict(list)
        self.tombstones = {RETIRED}
        self.observed_tombstones = set()
        self.image_refs = Counter()
        self.storage = None
        self.record_lists = []

    def issue(self, code, provenance, **metadata):
        self.issues.append({"code": code, "provenance": provenance, **metadata})

    def add_source(self, path, kind):
        entry = {"source": "source-" + str(len(self.sources) + 1), "kind": kind,
                 "sha256": file_hash(path), "bytes": path.stat().st_size}
        self.sources.append(entry)
        return entry["source"]

    def provenance(self, source, doc, device=None, updated=None, journal_status=None):
        result = {"source": source, "documentRef": ref(doc), "deviceRef": ref(device) if device else None}
        # Remote timestamps are provenance, not selection criteria.
        if isinstance(updated, str) and re.fullmatch(r"[0-9T:+. Z-]{10,40}", updated):
            result["updatedAt"] = updated
        if journal_status:
            result["journalStatus"] = journal_status if journal_status in {"pending", "resolved"} else "unknown"
        return result

    def scope(self, namespace, record, provenance):
        declared = {str(record[field]) for field in RECORD_BUSINESS_FIELDS if record.get(field) not in (None, "")}
        if len(declared) > 1 or (namespace and declared and namespace not in declared):
            self.issue("business_scope_conflict", provenance)
            return "unassigned"
        return safe_business(namespace or next(iter(declared), None))

    def add_record(self, business, domain, record_id, value, provenance, raw=None):
        if isinstance(record_id, bool) or not isinstance(record_id, (str, int)) or str(record_id) == "":
            self.issue("record_missing_or_invalid_id", provenance, domain=domain)
            return
        record_id = str(record_id)
        entity = (business, domain, record_id)
        dataset = digest([provenance["source"], provenance["documentRef"], provenance["deviceRef"], business, domain])
        self.datasets.setdefault(dataset, {"datasetRef": "sha256:" + dataset, "business": business,
            "domain": domain,            "provenance": provenance, "observations": 0})["observations"] += 1
        comparable = value
        if domain == "catalog" and isinstance(value, dict):
            comparable = {k: v for k, v in value.items() if k not in {"stock", "updatedAt"}}
        item = {"datasetRef": "sha256:" + dataset, "hash": digest(comparable), "rawHash": digest(raw if raw is not None else value),
                "provenance": provenance, "voided": domain == "sales" and isinstance(value, dict) and voided(value)}
        if isinstance(value, dict) and domain in {"catalog", "sales"}:
            groups = {"barcode": ("barcode", "codigoBarras"), "price": ("priceUsd", "priceUsdt", "priceBs", "priceCop", "price"),
                      "currency": ("currency", "moneda"), "cost": ("costUsd", "costBs", "cost"),
                      "image": ("image",), "sale_state": ("status", "estado", "voidedAt", "tipo"),
                      "sale_amounts": ("total", "totalUsd", "totalBs", "payments")}
            item["fieldGroupHashes"] = {name: digest({k: value[k] for k in fields if k in value})
                                        for name, fields in groups.items()
                                        if (name.startswith('sale_')) == (domain == 'sales')}
        self.observations[entity].append(item)

    def document(self, source, doc_id, value, device=None, updated=None, journal_status=None):
        namespace, key = namespaced_key(doc_id)
        provenance = self.provenance(source, doc_id, device, updated, journal_status)
        self.documents.append({**provenance, "key": key if key in ARRAY_DOMAINS or key in {
            "bodega_stock_v1", "bodega_businesses_registry_v1"} else
            ("sales_delta" if isinstance(key, str) and key.startswith("bodega_sales_delta_") else "other"),
            "business": safe_business(namespace), "hash": digest(value)})
        # Settings strings and retired keys are not JSON record documents.
        relevant = key in ARRAY_DOMAINS or key in {"bodega_stock_v1", "bodega_businesses_registry_v1"}
        if not relevant and not (isinstance(key, str) and key.startswith("bodega_sales_delta_")):
            return
        try:
            value = decoded(value)
        except EvidenceError:
            self.issue("invalid_document_json", provenance)
            return
        if key == "bodega_businesses_registry_v1":
            if not isinstance(value, dict) or not isinstance(value.get("businesses"), list):
                self.issue("invalid_registry", provenance)
                return
            for record in value["businesses"]:
                if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not record["id"]:
                    self.issue("invalid_registry_member", provenance)
                    continue
                business = safe_business(record["id"])
                self.registry[business].append({"hash": digest(record), "provenance": provenance})
            tombs = value.get("deletedBusinesses", [])
            if not isinstance(tombs, list):
                self.issue("invalid_tombstones", provenance)
                return
            for tomb in tombs:
                if isinstance(tomb, dict) and isinstance(tomb.get("id"), str) and tomb["id"]:
                    business = safe_business(tomb["id"])
                    self.tombstones.add(business)
                    self.observed_tombstones.add(business)
                else:
                    self.issue("invalid_tombstone", provenance)
            return
        if key == "bodega_stock_v1":
            if not isinstance(value, dict):
                self.issue("invalid_stock_map", provenance)
                return
            for record_id, stock in value.items():
                if isinstance(stock, bool) or not isinstance(stock, (float, int, str)) or not finite_number(stock):
                    self.issue("invalid_stock_value", provenance, recordRef=ref(record_id))
                else:
                    self.add_record(safe_business(namespace), "stock", record_id, stock, provenance)
            return
        domain = ARRAY_DOMAINS.get(key)
        if isinstance(key, str) and key.startswith("bodega_sales_delta_"):
            day = key.removeprefix("bodega_sales_delta_")
            if (not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or not isinstance(value, dict)
                    or value.get("date") != day or not isinstance(value.get("tickets"), list)):
                self.issue("invalid_sales_delta", provenance, business=safe_business(namespace),
                           shape=shape(value))
                return
            domain, value = "sales", value["tickets"]
        if domain is None:
            return
        if domain == "users" and isinstance(value, dict) and value.get("v") == 1:
            value = value.get("users")
        if not isinstance(value, list):
            self.issue("invalid_record_list", provenance, domain=domain)
            return
        seen = Counter()
        list_summary = {"business": safe_business(namespace), "domain": domain, "provenance": provenance,
                        "recordCount": len(value)}
        self.record_lists.append(list_summary)
        for record in value:
            if not isinstance(record, dict):
                self.issue("invalid_record", provenance, domain=domain)
                continue
            business = self.scope(namespace, record, provenance)
            record_id = record.get("id")
            self.add_record(business, domain, record_id, record, provenance)
            if record_id is not None:
                seen[(business, str(record_id))] += 1
            if domain == "catalog":
                # Stock remains separate; snapshots are never summed.
                if "stock" in record:
                    if finite_number(record["stock"]):
                        self.add_record(business, "stock", record_id, record["stock"], provenance)
                    else:
                        self.issue("invalid_stock_value", provenance)
                image = record.get("image")
                if isinstance(image, str) and image.startswith(("http://", "https://")):
                    self.image_refs[image] += 1
                elif isinstance(image, str) and image.startswith("data:image/"):
                    self.image_refs["inline"] += 1
                else:
                    self.image_refs["missing"] += 1
        for (business, record_id), count in seen.items():
            if count > 1:
                self.issue("duplicate_id_in_document", provenance, business=business, domain=domain,
                           recordRef=ref(record_id), occurrences=count)

    def sync_row(self, source, row, journal_status=None):
        if not isinstance(row, dict) or not isinstance(row.get("doc_id"), str):
            self.issue("invalid_sync_row", {"source": source})
            return
        data = row.get("data")
        provenance = self.provenance(source, row["doc_id"], row.get("device_id"), row.get("updated_at"), journal_status)
        if row.get("collection") not in {"store", "local"}:
            self.issue("unsupported_collection", provenance)
            return
        if (not isinstance(data, dict) or "payload" not in data or data.get("schemaVersion", 1) != 1):
            self.issue("invalid_sync_envelope", provenance, shape=shape(data))
            return
        self.document(source, row["doc_id"], data["payload"], row.get("device_id"), row.get("updated_at"), journal_status)

    def backup(self, source, backup):
        if not isinstance(backup, dict) or not isinstance(backup.get("data"), dict):
            raise EvidenceError("unsupported_backup")
        app_name = backup.get('appName')
        if app_name is not None and app_name not in {'TasasAlDia_Bodegas', 'TasasAlDia_Bodegas_Cloud'}:
            raise EvidenceError('foreign_app_backup_not_allowed')
        data = backup["data"]
        idb = data.get("idb", data if backup.get("version") != "2.0" else None)
        if not isinstance(idb, dict):
            raise EvidenceError("missing_backup_idb")
        for key, value in idb.items():
            self.document(source, key, value)
        # Only explicit physical namespaces / record fields establish business.
        # backup filename, appName, device, alias and current-business flags do not.
        journal = data.get("cloudPullJournal")
        if journal is not None:
            if not isinstance(journal, dict) or journal.get("version") != 1 or not isinstance(journal.get("entries"), list):
                self.issue("invalid_journal", {"source": source})
            else:
                for entry in journal["entries"]:
                    if not isinstance(entry, dict):
                        self.issue("invalid_journal_entry", {"source": source})
                        continue
                    self.pending.append({"source": source, "status": entry.get("status") if entry.get("status") in {
                        "pending", "resolved"} else "unknown", "entryRef": ref(entry)})
                    # Quarantined/resolved originals are evidence, NOT an accepted
                    # snapshot. Do not feed them into canonical record comparisons.
                    row = entry.get("row")
                    if isinstance(row, dict):
                        p = self.provenance(source, row.get("doc_id"), row.get("device_id"), row.get("updated_at"), entry.get("status"))
                        self.issue("journal_evidence_not_applied", p, shape=shape(row.get("data")))

    def report(self):
        entities = []
        totals = Counter()
        coverage = defaultdict(set)
        for (business, domain, record_id), items in sorted(self.observations.items()):
            hashes = {item["hash"] for item in items}
            datasets = {item["datasetRef"] for item in items}
            classification = "conflicting" if len(hashes) > 1 else ("coincident" if len(datasets) > 1 else "only_in_one_dataset")
            totals[classification] += 1
            totals["entities"] += 1
            coverage[(business, domain)].add(record_id)
            entities.append({"business": business, "domain": domain, "recordRef": ref(record_id),
                "classification": classification, "historical": business in self.tombstones,
                "voidConflict": domain == "sales" and any(i["voided"] for i in items) and not all(i["voided"] for i in items),
                "differentFieldGroups": [group for group in sorted({g for item in items for g in item.get("fieldGroupHashes", {})})
                    if len({item.get("fieldGroupHashes", {}).get(group) for item in items}) > 1],
                "variants": [{k: v for k, v in item.items() if k not in {"fieldGroupHashes", "provenance"}} for item in items],
                "recommendation": "retain_all_and_review" if classification == "conflicting" else "report_only_no_merge"})
        # Similarity is a candidate inspection ONLY. Unknown records never move
        # to a business, even if just one business matches all their contents.
        candidates = []
        for business in BUSINESSES:
            for domain in sorted(set(ARRAY_DOMAINS.values()) | {"stock"}):
                unknown_ids = coverage[("unassigned", domain)]
                assigned = coverage[(business, domain)]
                common = unknown_ids & assigned
                if not unknown_ids or not assigned:
                    continue
                identical = sum(bool({i["hash"] for i in self.observations[("unassigned", domain, ident)]}
                    & {i["hash"] for i in self.observations[(business, domain, ident)]}) for ident in common)
                candidates.append({"business": business, "domain": domain, "sharedIds": len(common),
                    "atLeastOneIdenticalVariant": identical, "sharedIdsWithoutIdenticalVariant": len(common) - identical,
                    "unknownOnlyIds": len(unknown_ids - assigned), "businessOnlyIds": len(assigned - unknown_ids),
                    "assignment": "unassigned", "historical": business in self.tombstones})
        registry = [{"business": b, "canonicalLabel": BUSINESSES.get(b, "Desconocida"),
            "status": "historical_tombstoned" if b in self.tombstones else "observed_not_certified",
            "tombstoneObserved": b in self.observed_tombstones, "conflictingVersions": len({v["hash"] for v in variants}) > 1,
            "activeListingContradictsTombstone": b in self.tombstones and bool(variants), "versions": variants}
            for b, variants in sorted({**{k: [] for k in BUSINESSES}, **self.registry}.items())]
        stock_orphans = sum(1 for (business, domain, record_id) in self.observations
                            if domain == "stock" and record_id not in coverage[(business, "catalog")])
        return {"version": 1, "mode": "offline-read-only", "sources": self.sources,
            "summary": {**dict(totals), "observations": sum(len(v) for v in self.observations.values()),
                "documents": len(self.documents), "issues": len(self.issues), "stockIdsWithoutObservedCatalog": stock_orphans,
                "unassignedEntities": sum(e["business"] == "unassigned" for e in entities),
                "journalEntries": len(self.pending)},
            "businesses": registry, "coverage": [{"business": b, "domain": d, "uniqueIds": len(ids)}
                for (b, d), ids in sorted(coverage.items()) if ids],
            "datasets": list(self.datasets.values()), "documents": self.documents, "recordLists": self.record_lists,
            "entities": entities, "unknownOriginCandidates": candidates, "issues": self.issues,
            "journalEvidence": self.pending, "images": {"publicUrlObservations": sum(v for k, v in self.image_refs.items()
                if k not in {"inline", "missing"}), "uniquePublicUrls": len(set(self.image_refs) - {"inline", "missing"}),
                "inlineObservations": self.image_refs["inline"], "missingObservations": self.image_refs["missing"],
                "storageEvidence": self.storage},
            "limitations": ["No canonical snapshot chosen; timestamps do not decide truth.",
                "Only-in-one means observed dataset, not lost, local-only or cloud-only proof.",
                "Unassigned overlaps are not business attribution; retired history is never reassigned.",
                "No PC completeness, auth/RLS, live cloud, financial reconciliation or restore certified.",
                "Stock discrepancies are not explained by comparing snapshots; no stock sums/adjustments.",
                "Hashes redact identifiers but are not anonymization; protect the private report."]}


def finite_number(value):
    try:
        return not isinstance(value, bool) and value is not None and value != "" and math.isfinite(float(value))
    except (ValueError, TypeError, OverflowError):
        return False


def shape(value):
    if isinstance(value, dict):
        return {"type": "object", "hasDate": "date" in value, "ticketsType": type(value.get("tickets")).__name__,
                "fieldCount": len(value)}
    return {"type": type(value).__name__}


def markdown(report):
    s = report["summary"]
    lines = ["# F3 — conciliación offline (solo lectura)", "", "**Sin importación, merge ni selección canónica.**", "",
        f"Fuentes: {len(report['sources'])}; documentos: {s['documents']}; observaciones: {s['observations']}.",
        f"Entidades: {s.get('entities', 0)}; coincidentes: {s.get('coincident', 0)}; conflictos: {s.get('conflicting', 0)};",
        f"solo en un dataset observado: {s.get('only_in_one_dataset', 0)}; sin sede asignada: {s['unassignedEntities']}.", "",
        "## Sedes y registro", "", "| Sede | Estado | Versiones | Contradicción con tombstone |",
        "|---|---|---:|---|"]
    for b in report["businesses"]:
        lines.append(f"| {b['business']} | {b['status']} | {len(b['versions'])} | {b['activeListingContradictsTombstone']} |")
    lines += ["", "## Candidatos sin origen demostrado", "", "Similitud NO asigna sede ni autoriza importar.", "",
        "| Sede candidata | Dominio | IDs compartidos | Variante idéntica | Diferentes |",
        "|---|---|---:|---:|---:|"]
    for c in report["unknownOriginCandidates"]:
        lines.append(f"| {c['business']} | {c['domain']} | {c['sharedIds']} | {c['atLeastOneIdenticalVariant']} | {c['sharedIdsWithoutIdenticalVariant']} |")
    lines += ["", "## Hallazgos (conteos, detalles en report.json)", ""]
    for code, count in sorted(Counter(i["code"] for i in report["issues"]).items()):
        lines.append(f"- {code}: {count}")
    lines += ["", "## Límites", ""] + ["- " + line for line in report["limitations"]]
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", action="append", type=Path, default=[])
    parser.add_argument("--sync-json", action="append", type=Path, default=[])
    parser.add_argument("--dump", action="append", type=Path, default=[])
    parser.add_argument("--pg-restore", type=Path)
    parser.add_argument("--storage-manifest", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    started = time.perf_counter()
    try:
        inputs = args.backup + args.sync_json + args.dump + ([args.storage_manifest] if args.storage_manifest else [])
        if not inputs:
            raise EvidenceError("no_inputs")
        paths = [p.resolve(strict=True) for p in inputs]
        output = args.output.resolve()
        if output == ROOT or ROOT in output.parents:
            raise EvidenceError("private_report_must_be_outside_checkout")
        if output.exists():
            raise EvidenceError("output_already_exists_use_new_directory")
        if any(output == p or output in p.parents for p in paths):
            raise EvidenceError("output_overlaps_input")
        if args.dump and (not args.pg_restore or not args.pg_restore.is_file()):
            raise EvidenceError("pg_restore_required_for_archive")
        before = {p: file_hash(p) for p in paths}
        engine = Reconciler()
        for path in args.backup:
            engine.backup(engine.add_source(path, "app-backup"), read_json(path))
        for path in args.sync_json:
            source = engine.add_source(path, "sync-json")
            rows = read_json(path)
            if not isinstance(rows, list):
                raise EvidenceError("sync_json_requires_row_array")
            for row in rows:
                engine.sync_row(source, row)
        for path in args.dump:
            source = engine.add_source(path, "offline-dump")
            for row in dump_rows(path, args.pg_restore):
                engine.sync_row(source, row)
        if args.storage_manifest:
            source = engine.add_source(args.storage_manifest, "storage-manifest")
            manifest = read_json(args.storage_manifest)
            objects = manifest.get("objects") if isinstance(manifest, dict) else None
            if not isinstance(objects, list):
                raise EvidenceError("invalid_storage_manifest")
            # Receipts attest acquisition; this report does not refetch/decode files.
            statuses = Counter(item.get("status") if item.get("status") in {"ok", "failed"} else "unknown"
                               for item in objects if isinstance(item, dict))
            manifest_urls = {item.get('url_original'): item.get('status') for item in objects if isinstance(item, dict)
                             and isinstance(item.get('url_original'), str)}
            used = set(engine.image_refs) - {'inline', 'missing'}
            engine.storage = {"source": source, "entries": len(objects), "receiptStatuses": dict(statuses),
                "comparedUniqueUrls": len(used & set(manifest_urls)),
                "referencedUrlsOutsideManifest": len(used - set(manifest_urls)),
                "referencedUrlsWithFailedReceipt": sum(manifest_urls.get(url) == 'failed' for url in used),
                "verification": "manifest_only_not_rehashed_or_live_storage"}
        if any(file_hash(p) != checksum for p, checksum in before.items()):
            raise EvidenceError("input_changed_during_analysis")
        report = engine.report()
        report["elapsedSeconds"] = round(time.perf_counter() - started, 3)
        report["inputIntegrityVerified"] = True
        output.mkdir(parents=True, exist_ok=False)
        for name, text in [("report.json", json.dumps(report, ensure_ascii=False, separators=(',', ':'))), ("report.md", markdown(report))]:
            with (output / name).open("x", encoding="utf-8", newline="\n") as target:
                target.write(text)
                target.flush()
                os.fsync(target.fileno())
        print(json.dumps({"status": "reported_not_reconciled", "summary": report["summary"],
                          "elapsedSeconds": report["elapsedSeconds"], "inputIntegrityVerified": True}))
        return 0
    except (EvidenceError, OSError, subprocess.SubprocessError, UnicodeError) as error:
        print(json.dumps({"status": "failed", "reason": str(error) if isinstance(error, EvidenceError) else "local_io_or_extraction_failed"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
