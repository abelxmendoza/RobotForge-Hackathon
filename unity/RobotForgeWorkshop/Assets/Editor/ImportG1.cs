using System;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using System.Collections.Generic;
using System.Globalization;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
namespace RobotForge.Editor {
 public static class ImportG1 {
  public static Vector3 ConvertPoint(Vector3 v)=>new Vector3(-v.y,v.z,v.x);
  static Vector3 Vec(string v){var a=(v??"0 0 0").Split(new[]{' '},StringSplitOptions.RemoveEmptyEntries).Select(x=>float.Parse(x,CultureInfo.InvariantCulture)).ToArray();if(a.Length!=3)throw new Exception("Invalid URDF vector");return new Vector3(a[0],a[1],a[2]);}
  public static Quaternion ConvertRotation(Vector3 rpy){var q=Quaternion.AngleAxis(rpy.z*Mathf.Rad2Deg,Vector3.forward)*Quaternion.AngleAxis(rpy.y*Mathf.Rad2Deg,Vector3.up)*Quaternion.AngleAxis(rpy.x*Mathf.Rad2Deg,Vector3.right);return Quaternion.LookRotation(ConvertPoint(q*Vector3.right),ConvertPoint(q*Vector3.forward));}
  static void Origin(Transform t,XElement origin){t.localPosition=ConvertPoint(Vec((string)origin?.Attribute("xyz")));t.localRotation=ConvertRotation(Vec((string)origin?.Attribute("rpy")));}
  // Pinned Unitree assets are binary STL; reject any unsupported format.
  static Mesh ReadStl(string path){
   using(var stream=File.OpenRead(path))using(var r=new BinaryReader(stream)){
    r.ReadBytes(80);uint count=r.ReadUInt32();if(count>2000000||stream.Length!=84+count*50L)throw new Exception("Invalid binary STL "+path);
    var vertices=new Vector3[checked((int)count*3)];var triangles=new int[vertices.Length];
    for(int i=0;i<count;i++){r.ReadSingle();r.ReadSingle();r.ReadSingle();for(int j=0;j<3;j++)vertices[i*3+j]=ConvertPoint(new Vector3(r.ReadSingle(),r.ReadSingle(),r.ReadSingle()));triangles[i*3]=i*3;triangles[i*3+1]=i*3+2;triangles[i*3+2]=i*3+1;r.ReadUInt16();}
    var mesh=new Mesh{name=Path.GetFileNameWithoutExtension(path),indexFormat=IndexFormat.UInt32};mesh.vertices=vertices;mesh.triangles=triangles;mesh.RecalculateNormals();mesh.RecalculateBounds();return mesh;
   }
  }
  public static RobotManifest Build(string repoRoot){
   var source=Path.Combine(repoRoot,"assets/models/unitree-g1");var doc=XDocument.Load(Path.Combine(source,"g1_23dof.urdf"));var root=new GameObject("Unitree G1 reference");var manifest=root.AddComponent<RobotManifest>();manifest.assetId="unitree-g1-23";
   var links=doc.Root.Elements("link").ToDictionary(e=>(string)e.Attribute("name"),e=>new GameObject((string)e.Attribute("name")).transform);foreach(var t in links.Values)t.SetParent(root.transform,false);
   var joints=new List<RobotJoint>();
   foreach(var joint in doc.Root.Elements("joint")){
    var child=links[(string)joint.Element("child").Attribute("link")];child.SetParent(links[(string)joint.Element("parent").Attribute("link")],false);Origin(child,joint.Element("origin"));
    string type=(string)joint.Attribute("type");if(type=="fixed")continue;if(type!="revolute")throw new Exception("Unsupported joint "+type);
    var limit=joint.Element("limit");joints.Add(new RobotJoint{id=(string)joint.Attribute("name"),target=child,home=child.localRotation,localAxis=-ConvertPoint(Vec((string)joint.Element("axis")?.Attribute("xyz"))).normalized,lower=float.Parse((string)limit.Attribute("lower"),CultureInfo.InvariantCulture),upper=float.Parse((string)limit.Attribute("upper"),CultureInfo.InvariantCulture)});
   }
   var visuals=new List<RobotVisual>();int index=0;Directory.CreateDirectory("Assets/Generated/G1");
   foreach(var link in doc.Root.Elements("link"))foreach(var visual in link.Elements("visual")){
    var geometry=visual.Element("geometry");var meshNode=geometry.Element("mesh");if(meshNode==null)throw new Exception("Unsupported visual geometry");
    var name=(string)link.Attribute("name");var relative=((string)meshNode.Attribute("filename")).Replace("package://g1_description/","");var full=Path.GetFullPath(Path.Combine(source,relative));if(!full.StartsWith(Path.GetFullPath(source)+Path.DirectorySeparatorChar))throw new Exception("Invalid mesh path");
    var mesh=ReadStl(full);var meshPath=$"Assets/Generated/G1/mesh-{index}.asset";if(File.Exists(meshPath))AssetDatabase.DeleteAsset(meshPath);AssetDatabase.CreateAsset(mesh,meshPath);
    var obj=new GameObject(name+" visual");obj.transform.SetParent(links[name],false);Origin(obj.transform,visual.Element("origin"));obj.AddComponent<MeshFilter>().sharedMesh=mesh;
    var renderer=obj.AddComponent<MeshRenderer>();var mat=new Material(Shader.Find("Universal Render Pipeline/Lit"));mat.color=new Color(.8f,.83f,.86f);var rgba=(string)visual.Element("material")?.Element("color")?.Attribute("rgba");if(rgba!=null){var c=rgba.Split(' ').Select(v=>float.Parse(v,CultureInfo.InvariantCulture)).ToArray();mat.color=new Color(c[0],c[1],c[2],c[3]);}mat.EnableKeyword("_EMISSION");var materialPath=$"Assets/Generated/G1/material-{index}.mat";if(File.Exists(materialPath))AssetDatabase.DeleteAsset(materialPath);AssetDatabase.CreateAsset(mat,materialPath);renderer.sharedMaterial=mat;obj.AddComponent<MeshCollider>().sharedMesh=mesh;obj.AddComponent<SelectableLink>().linkId=name;
    visuals.Add(new RobotVisual{link=name,target=obj.transform,home=obj.transform.localPosition,offset=new Vector3(index%2==0?-.4f:.4f,.05f*(index%5),0),renderer=renderer});index++;
   }
   if(joints.Count!=23)throw new Exception("Expected 23 G1 actuated joints");manifest.linkIds=links.Keys.ToArray();manifest.joints=joints.ToArray();manifest.visuals=visuals.ToArray();manifest.ResetPose();
   var bounds=new Bounds(root.transform.position,Vector3.zero);foreach(var r in root.GetComponentsInChildren<Renderer>())bounds.Encapsulate(r.bounds);root.transform.position-=Vector3.up*bounds.min.y;return manifest;
  }
 }
}
