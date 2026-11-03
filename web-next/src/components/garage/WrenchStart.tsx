'use client';
import { promptWrench } from '@/lib/wrenchPrompt';
export default function WrenchStart({ expanded = false }: { expanded?: boolean }) {
  return <details className="ws-start" open={expanded}><summary>Create or improve your twin — photos, ideas &amp; optional scans</summary>
    <div><span className="eyebrow">One place to start</span><h3>Show Wrench your robot. Or describe an idea.</h3><p>A phone photo is enough to start an estimated draft. No scanner or special camera required.</p></div>
    <div className="ws-start-actions">
      <button type="button" className="btn btn-primary btn-sm" onClick={() => promptWrench({mode:'chat',text:'Create a twin draft from this robot photo.',attach:true})}>Add photos in Wrench</button>
      <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'design',text:'Generate a compact rover with a camera.'})}>Describe an idea</button>
      <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:'Make the wheels 100 mm'})}>Describe a change</button>
    </div>
    <details><summary>Want a more detailed 3D model?</summary><p>Optional: scan the real robot with <a href="https://scaniverse.com/support" target="_blank" rel="noreferrer">Scaniverse on your phone</a>, or capture depth with an <a href="https://github.com/realsenseai/librealsense/wiki/Realsense-Viewer-Manual" target="_blank" rel="noreferrer">Intel RealSense camera</a>. Then attach the exported file to Wrench.</p><p className="faint g-small">Use a GLB mesh for a textured model, OBJ for geometry, or PLY for a mesh or point cloud. Gaussian splats are not supported. A scan improves shape; scale and physical properties still need checking.</p><button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:'Add this 3D scan to my robot.',attach:true})}>Attach a scan in Wrench</button></details>
    <p className="faint g-small">Ideas stay marked Planned. Ask Wrench to regenerate a concept or describe a modification; previous versions stay in History.</p>
  </details>;
}
