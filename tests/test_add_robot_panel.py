"""Workshop "Add a Robot" panel: every add route is a distinct
option (Abel, 2026-11-03).

Guards:
 1. The two original Wrench buttons keep their exact wiring, and
    "Add from Robodex" sits alongside them in the same panel.
 2. The Robodex picker lists catalog robots AND sightings, grouped
    by the filing the Robodex tabs resolve (overrides included),
    each row labelled from ROBOT_SOURCE_META — and adding goes
    through the ONE shared bring-in (bringDexRobotIntoWorkshop in
    DexSources, the Robodex cards' own path). No second
    Garage-writing implementation in the picker.
 3. Already-in-Workshop rows say so and cannot be re-added; a
    sighting with no recorded spec shows the honest no-spec state
    and offers the attach-to-Wrench route instead of an add.
 4. The photos and scan routes are distinct promptWrench seeds
    with the file picker open.
 5. The scan option teaches Scaniverse: the copy names it, the QR
    asset is the committed static file, and the URL the QR encodes
    (recorded in the asset itself) equals the plain link's target
    equals the URL named in the code — scaniverse.com, Niantic
    Spatial's official site, verified live 2026-11-03.
 6. The RealSense modal is an honest live view: getUserMedia +
    device enumeration, every track stopped on close, copy that
    says plainly it is NOT a depth scan and points measured scans
    at RealSense Viewer + .ply through the scan route.
 7. Demo mode: neither new surface touches localStorage directly;
    all storage flows through lib/store (demo twins) or the
    shared bring-in.
"""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next" / "src"
GARAGE = (WEB / "components/garage/Garage.tsx").read_text()
PICKER = (WEB / "components/garage/RobodexPicker.tsx").read_text()
REALSENSE = (WEB / "components/garage/RealSenseModal.tsx").read_text()
DEX = (WEB / "components/robots/DexSources.tsx").read_text()
QR_SVG = REPO / "assets" / "img" / "scaniverse-qr.svg"


# ------------------------------------------------------- 1. the panel

def test_panel_keeps_original_buttons_and_adds_robodex():
    # existing wiring, byte-for-byte the calls the panel always made
    assert "promptWrench({mode:'chat',text:'',attach:true})" in GARAGE
    assert "promptWrench({mode:'design',text:'Generate a robot '})" in GARAGE
    assert ">Attach files to Wrench</button>" in GARAGE
    assert ">Describe a new concept</button>" in GARAGE
    # the new option, on equal footing in the same panel
    panel = GARAGE.split("function AddRobot")[1].split("function EmptyBench")[0]
    assert ">Add from Robodex</button>" in panel
    assert "setDexOpen(true)" in panel
    assert "<RobodexPicker" in panel
    # the sub-line teaches all the routes now
    assert "bring one in from your Robodex" in panel
    assert "Scaniverse" in panel and "Intel RealSense" in panel


def test_picker_lands_on_the_new_robot_like_other_adds():
    # Garage's other add flows select the robot and close the panel;
    # a picker add hands the new entry's id to the same landing.
    assert "onOpenRobot" in GARAGE
    assert "setSelected(id); setTwinOpen(false); setAdding(false)" in GARAGE
    assert "onAdded={(id)" in GARAGE


# ---------------------------------------------------- 2. picker listing

def test_picker_lists_the_whole_robodex_with_source_labels():
    # the same resolved model the /robots tabs read — overrides first
    assert "useDexSources()" in PICKER
    assert "model.catalogByTab[tab]" in PICKER
    assert "model.sightingsByTab[tab]" in PICKER
    # grouped in Robodex order, My robots last (already the owner's)
    assert 'GROUP_ORDER: DexTab[] = ["sighted", "photos", "researched", "mine"]' in PICKER
    # row labels from the one source-meta table, via the tab conversion
    assert "ROBOT_SOURCE_META[dexTabToRobotSource(tab)].label" in PICKER


def test_picker_adds_through_the_one_shared_bring_in():
    # DexSources owns the construction; its card component uses it too
    assert "export async function bringDexRobotIntoWorkshop" in DEX
    assert "await bringDexRobotIntoWorkshop({ name, specFile, draftSpec })" in DEX
    # the picker calls it — and writes nothing itself
    assert "bringDexRobotIntoWorkshop({ name, specFile, draftSpec })" in PICKER
    assert "writeStore" not in PICKER
    assert "buildDexEntry" not in PICKER  # construction stays in DexSources/saveRobot


# ------------------------------------------------- 3. guards + honesty

def test_picker_duplicate_guard_and_spec_less_honesty():
    # name-matched against the same Garage store the cards check
    assert "useStore<GarageRobot[]>(GARAGE_KEY, [])" in PICKER
    assert "In your Workshop ✓" in PICKER
    # no recorded spec -> no invented entry, the Wrench route instead
    assert "No recorded spec to bring in" in PICKER
    assert "Attach files to Wrench" in PICKER


# --------------------------------------------- 4. photos + scan routes

def test_photos_and_scan_routes_are_distinct_wrench_seeds():
    # photos: chat mode, photo intent seeded, file picker opens
    assert "promptWrench({mode:'chat',text:'Add a robot from these photos.',attach:true})" in GARAGE
    assert ">Add photos through Wrench</button>" in GARAGE
    # scan: its own seed, fired from inside the scan expansion
    assert "promptWrench({mode:'chat',text:'Add a robot from this 3D scan.',attach:true})" in GARAGE
    assert ">Add a scan through Wrench</button>" in GARAGE
    assert ">Attach a scan in Wrench</button>" in GARAGE


# ------------------------------------------------------ 5. Scaniverse

def test_scaniverse_qr_and_link_encode_the_verified_url():
    panel = GARAGE.split("function AddRobot")[1].split("function EmptyBench")[0]
    # the one URL, named in code, used as the plain link's target
    assert "const SCANIVERSE_URL = 'https://scaniverse.com';" in GARAGE
    assert "href={SCANIVERSE_URL}" in panel
    assert "scaniverse.com" in panel  # and readable as text, not only a code
    # the QR is a committed static asset (no runtime QR dependency)
    assert "assetPath('assets/img/scaniverse-qr.svg')" in panel
    assert QR_SVG.exists(), "the static Scaniverse QR asset is committed"
    # the asset records the URL it encodes; it must be the same URL
    assert "QR code encoding https://scaniverse.com" in QR_SVG.read_text()


# ------------------------------------------------------- 6. RealSense

def test_realsense_modal_is_an_honest_live_view():
    assert "Intel RealSense" in REALSENSE
    # live view wiring: open the camera, list devices for the picker
    assert "navigator.mediaDevices.getUserMedia" in REALSENSE
    assert "enumerateDevices" in REALSENSE
    assert "videoinput" in REALSENSE
    # closing stops every track — the camera is released
    assert "getTracks().forEach((t) => t.stop())" in REALSENSE
    # no-camera / denied states say what to check
    assert "No camera found" in REALSENSE and "USB cable" in REALSENSE
    assert "camera permission" in REALSENSE
    # honesty: the view is colour video, NOT a depth scan, and the
    # measured path is RealSense Viewer -> .ply -> the scan route
    assert "not a depth scan" in REALSENSE
    assert "nothing here is measured" in REALSENSE
    assert "RealSense Viewer" in REALSENSE and ".ply" in REALSENSE
    # the panel opens it as its own option
    assert ">Connect Intel RealSense camera</button>" in GARAGE
    assert "<RealSenseModal" in GARAGE


# --------------------------------------------------------- 7. demo mode

def test_new_surfaces_never_touch_storage_directly():
    # lib/store resolves visitor keys to their demo twins; a direct
    # localStorage call would bypass the sandbox.
    assert "localStorage" not in PICKER
    assert "localStorage" not in REALSENSE
