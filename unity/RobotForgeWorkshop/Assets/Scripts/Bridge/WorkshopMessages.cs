using System;
using UnityEngine;
namespace RobotForge {
 [Serializable] public class SceneIdentity {public int protocolVersion=1;public string sessionId,robotId,versionId,draftRevision;public bool Matches(SceneIdentity other)=>other!=null&&protocolVersion==other.protocolVersion&&sessionId==other.sessionId&&robotId==other.robotId&&versionId==other.versionId&&draftRevision==other.draftRevision;public bool Valid()=>protocolVersion==1&&ValidId(sessionId)&&ValidId(robotId)&&ValidId(versionId)&&ValidId(draftRevision);static bool ValidId(string s)=>!string.IsNullOrEmpty(s)&&s.Length<=200;}
 [Serializable] public class JointPose {public string name;public float radians;}
 // JsonUtility cannot deserialize dictionary fields. Snapshot wire format uses
 // jointValues alongside the TS joint map; bridge serializes the conversion.
 [Serializable] public class RoverSpec {public float length,width,height,mass,wheelDiameter;}
 [Serializable] public class SceneSnapshot:SceneIdentity {public string assetId,selectedLink,evidence;public string[] hiddenLinks=new string[0];public float explode;public JointPose[] jointValues=new JointPose[0];public RoverSpec rover;}
 [Serializable] public class CommandPayload:SceneSnapshot {public string link,joint;public bool visible,paused;public float amount,radians;}
 [Serializable] public class SceneCommand:SceneIdentity {public string requestId,operation;public CommandPayload payload;}
 [Serializable] public class SceneResult:SceneIdentity {public string type="result",requestId,status,message;public SceneSnapshot state;}
 [Serializable] public class ReadyMessage {public string type="ready",buildId;public int protocolVersion=1;public string[] operations={"loadSnapshot","selectLink","setVisibility","setExplode","setJointPose","nextLink","resetView","pauseScene","explainLink"};}
}
