using System;
using UnityEngine;
namespace RobotForge {
 [Serializable] public class RobotJoint {public string id;public Transform target;public Vector3 localAxis;public Quaternion home;public float lower,upper;public float value;}
 [Serializable] public class RobotVisual {public string link;public Transform target;public Vector3 home,offset;public Renderer renderer;}
 public class RobotManifest:MonoBehaviour {
  public string assetId;public string[] linkIds;public RobotJoint[] joints;public RobotVisual[] visuals;
  public void Pose(string id,float radians){var j=Array.Find(joints,x=>x.id==id);if(j==null)throw new ArgumentException("Joint not recorded");if(float.IsNaN(radians)||float.IsInfinity(radians))throw new ArgumentException("Invalid joint value");j.value=Mathf.Clamp(radians,j.lower,j.upper);j.target.localRotation=j.home*Quaternion.AngleAxis(j.value*Mathf.Rad2Deg,j.localAxis);}
  public void ResetPose(){foreach(var j in joints)Pose(j.id,0);}
  public void Display(string selected,string[] hidden,float explode){foreach(var v in visuals){if(v.target==null)continue;v.target.gameObject.SetActive(Array.IndexOf(hidden,v.link)<0);v.target.localPosition=v.home+v.offset*Mathf.Clamp01(explode);if(v.renderer){var block=new MaterialPropertyBlock();v.renderer.GetPropertyBlock(block);block.SetColor("_EmissionColor",v.link==selected?new Color(.05f,.5f,.5f):Color.black);v.renderer.SetPropertyBlock(block);}}}
 }
}
