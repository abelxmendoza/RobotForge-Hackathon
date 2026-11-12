#if UNITY_INCLUDE_TESTS
using NUnit.Framework;
using UnityEngine;
using RobotForge.Editor;
namespace RobotForge.Tests {
 public class G1ImportTests {
  [Test]public void CoordinateBasisMapsForwardLeftAndUp(){Assert.AreEqual(Vector3.forward,ImportG1.ConvertPoint(Vector3.right));Assert.AreEqual(Vector3.left,ImportG1.ConvertPoint(Vector3.up));Assert.AreEqual(Vector3.up,ImportG1.ConvertPoint(Vector3.forward));}
  [Test]public void ZeroOrientationRemainsIdentity(){Assert.Less(Quaternion.Angle(Quaternion.identity,ImportG1.ConvertRotation(Vector3.zero)),.001f);}
  [Test]public void PositiveUrdfYawTurnsUnityForwardLeft(){var rotation=ImportG1.ConvertRotation(new Vector3(0,0,Mathf.PI/2));Assert.Less(Vector3.Distance(Vector3.left,rotation*Vector3.forward),.001f);}
  [Test]public void JointPoseClampsAndRejectsNonfinite(){var root=new GameObject();try{var manifest=root.AddComponent<RobotManifest>();manifest.joints=new[]{new RobotJoint{id="test",target=root.transform,home=Quaternion.identity,localAxis=Vector3.up,lower=-1,upper=1}};manifest.Pose("test",10);Assert.AreEqual(1,manifest.joints[0].value);Assert.Throws<System.ArgumentException>(()=>manifest.Pose("test",float.NaN));}finally{Object.DestroyImmediate(root);}}
 }
}
#endif
