import copy
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/reconcile_backups_readonly.py"
SPEC = importlib.util.spec_from_file_location("reconcile_backups_readonly", SCRIPT)
f3 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(f3)


def backup(key, records):
    return {"version": "2.0", "appName": "TasasAlDia_Bodegas", "data": {"idb": {key: records}, "ls": {}}}


def row(key, payload, device="device-private", time="2026-10-08T12:00:00Z"):
    return {"device_id": device, "collection": "store", "doc_id": key, "updated_at": time,
            "data": {"schemaVersion": 1, "payload": payload, "updatedAt": time}}


class ReconciliationTests(unittest.TestCase):
    def engine(self):
        engine = f3.Reconciler()
        engine.sources = [{"source": "source-1", "kind": "app-backup"}, {"source": "source-2", "kind": "sync-json"}]
        return engine

    def test_unknown_origin_never_inferred_from_name_alias_or_overlap(self):
        e = self.engine()
        data = backup("bodega_products_v1", [{"id": "p1", "name": "private", "stock": 5}])
        data.update({"device": "Bodega mani", "sedeId": "neg-1"})
        data["data"]["ls"]["business_name"] = "Bodega"
        e.backup("source-1", data)
        e.sync_row("source-2", row("nb_neg-1:bodega_products_v1", [{"id": "p1", "name": "private", "stock": 5}]))
        report = e.report()
        self.assertEqual(report["summary"]["unassignedEntities"], 2)
        self.assertTrue(all(c["assignment"] == "unassigned" for c in report["unknownOriginCandidates"]))
        self.assertEqual(report["unknownOriginCandidates"][0]["sharedIds"], 1)

    def test_namespaces_isolate_same_id_and_retired_history(self):
        e = self.engine()
        for b, total in [("neg-1", 10), ("neg-fac22061", 20), ("neg-856cdc73", 30)]:
            e.sync_row("source-2", row(f"nb_{b}:bodega_sales_v1", [{"id": "same-id", "total": total}]))
        report = e.report()
        self.assertEqual(len(report["entities"]), 3)
        self.assertTrue(all(x["classification"] == "only_in_one_dataset" for x in report["entities"]))
        self.assertTrue(next(x for x in report["entities"] if x["business"] == "neg-856cdc73")["historical"])

    def test_explicit_record_scope_accepted_but_namespace_disagreement_not_reassigned(self):
        e = self.engine()
        e.backup("source-1", backup("bodega_sales_v1", [{"id": "one", "negocioId": "neg-1"}]))
        e.sync_row("source-2", row("nb_neg-1:bodega_sales_v1", [{"id": "two", "sedeId": "neg-fac22061"}]))
        report = e.report()
        self.assertEqual({x["business"] for x in report["entities"]}, {"neg-1", "unassigned"})
        self.assertIn("business_scope_conflict", [x["code"] for x in report["issues"]])

    def test_all_variants_kept_no_last_timestamp_winner_and_void_marked(self):
        e = self.engine()
        e.sync_row("source-2", row("nb_neg-1:bodega_sales_v1", [{"id": "s1", "total": 10, "status": "COMPLETADA"}], "a"))
        e.sync_row("source-2", row("nb_neg-1:bodega_sales_v1", [{"id": "s1", "total": 10, "status": "ANULADA"}], "b", "2000-01-01T00:00:00Z"))
        entity = e.report()["entities"][0]
        self.assertEqual(entity["classification"], "conflicting")
        self.assertTrue(entity["voidConflict"])
        self.assertEqual(len(entity["variants"]), 2)
        self.assertEqual(entity["recommendation"], "retain_all_and_review")

    def test_catalog_stock_separate_and_field_differences_hashed(self):
        e = self.engine()
        e.sync_row("source-2", row("nb_neg-1:bodega_products_v1", [{"id": "p", "stock": 5, "priceUsd": 2}], "a"))
        e.sync_row("source-2", row("nb_neg-1:bodega_products_v1", [{"priceUsd": 2, "stock": 7, "id": "p"}], "b"))
        entities = {x["domain"]: x for x in e.report()["entities"]}
        self.assertEqual(entities["catalog"]["classification"], "coincident")
        self.assertEqual(entities["stock"]["classification"], "conflicting")
        e.sync_row("source-2", row("nb_neg-1:bodega_products_v1", [{"id": "p", "stock": 7, "priceUsd": 3}], "c"))
        catalog = next(x for x in e.report()["entities"] if x["domain"] == "catalog")
        self.assertIn("price", catalog["differentFieldGroups"])

    def test_duplicate_missing_invalid_id_and_stock_orphans(self):
        e = self.engine()
        e.backup("source-1", backup("nb_neg-1:bodega_products_v1", [{"id": "p"}, {"id": "p", "stock": 1},
            {"stock": 4}, {"id": []}, {"id": False}]))
        e.sync_row("source-2", row("nb_neg-1:bodega_stock_v1", {"orphan": 4, "bad": "nan"}))
        report = e.report()
        codes = [x["code"] for x in report["issues"]]
        self.assertIn("duplicate_id_in_document", codes)
        self.assertIn("record_missing_or_invalid_id", codes)
        self.assertIn("invalid_stock_value", codes)
        self.assertEqual(report["summary"]["stockIdsWithoutObservedCatalog"], 1)

    def test_invalid_sales_envelope_and_delta_retained_as_issues_no_adapter(self):
        e = self.engine()
        e.sync_row("source-2", row("nb_neg-1:bodega_sales_delta_2026-10-08", {"date": "2026-10-07", "tickets": [{"id": "s"}]}))
        invalid = row("nb_neg-1:bodega_sales_v1", [])
        invalid["data"]["schemaVersion"] = 2
        e.sync_row("source-2", invalid)
        report = e.report()
        self.assertEqual(len(report["entities"]), 0)
        self.assertEqual({x["code"] for x in report["issues"]}, {"invalid_sales_delta", "invalid_sync_envelope"})

    def test_legacy_json_string_and_object_key_order(self):
        e = self.engine()
        data = {"version": "1.0", "data": {"bodega_products_v1": json.dumps([{"id": "p", "price": 1}])}}
        before = copy.deepcopy(data)
        e.backup("source-1", data)
        self.assertEqual(data, before)
        self.assertEqual(f3.digest({"x": {"b": 1, "a": 2}}), f3.digest({"x": {"a": 2, "b": 1}}))
        self.assertEqual(e.report()["summary"]["entities"], 1)

    def test_registry_tombstones_and_contradictions_preserved(self):
        e = self.engine()
        e.sync_row("source-2", row("bodega_businesses_registry_v1", {"businesses": [{"id": "neg-856cdc73", "nombre": "old private"}],
            "deletedBusinesses": [{"id": "neg-856cdc73", "deletedAt": "x"}]}))
        retired = next(x for x in e.report()["businesses"] if x["business"] == "neg-856cdc73")
        self.assertTrue(retired["activeListingContradictsTombstone"])
        self.assertTrue(retired["tombstoneObserved"])
        self.assertEqual(len(retired["versions"]), 1)

    def test_journal_raw_not_promoted_to_accepted_sales(self):
        e = self.engine()
        data = backup("bodega_products_v1", [])
        data["data"]["cloudPullJournal"] = {"version": 1, "entries": [{"row": row("nb_neg-1:bodega_sales_v1", [{"id": "s"}]), "status": "pending"}]}
        e.backup("source-1", data)
        self.assertEqual(e.report()["entities"], [])
        self.assertEqual(e.report()["summary"]["journalEntries"], 1)

    def test_reports_redacted_no_customer_pin_url_device_raw_ids(self):
        e = self.engine()
        records = [{"id": "ticket-secret", "cliente": "PII-secret", "pin": "PIN-secret", "image": "https://private.invalid/URL-secret"}]
        e.sync_row("source-2", row("nb_neg-1:bodega_sales_v1", records, "DEVICE-secret"))
        text = json.dumps(e.report()) + f3.markdown(e.report())
        for secret in ["ticket-secret", "PII-secret", "PIN-secret", "URL-secret", "DEVICE-secret"]:
            self.assertNotIn(secret, text)

    def test_copy_decoder_preserves_json_escapes_and_nulls(self):
        document = row("nb_neg-1:bodega_products_v1", [{"id": "p", "name": "á\nslash\\tab\t"}])["data"]
        raw_json = json.dumps(document, ensure_ascii=False)
        encoded = raw_json.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")
        lines = ["COPY public.sync_documents (device_id, collection, doc_id, data, updated_at) FROM stdin;\n",
                 "dev\tstore\tnb_neg-1:bodega_products_v1\t" + encoded + "\t2026-10-08T12:00:00Z\n", "\\.\n"]
        parsed = list(f3.parse_sync_copy(lines))
        self.assertEqual(parsed[0]["data"], document)
        self.assertIsNone(f3.copy_unescape(r"\N"))
        self.assertEqual(f3.copy_unescape(r"\141\x62"), "ab")
        with self.assertRaises(f3.EvidenceError):
            list(f3.parse_sync_copy(lines[:-1]))

    def test_cli_real_files_interface_hashes_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.json"
            source.write_text(json.dumps(backup("bodega_sales_v1", [{"id": "s"}])), encoding="utf-8")
            output = base / "report"
            before = f3.file_hash(source)
            command = [sys.executable, str(SCRIPT), "--backup", str(source), "--output", str(output)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertTrue(report["inputIntegrityVerified"])
            self.assertEqual(report["sources"][0]["sha256"], before)
            self.assertEqual(f3.file_hash(source), before)
            self.assertTrue((output / "report.md").exists())
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(second.returncode, 1)
            self.assertIn("output_already_exists", second.stderr)

    def test_cli_disallows_repo_output_and_bad_json_no_sensitive_error(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.json"
            source.write_text('{"customer": secret-PII}', encoding="utf-8")
            for output, reason in [(f3.ROOT / "private-test", "outside_checkout"),
                                   (Path(directory) / "out", "invalid_json")]:
                with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as errors:
                    code = f3.main(["--backup", str(source), "--output", str(output)])
                self.assertEqual(code, 1)
                self.assertIn(reason, errors.getvalue())
                self.assertNotIn("secret-PII", errors.getvalue())
                self.assertFalse(output.exists())

    def test_foreign_app_rejected_and_unrelated_plain_settings_not_parsed(self):
        e = self.engine()
        foreign = backup('bodega_sales_v1', [])
        foreign['appName'] = 'Juancho'
        with self.assertRaisesRegex(f3.EvidenceError, 'foreign_app'):
            e.backup('source-1', foreign)
        e.backup('source-1', backup('business_name', 'private plain text'))
        self.assertEqual(e.report()['issues'], [])

    def test_namespace_free_numeric_and_invalid_ids_dont_crash_report(self):
        e = self.engine()
        e.backup('source-1', backup('bodega_products_v1', [{'id': 0}, {'id': ''}, {'id': []}]))
        self.assertEqual(len(e.report()['entities']), 1)
        self.assertEqual(e.report()['recordLists'][0]['recordCount'], 3)

    def test_nonfinite_json_rejected(self):
        with self.assertRaises(f3.EvidenceError):
            f3.parse_json('{"total": NaN}')


if __name__ == "__main__":
    unittest.main()
