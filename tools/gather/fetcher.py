"""Fetch + content-addressed cache for the gather pipeline.

Design rules (Forge Engine §8 / §8.1):
- Pages are cached by SHA-256 of their bytes. A re-fetch whose hash matches
  the cached hash is reported `changed=False` and is NEVER re-extracted —
  repeat runs over unchanged sources cost zero model calls.
- Within a page's TTL the network is not touched at all.
- Per-domain politeness: a minimum interval between requests to one host,
  an identifying User-Agent, and robots.txt is respected (a disallowed path
  is skipped and the skip is reported, never fetched anyway).
- Conditional requests (ETag / Last-Modified) are used when the server
  offered them, so a 304 also counts as unchanged.
"""
from __future__ import annotations

import hashlib
import html.parser
import io
import json
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import zlib
from dataclasses import dataclass, field
from typing import Callable
from pathlib import Path

USER_AGENT = (
    "RobotForge-Gather/0.1 "
    "(+https://github.com/abelxmendoza/RobotForge-Hackathon)"
)


# ---------------------------------------------------------------- transport

@dataclass
class TransportResponse:
    status: int
    headers: dict
    body: bytes


class Transport:
    """Anything that can GET a URL. Tests inject a fake; production uses HTTP."""

    def get(self, url: str, headers: dict) -> TransportResponse:  # pragma: no cover
        raise NotImplementedError


class UrlLibTransport(Transport):
    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def get(self, url: str, headers: dict) -> TransportResponse:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return TransportResponse(
                    status=resp.status,
                    headers={k.lower(): v for k, v in resp.headers.items()},
                    body=resp.read(),
                )
        except urllib.error.HTTPError as e:  # 304 / 404 / ... arrive here
            return TransportResponse(
                status=e.code,
                headers={k.lower(): v for k, v in (e.headers.items() if e.headers else [])},
                body=e.read() if e.fp else b"",
            )


# ---------------------------------------------------------------- text out

class _TextExtractor(html.parser.HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip_depth += 1
        if tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4"):
            self.chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth:
            self.chunks.append(data)


def html_to_text(raw: bytes) -> str:
    parser = _TextExtractor()
    parser.feed(raw.decode("utf-8", errors="replace"))
    text = "".join(parser.chunks)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def _pdf_text_fallback(raw: bytes) -> str:
    """Minimal stdlib PDF text pull: inflate FlateDecode streams and collect
    the string operands of Tj / TJ operators. Good enough for simple
    datasheet text layers; pdftotext is preferred when installed."""
    out: list[str] = []
    for match in re.finditer(rb"stream\r?\n(.*?)endstream", raw, re.S):
        data = match.group(1)
        try:
            data = zlib.decompress(data)
        except zlib.error:
            pass  # uncompressed stream: use as-is
        for s in re.findall(rb"\((?:[^()\\]|\\.)*\)", data):
            try:
                txt = s[1:-1].decode("latin-1")
                txt = txt.replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\")
                out.append(txt)
            except Exception:
                continue
    return " ".join(out).strip()


def pdf_to_text(raw: bytes) -> str:
    exe = shutil.which("pdftotext")
    if exe:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "in.pdf"
            dst = Path(td) / "out.txt"
            src.write_bytes(raw)
            proc = subprocess.run(
                [exe, "-layout", str(src), str(dst)],
                capture_output=True, timeout=60,
            )
            if proc.returncode == 0 and dst.exists():
                text = dst.read_text(errors="replace").strip()
                if text:
                    return text
    return _pdf_text_fallback(raw)


def bytes_to_text(raw: bytes) -> str:
    if raw[:5] == b"%PDF-":
        return pdf_to_text(raw)
    return html_to_text(raw)


# ---------------------------------------------------------------- fetcher

@dataclass
class FetchResult:
    url: str
    final_url: str = ""
    status: int = 0
    content_hash: str = ""
    changed: bool = False
    fetched_at: float = 0.0
    from_cache: bool = False
    skipped_reason: str = ""
    text: str = ""


@dataclass
class Fetcher:
    cache_dir: Path
    transport: Transport = field(default_factory=UrlLibTransport)
    min_interval_s: float = 2.0
    clock: "Callable[[], float]" = field(default=time.time)
    sleeper: "Callable[[float], None]" = field(default=time.sleep)
    robots_enabled: bool = True

    def __post_init__(self):
        self.cache_dir = Path(self.cache_dir)
        (self.cache_dir / "blobs").mkdir(parents=True, exist_ok=True)
        (self.cache_dir / "text").mkdir(parents=True, exist_ok=True)
        self.index_path = self.cache_dir / "index.json"
        if self.index_path.exists():
            self.index = json.loads(self.index_path.read_text())
        else:
            self.index = {"urls": {}, "domains": {}}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    # -- persistence ------------------------------------------------------
    def _save_index(self):
        tmp = self.index_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.index, indent=1, sort_keys=True))
        tmp.replace(self.index_path)

    def _blob_path(self, digest: str) -> Path:
        return self.cache_dir / "blobs" / digest

    def _text_path(self, digest: str) -> Path:
        return self.cache_dir / "text" / (digest + ".txt")

    def _text_for(self, digest: str, raw: bytes | None = None) -> str:
        tp = self._text_path(digest)
        if tp.exists():
            return tp.read_text(errors="replace")
        if raw is None:
            raw = self._blob_path(digest).read_bytes()
        text = bytes_to_text(raw)
        tp.write_text(text)
        return text

    # -- robots ------------------------------------------------------------
    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser | None:
        host = urllib.parse.urlparse(url).netloc
        if host in self._robots:
            return self._robots[host]
        parser = None
        scheme = urllib.parse.urlparse(url).scheme
        if scheme in ("http", "https"):
            robots_url = f"{scheme}://{host}/robots.txt"
            try:
                resp = self.transport.get(robots_url, {"User-Agent": USER_AGENT})
                if resp.status == 200:
                    parser = urllib.robotparser.RobotFileParser()
                    parser.parse(resp.body.decode("utf-8", errors="replace").splitlines())
                # 4xx on robots.txt: per RFC 9309, treat as no restrictions.
            except Exception:
                parser = None  # unreachable robots: record, treat as allow
        self._robots[host] = parser
        return parser

    # -- main entry ---------------------------------------------------------
    def fetch(self, url: str, ttl_seconds: float, force: bool = False) -> FetchResult:
        now = self.clock()
        entry = self.index["urls"].get(url)
        if entry and not force and (now - entry["fetched_at"]) < ttl_seconds:
            return FetchResult(
                url=url, final_url=entry.get("final_url", url), status=200,
                content_hash=entry["hash"], changed=False,
                fetched_at=entry["fetched_at"], from_cache=True,
                text=self._text_for(entry["hash"]),
            )

        parsed = urllib.parse.urlparse(url)
        if parsed.scheme in ("http", "https"):
            # politeness: min interval per host
            dom = self.index["domains"].setdefault(parsed.netloc, {})
            last = dom.get("last_fetch", 0.0)
            wait = self.min_interval_s - (now - last)
            if wait > 0:
                self.sleeper(wait)
                now = self.clock()
            if self.robots_enabled:
                parser = self._robots_for(url)
                if parser is not None and not parser.can_fetch(USER_AGENT, url):
                    return FetchResult(
                        url=url, fetched_at=now,
                        skipped_reason="robots.txt disallows this path",
                    )

        headers = {"User-Agent": USER_AGENT}
        if entry:
            if entry.get("etag"):
                headers["If-None-Match"] = entry["etag"]
            if entry.get("last_modified"):
                headers["If-Modified-Since"] = entry["last_modified"]
        try:
            resp = self.transport.get(url, headers)
        except Exception as e:  # DNS, TLS, timeouts: report, never crash a run
            return FetchResult(url=url, fetched_at=now,
                               skipped_reason=f"fetch error: {type(e).__name__}: {e}")
        if parsed.scheme in ("http", "https"):
            self.index["domains"].setdefault(parsed.netloc, {})["last_fetch"] = self.clock()

        if resp.status == 304 and entry:
            entry["fetched_at"] = self.clock()
            self._save_index()
            return FetchResult(
                url=url, final_url=entry.get("final_url", url), status=304,
                content_hash=entry["hash"], changed=False,
                fetched_at=entry["fetched_at"], from_cache=True,
                text=self._text_for(entry["hash"]),
            )
        if resp.status != 200:
            return FetchResult(url=url, status=resp.status, fetched_at=self.clock(),
                               skipped_reason=f"http status {resp.status}")

        digest = hashlib.sha256(resp.body).hexdigest()
        blob = self._blob_path(digest)
        if not blob.exists():
            blob.write_bytes(resp.body)
        changed = (entry is None) or (entry.get("hash") != digest)
        self.index["urls"][url] = {
            "hash": digest,
            "fetched_at": self.clock(),
            "etag": resp.headers.get("etag", ""),
            "last_modified": resp.headers.get("last-modified", ""),
            "final_url": url,
        }
        self._save_index()
        text = self._text_for(digest, raw=resp.body)
        result = FetchResult(
            url=url, final_url=url, status=200, content_hash=digest,
            changed=changed, fetched_at=self.index["urls"][url]["fetched_at"],
            from_cache=False, text=text,
        )
        if not text:
            result.skipped_reason = "no text extracted from page"
        return result
