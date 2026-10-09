import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/build_sandbox_stock_baselines.py"
SPEC = importlib.util.spec_from_file_location("build_sandbox_stock_baselines", SCRIPT)
baselines = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(baselines)


class BaselineBuilderTests(unittest.TestCase):
    def test_micro_units_are_exact_and_bounded(self):
        self.assertEqual(baselines.stock_units(1), "1000000")
        self.assertEqual(baselines.stock_units("0.125"), "125000")
        self.assertEqual(baselines.stock_units("12345678901234567890"), "12345678901234567890000000")
        self.assertEqual(baselines.stock_units(-2, allow_negative=True), "-2000000")
        for value in (True, -1, "-0.1", "0.0000001", "NaN", "Infinity"):
            with self.subTest(value=value), self.assertRaises(baselines.BaselineError):
                baselines.stock_units(value)

    def test_backup_stock_requires_unique_products_and_explicit_stock(self):
        backup = {"version": "2.0", "appName": "TasasAlDia_Bodegas", "data": {"idb": {
            "bodega_products_v1": [{"id": "p1", "stock": 12}, {"id": "p2", "stock": "0.125"}],
        }}}
        result, evidence = baselines.backup_bodega_stock(backup)
        self.assertEqual(result, {"p1": "12000000", "p2": "125000"})
        self.assertEqual(evidence["mapping"], "owner_asserted_backup_is_bodega")
        with self.assertRaisesRegex(baselines.BaselineError, "duplicate_bodega_product_id"):
            baselines.backup_bodega_stock({"data": {"idb": {"bodega_products_v1": [
                {"id": "p", "stock": 1}, {"id": "p", "stock": 2}]}}})
        with self.assertRaisesRegex(baselines.BaselineError, "bodega_product_missing_id_or_stock"):
            baselines.backup_bodega_stock({"data": {"idb": {"bodega_products_v1": [{"id": "p"}]}}})

    @staticmethod
    def stock_row(device, payload, updated_at):
        return {"device_id": device, "collection": "store", "doc_id": "nb_neg-fac22061:bodega_stock_v1",
                "updated_at": updated_at, "data": {"schemaVersion": 1, "payload": payload}}

    def test_cosmetics_requires_two_or_more_exactly_matching_maps(self):
        rows = [self.stock_row("device-a", {"p": 10, "q": "0.125"}, "2026-01-01T00:00:00Z"),
                self.stock_row("device-b", {"q": 0.125, "p": 10}, "2026-01-02T00:00:00Z")]
        stock, evidence = baselines.cosmetics_consensus_stock(rows)
        self.assertEqual(stock, {"p": "10000000", "q": "125000"})
        self.assertEqual(evidence["replicaCount"], 2)
        self.assertEqual(evidence["selection"], "exact_map_agreement_not_timestamp")

    def test_cosmetics_refuses_latest_timestamp_tiebreak_and_ignores_catalog(self):
        rows = [self.stock_row("device-a", {"p": 10}, "2026-01-01T00:00:00Z"),
                self.stock_row("device-b", {"p": 9}, "2026-12-01T00:00:00Z")]
        rows.append({"device_id": "device-c", "collection": "store", "doc_id": "nb_neg-fac22061:bodega_products_v1",
                     "updated_at": "2027-01-01T00:00:00Z", "data": {"schemaVersion": 1, "payload": []}})
        with self.assertRaisesRegex(baselines.BaselineError, "cosmetics_stock_snapshots_disagree_no_baseline_selected"):
            baselines.cosmetics_consensus_stock(rows)

    def test_cosmetics_requires_multiple_devices_and_rejects_duplicate_rows(self):
        row = self.stock_row("device-a", {"p": 10}, "2026-01-01T00:00:00Z")
        with self.assertRaisesRegex(baselines.BaselineError, "insufficient_cosmetics_stock_replicas"):
            baselines.cosmetics_consensus_stock([row])
        with self.assertRaisesRegex(baselines.BaselineError, "duplicate_cosmetics_stock_document_per_device"):
            baselines.cosmetics_consensus_stock([row, row])


if __name__ == "__main__":
    unittest.main()
