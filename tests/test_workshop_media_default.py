"""Workshop imagery must distinguish actual captures from approximate geometry."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
G = ROOT / 'web-next/src/components/garage'

def test_overview_opens_on_the_3d_view():
    media = (G / 'PhotoSpin.tsx').read_text()
    assert "'reference'" in media
    assert '3D model' in media
    assert 'Inspect concept model' not in media
    assert "view === 'model'" in media
    assert 'No photo of this robot yet' in media
    assert 'onPhotoSave' in media
    # 3D first (owner-directed 2026-11-03): the owner's own scan when
    # there is one, else the 3D model when a real one is ready; the
    # photo views stay one switch away.
    assert "scan ? 'scan' : modelReady ? 'model'" in media
    assert 'modelNote' in media

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

def test_garage_wires_the_twin_as_omega1s_model():
    garage = (G / 'Garage.tsx').read_text()
    # Omega1 identity is the canonical id OR an Omega1 name match
    # (feat/omega1-identity-pi4b): a photo import renamed "Omega1" gets
    # the twin too. The id-only pin was updated for that fix.
    assert 'modelReady={isOmegaRobot || hasBody(draft)}' in garage
    assert 'Omega1 digital twin' in garage
