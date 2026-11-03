"""Workshop imagery must distinguish actual captures from approximate geometry."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
G = ROOT / 'web-next/src/components/garage'

def test_generated_geometry_is_opt_in():
    media = (G / 'PhotoSpin.tsx').read_text()
    assert "'reference'" in media
    assert 'Inspect concept model' in media
    assert "view === 'model'" in media
    assert 'No photo of this robot yet' in media
    assert 'onPhotoSave' in media

def test_visuals_start_still():
    assert 'const [spin, setSpin] = useState(false)' in (G / 'OverviewTurntable.tsx').read_text()
    assert 'const [playing, setPlaying] = useState(false)' in (G / 'PhotoSpin.tsx').read_text()
    assert 'const [turning, setTurning] = useState(false)' in (G / 'TwinView.tsx').read_text()
    assert 'const [turning, setTurning] = useState(false)' in (G / 'ScanView.tsx').read_text()

def test_omega1_uses_recorded_photo_and_keeps_estimates_labelled():
    twin = (G / 'Omega1Twin.tsx').read_text()
    assert 'OMEGA1_PHOTO' in twin and 'Inspect estimated reconstruction' in twin
    assert (ROOT / 'assets/omega1-twin/omega1-real-photo.png').exists()
    assert 'not measurements' in twin
