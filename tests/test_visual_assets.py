"""Vendored visual assets must keep provenance, byte integrity and native scale."""
import hashlib
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web-next/public/models/turtlebot3'


class VisualAssetTests(unittest.TestCase):
    def test_lds_provenance_and_scale(self):
        meta = json.loads((ASSETS / 'provenance.json').read_text())
        data = (ASSETS / meta['asset']).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), meta['sha256'])
        self.assertIn(meta['revision'], meta['source'])
        self.assertEqual(meta['license'], 'Apache-2.0')
        self.assertIn('Apache License', (ASSETS / meta['licenseFile']).read_text())
        count = struct.unpack_from('<I', data, 80)[0]
        self.assertEqual(len(data), 84 + 50 * count)
        vertices = [struct.unpack_from('<3f', data, 84 + i*50 + 12 + j*12)
                    for i in range(count) for j in range(3)]
        for axis, expected in enumerate(meta['boundsMm']):
            extent = max(v[axis] for v in vertices) - min(v[axis] for v in vertices)
            self.assertAlmostEqual(extent, expected, places=5)
        self.assertEqual(meta['scaleToMetres'], 0.001)
        self.assertLess(max(meta['boundsMm']) * meta['scaleToMetres'], 0.1)


if __name__ == '__main__':
    unittest.main()
