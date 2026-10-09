"""Read-only acquisition of public image references; never uploads or restores data.

Private backup data and receipts belong outside the checkout. Requires requests.
"""
import argparse
import hashlib
import json
import os
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import unquote, urlsplit

import requests

HOST = "oshexsmweswzbwaksvra.supabase.co"
PREFIX = "/storage/v1/object/public/product-images/"
MAX_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
RETRIES = 3
TRANSIENT = {429, 500, 502, 503, 504}
LOCAL = threading.local()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".part")
    with temporary.open("w", encoding="utf-8", newline="\n") as target:
        json.dump(value, target, ensure_ascii=False, indent=2)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)


def allowed_url(url):
    parsed = urlsplit(url)
    decoded = unquote(parsed.path)
    return (
        parsed.scheme == "https"
        and parsed.netloc == HOST
        and parsed.path.startswith(PREFIX)
        and len(parsed.path) > len(PREFIX)
        and not parsed.fragment
        and "\\" not in decoded
        and not any(part in {".", ".."} for part in decoded.split("/"))
    )


def reference_key(url):
    # Query string is part of the identity: do not erase version/provenance.
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def load_references(source, expected):
    if sha256_file(source) != expected:
        raise ValueError("source_checksum_mismatch")
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    products = data["data"]["idb"]["bodega_products_v1"]
    if isinstance(products, str):
        products = json.loads(products)
    refs = {}
    inline = missing = 0
    for product in products:
        image = product.get("image")
        if isinstance(image, str) and image.startswith(("https://", "http://")):
            if not allowed_url(image):
                raise ValueError("image_reference_outside_allowlist")
            refs.setdefault(image, []).append(str(product.get("id", "")))
        elif isinstance(image, str) and image.startswith("data:image/"):
            inline += 1
        else:
            missing += 1
    return refs, {"products": len(products), "url_references": sum(map(len, refs.values())),
                  "unique_urls": len(refs), "inline_images_in_source": inline,
                  "products_without_public_or_inline_image": missing}


def session():
    if not hasattr(LOCAL, "session"):
        LOCAL.session = requests.Session()
        # Do not pick up netrc credentials or unrelated proxy authentication.
        LOCAL.session.trust_env = False
        LOCAL.session.headers.update({"User-Agent": "PreciosAlDia-ReadOnlyBackup/1",
                                      "Accept-Encoding": "identity"})
    return LOCAL.session


def download(url, root):
    if not allowed_url(url):
        return {"status": "failed", "reason": "url_not_allowed", "attempts": 0}
    key = reference_key(url)
    target = root / "objects" / (key + ".bin")
    partial = target.with_suffix(".part")
    result = {"status": "failed", "reason": "not_started"}
    for attempt in range(1, RETRIES + 1):
        result = {"status": "failed", "attempts": attempt}
        try:
            with session().get(url, stream=True, timeout=(8, 15), allow_redirects=False) as response:
                result["http_status"] = response.status_code
                if response.status_code in TRANSIENT:
                    result["reason"] = "transient_http"
                elif response.status_code != 200:
                    result["reason"] = "http_error_or_redirect"
                    return result
                else:
                    mime = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                    result["content_type"] = mime
                    if not mime.startswith("image/"):
                        result["reason"] = "not_image_content_type"
                        return result
                    advertised = response.headers.get("Content-Length")
                    if advertised is not None and (not advertised.isdigit() or int(advertised) > MAX_BYTES):
                        result["reason"] = "invalid_or_oversize_content_length"
                        return result
                    size = 0
                    digest = hashlib.sha256()
                    deadline = time.monotonic() + 45
                    with partial.open("wb") as output:
                        for chunk in response.iter_content(64 * 1024):
                            if time.monotonic() > deadline:
                                raise TimeoutError("object_deadline")
                            size += len(chunk)
                            if size > MAX_BYTES:
                                raise ValueError("object_too_large")
                            output.write(chunk)
                            digest.update(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    if size == 0 or (advertised is not None and size != int(advertised)):
                        result["reason"] = "empty_or_length_mismatch"
                        return result
                    # Hash file actually persisted, not only the network stream.
                    checksum = digest.hexdigest()
                    if sha256_file(partial) != checksum:
                        result["reason"] = "persisted_checksum_mismatch"
                        return result
                    partial.replace(target)
                    return {**result, "status": "ok", "bytes": size, "sha256": checksum,
                            "file": "objects/" + target.name, "etag": response.headers.get("ETag"),
                            "last_modified": response.headers.get("Last-Modified"),
                            "acquired_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        except (requests.RequestException, TimeoutError):
            result["reason"] = "network_or_deadline"
        except ValueError:
            result["reason"] = "invalid_or_oversize_object"
            return result
        except OSError:
            result["reason"] = "local_io_error"
            return result
        finally:
            partial.unlink(missing_ok=True)
        if attempt < RETRIES:
            time.sleep(attempt)
    return result


def valid_receipt(root, url):
    key = reference_key(url)
    receipt_path = root / "receipts" / (key + ".json")
    if not receipt_path.exists():
        return None
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    target = root / "objects" / (key + ".bin")
    if (receipt.get("url_original") != url or receipt.get("status") != "ok"
            or receipt.get("file") != "objects/" + target.name or not target.is_file()
            or target.stat().st_size != receipt.get("bytes")
            or sha256_file(target) != receipt.get("sha256")):
        return None
    return receipt


def summary(root, refs, coverage, expected, selected, elapsed):
    records = []
    for url, product_ids in refs.items():
        path = root / "receipts" / (reference_key(url) + ".json")
        if path.exists():
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("url_original") != url:
                raise ValueError("receipt_identity_mismatch")
            records.append(record)
    successes = [r for r in records if r.get("status") == "ok"]
    failed = sum(r.get("status") != "ok" for r in records)
    value = {**coverage, "source_sha256": expected, "selected_this_run": selected,
             "saved_urls": len(successes), "failed_urls": failed,
             "pending_urls": len(refs) - len(records), "saved_bytes": sum(r["bytes"] for r in successes),
             "elapsed_seconds_this_run": round(elapsed, 2),
             "complete_reference_acquisition": len(successes) == len(refs),
             "scope": "JSON public image URLs only; not a complete bucket export or historical version guarantee",
             "encrypted": False, "second_copy_verified": False, "database_restore_verified": False}
    atomic_json(root / "manifest.json", {"summary": value, "objects": records})
    atomic_json(root / "summary.json", value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    root = args.output.resolve()
    checkout = Path(__file__).resolve().parent.parent
    if root == checkout or checkout in root.parents:
        parser.error("Private backup output must be outside the checkout")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    refs, coverage = load_references(args.source, args.expected_source_sha256)
    root.mkdir(parents=True, exist_ok=True)
    lock = root / ".acquisition.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        parser.error("Acquisition locked: inspect the owning process before removing a stale lock")
    os.write(descriptor, str(os.getpid()).encode("ascii"))
    os.close(descriptor)
    started = time.monotonic()
    try:
        for folder in ("objects", "receipts"):
            (root / folder).mkdir(exist_ok=True)
        private_source = root / "source-backup.json"
        if private_source.exists():
            if sha256_file(private_source) != args.expected_source_sha256:
                raise ValueError("preserved_source_checksum_mismatch")
        else:
            partial_source = root / "source-backup.json.part"
            shutil.copyfile(args.source, partial_source)
            if sha256_file(partial_source) != args.expected_source_sha256:
                raise ValueError("source_copy_checksum_mismatch")
            partial_source.replace(private_source)
        pending = []
        verified = 0
        for url in refs:
            if valid_receipt(root, url):
                verified += 1
            else:
                pending.append(url)
                # Never leave a previously OK receipt after hash verification failed.
                path = root / "receipts" / (reference_key(url) + ".json")
                if path.exists():
                    previous = json.loads(path.read_text(encoding="utf-8"))
                    if previous.get("status") == "ok":
                        atomic_json(path, {**previous, "status": "failed",
                                           "reason": "not_verified_on_resume"})
        print(json.dumps({"unique_urls": len(refs), "verified_saved": verified,
                          "remaining": len(pending)}, sort_keys=True), flush=True)
        if args.verify_only:
            value = summary(root, refs, coverage, args.expected_source_sha256, 0, time.monotonic() - started)
            print(json.dumps(value, sort_keys=True), flush=True)
            return 0 if not pending else 1
        selected = pending[:args.limit] if args.limit else pending
        used = sum(p.stat().st_size for p in (root / "objects").iterdir() if p.is_file())
        if used + len(selected) * MAX_BYTES > MAX_TOTAL_BYTES:
            # Per-object worst case is reserved in small waves, not all at once.
            print("Total budget 2 GiB enforced between bounded waves", flush=True)
        # Reuse worker sessions across waves: bounded concurrency with keep-alive.
        with ThreadPoolExecutor(max_workers=4) as pool:
            for start in range(0, len(selected), 4):
                wave = selected[start:start + 4]
                if used + len(wave) * MAX_BYTES > MAX_TOTAL_BYTES or shutil.disk_usage(root).free < len(wave) * MAX_BYTES + 100 * 1024 * 1024:
                    raise OSError("insufficient_disk_or_total_budget")
                futures = {pool.submit(download, url, root): url for url in wave}
                for future in as_completed(futures):
                    url = futures[future]
                    result = {"url_original": url, "product_ids": refs[url], **future.result()}
                    atomic_json(root / "receipts" / (reference_key(url) + ".json"), result)
                used = sum(p.stat().st_size for p in (root / "objects").iterdir() if p.is_file())
                if start == 0 or (start + len(wave)) % 100 == 0:
                    value = summary(root, refs, coverage, args.expected_source_sha256, len(selected), time.monotonic() - started)
                    print(json.dumps({"processed_this_run": start + len(wave), "saved": value["saved_urls"],
                                      "failed": value["failed_urls"], "bytes": value["saved_bytes"]}), flush=True)
        value = summary(root, refs, coverage, args.expected_source_sha256, len(selected), time.monotonic() - started)
        print(json.dumps(value, sort_keys=True), flush=True)
        failures = any(valid_receipt(root, url) is None for url in selected)
        return 1 if failures else 0
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
