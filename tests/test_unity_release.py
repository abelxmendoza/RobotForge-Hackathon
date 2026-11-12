"""Release hydration integrity, distinct from Unity runtime verification."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def test_cached_player_is_verified_before_export(tmp_path):
    web = tmp_path / 'web'
    (web / 'scripts').mkdir(parents=True)
    (web / 'scripts/fetch-unity.mjs').write_bytes((ROOT / 'web-next/scripts/fetch-unity.mjs').read_bytes())
    pin = json.loads((ROOT / 'web-next/unity-release.json').read_text())
    (web / 'unity-release.json').write_text(json.dumps(pin))
    dest = tmp_path / 'staged'
    player = dest / pin['buildId']
    player.mkdir(parents=True)
    manifest = {'protocolVersion': 1, 'buildId': pin['buildId'], 'files': {}}
    for role in ('loader', 'data', 'framework', 'wasm'):
        data = ('synthetic ' + role).encode()
        (player / role).write_bytes(data)
        url = f"/unity/{pin['buildId']}/{role}"
        manifest[role] = url
        manifest['files'][url] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    pointer = dest / 'current.json'
    pointer.write_text(json.dumps(manifest))
    env = dict(os.environ, RF_UNITY_STAGE_DEST=str(dest))
    def hydrate():
        return subprocess.run(['node', str(web / 'scripts/fetch-unity.mjs')], capture_output=True, text=True, env=env, timeout=10)
    assert hydrate().returncode == 0
    before = pointer.read_bytes()
    (player / 'wasm').write_bytes(b'corrupted fixture')
    result = hydrate()
    assert result.returncode != 0
    assert 'integrity failed' in result.stderr
    assert pointer.read_bytes() == before
