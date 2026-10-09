import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "backup_storage_readonly", Path(__file__).resolve().parents[1] / "scripts" / "backup_storage_readonly.py"
)
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)
URL = "https://" + backup.HOST + backup.PREFIX + "catalog/photo.jpg?v=123"


class FakeResponse:
    def __init__(self, status=200, payload=b"image-bytes", headers=None):
        self.status_code = status
        self.payload = payload
        self.headers = headers if headers is not None else {
            "Content-Type": "image/jpeg", "Content-Length": str(len(payload)), "ETag": "sample"
        }

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def iter_content(self, chunk_size):
        yield self.payload


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return next(self.responses)


class StorageBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "objects").mkdir()
        (self.root / "receipts").mkdir()

    def download(self, responses, url=URL):
        fake = FakeSession(responses)
        with patch.object(backup, "session", return_value=fake), patch.object(backup.time, "sleep"):
            result = backup.download(url, self.root)
        return result, fake

    def test_allowlist_and_query_identity(self):
        self.assertTrue(backup.allowed_url(URL))
        for url in (
            URL.replace("https://", "http://"),
            URL.replace(backup.HOST, "foreign.example"),
            URL.replace(backup.HOST, "user:password@" + backup.HOST),
            URL.replace("catalog/photo.jpg", "../secret"),
            URL.replace("catalog/photo.jpg", "%2e%2e/secret"),
            URL.replace("catalog/photo.jpg", "catalog%5csecret"),
            URL + "#fragment",
        ):
            with self.subTest(url=url):
                self.assertFalse(backup.allowed_url(url))
        self.assertNotEqual(backup.reference_key(URL), backup.reference_key(URL.replace("123", "124")))

    def test_success_persisted_hash_and_receipt_resume(self):
        result, fake = self.download([FakeResponse()])
        self.assertEqual(result["status"], "ok")
        self.assertFalse(fake.calls[0][1]["allow_redirects"])
        self.assertEqual(fake.calls[0][0], URL)
        target = self.root / result["file"]
        self.assertEqual(result["sha256"], backup.sha256_file(target))
        receipt = {"url_original": URL, "product_ids": ["private-id"], **result}
        backup.atomic_json(self.root / "receipts" / (backup.reference_key(URL) + ".json"), receipt)
        self.assertEqual(backup.valid_receipt(self.root, URL), receipt)
        target.write_bytes(b"corruption")
        self.assertIsNone(backup.valid_receipt(self.root, URL))
        self.assertFalse(list((self.root / "objects").glob("*.part")))

    def test_transient_retry_bounded(self):
        result, fake = self.download([FakeResponse(503), FakeResponse(429), FakeResponse()])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["attempts"], 3)
        self.assertEqual(len(fake.calls), 3)
        result, fake = self.download([FakeResponse(503)] * 3)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(len(fake.calls), 3)

    def test_redirect_missing_and_invalid_content_fail_without_retry(self):
        for response in (
            FakeResponse(302), FakeResponse(404),
            FakeResponse(headers={"Content-Type": "text/html"}),
            FakeResponse(payload=b""),
            FakeResponse(headers={"Content-Type": "image/png", "Content-Length": str(backup.MAX_BYTES + 1)}),
            FakeResponse(headers={"Content-Type": "image/png", "Content-Length": "1"}),
        ):
            with self.subTest(status=response.status_code, headers=response.headers):
                result, fake = self.download([response])
                self.assertEqual(result["status"], "failed")
                self.assertEqual(len(fake.calls), 1)
                self.assertFalse(list((self.root / "objects").iterdir()))

    def test_streamed_oversize_has_no_partial(self):
        with patch.object(backup, "MAX_BYTES", 3):
            result, _ = self.download([FakeResponse(headers={"Content-Type": "image/png"})])
        self.assertEqual(result["reason"], "invalid_or_oversize_object")
        self.assertFalse(list((self.root / "objects").iterdir()))

    def test_failed_receipt_preserves_http_evidence_on_verification(self):
        source = self.root / "original.json"
        source.write_text(json.dumps({"data": {"idb": {"bodega_products_v1": [
            {"id": "one", "image": URL}
        ]}}}), encoding="utf-8")
        expected = backup.sha256_file(source)
        output = self.root / "acquired"
        args = ["backup", "--source", str(source), "--output", str(output),
                "--expected-source-sha256", expected]
        fake = FakeSession([FakeResponse(400)])
        with patch("sys.argv", args), patch.object(backup, "session", return_value=fake):
            self.assertEqual(backup.main(), 1)
        receipt = output / "receipts" / (backup.reference_key(URL) + ".json")
        before = json.loads(receipt.read_text(encoding="utf-8"))
        with patch("sys.argv", args + ["--verify-only"]):
            self.assertEqual(backup.main(), 1)
        self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), before)
        self.assertEqual(before["http_status"], 400)

    def test_source_checksum_reference_coverage_and_cli_resume(self):
        source = self.root / "original.json"
        source.write_text(json.dumps({"data": {"idb": {"bodega_products_v1": [
            {"id": "one", "image": URL}, {"id": "two", "image": URL},
            {"id": "three", "image": "data:image/png;base64,AAAA"}, {"id": "four"}
        ]}}}), encoding="utf-8")
        expected = backup.sha256_file(source)
        refs, coverage = backup.load_references(source, expected)
        self.assertEqual(refs[URL], ["one", "two"])
        self.assertEqual(coverage["url_references"], 2)
        with self.assertRaisesRegex(ValueError, "source_checksum_mismatch"):
            backup.load_references(source, "wrong")
        output = self.root / "acquired"
        args = ["backup", "--source", str(source), "--output", str(output),
                "--expected-source-sha256", expected]
        fake = FakeSession([FakeResponse()])
        with patch("sys.argv", args), patch.object(backup, "session", return_value=fake):
            self.assertEqual(backup.main(), 0)
        with patch("sys.argv", args + ["--verify-only"]), patch.object(backup, "download") as download:
            self.assertEqual(backup.main(), 0)
            download.assert_not_called()
        manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["summary"]["complete_reference_acquisition"])
        self.assertEqual(manifest["objects"][0]["url_original"], URL)
        self.assertEqual(manifest["objects"][0]["product_ids"], ["one", "two"])
        self.assertFalse((output / ".acquisition.lock").exists())
        (output / manifest["objects"][0]["file"]).write_bytes(b"bad")
        with patch("sys.argv", args + ["--verify-only"]):
            self.assertEqual(backup.main(), 1)
        summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
        self.assertFalse(summary["complete_reference_acquisition"])
        self.assertEqual(summary["saved_urls"], 0)


if __name__ == "__main__":
    unittest.main()
