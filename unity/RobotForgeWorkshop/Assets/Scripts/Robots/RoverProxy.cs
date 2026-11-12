using System;
using UnityEngine;
namespace RobotForge {
 public static class RoverProxy {
  public static void Configure(RobotManifest robot,RoverSpec spec){if(spec==null||spec.length<=0||spec.width<=0||spec.height<=0||spec.mass<=0||spec.wheelDiameter<=0||spec.length>3||spec.width>3||spec.height>3||spec.mass>200||!float.IsFinite(spec.mass))throw new ArgumentException("Invalid rover dimensions");robot.transform.localScale=new Vector3(spec.width,spec.height,spec.length);}
  public static RobotManifest Build(){var root=new GameObject("Estimated rover proxy");var m=root.AddComponent<RobotManifest>();m.assetId="rover-proxy";var body=GameObject.CreatePrimitive(PrimitiveType.Cube);body.name="chassis";body.transform.SetParent(root.transform);body.transform.localPosition=new Vector3(0,.5f,0);body.AddComponent<SelectableLink>().linkId="chassis";m.linkIds=new[]{"chassis"};m.joints=new RobotJoint[0];m.visuals=new[]{new RobotVisual{link="chassis",target=body.transform,home=body.transform.localPosition,offset=Vector3.up*.3f,renderer=body.GetComponent<Renderer>()}};return m;}
 }
}
