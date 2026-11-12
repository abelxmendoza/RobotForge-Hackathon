using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
namespace RobotForge {
 public class WorkshopBridge:MonoBehaviour {
  public RobotManifest g1,rover;public WorkshopCamera cameraRig;public string buildId="development";
  RobotManifest active;SceneSnapshot state;HashSet<string> seen=new HashSet<string>();
#if UNITY_WEBGL && !UNITY_EDITOR
  [DllImport("__Internal")]static extern void RobotForgeEmit(string json);
#endif
  void Emit(object value){var json=JsonUtility.ToJson(value);
#if UNITY_WEBGL && !UNITY_EDITOR
   RobotForgeEmit(json);
#else
   Debug.Log(json);
#endif
  }
  void Start(){
#if UNITY_WEBGL && !UNITY_EDITOR
   WebGLInput.captureAllKeyboardInput=false;
#endif
   Emit(new ReadyMessage{buildId=buildId});
  }
  public void Receive(string json){
   SceneCommand c=null;string outcome="rejected",message="Invalid command";
   try{
    if(string.IsNullOrEmpty(json)||json.Length>100000)throw new ArgumentException("Command too large");
    c=JsonUtility.FromJson<SceneCommand>(json);if(c==null||!c.Valid()||string.IsNullOrEmpty(c.requestId)||c.requestId.Length>400||c.payload==null)throw new ArgumentException("Invalid identity or payload");
    if(state!=null&&!state.Matches(c))throw new ArgumentException("Stale scene identity");
    if(seen.Contains(c.requestId))throw new ArgumentException("Duplicate command");if(seen.Count>4096)throw new ArgumentException("Session request budget reached; reload scene");
    seen.Add(c.requestId);
    if(c.operation=="loadSnapshot"){
     if(!c.payload.Valid()||!c.Matches(c.payload))throw new ArgumentException("Snapshot identity mismatch");
     var candidate=c.payload.assetId=="unitree-g1-23"?g1:c.payload.assetId=="rover-proxy"?rover:null;
     if(candidate==null)throw new ArgumentException("Robot asset unavailable");
     if(!float.IsFinite(c.payload.explode)||c.payload.explode<0||c.payload.explode>1||c.payload.hiddenLinks==null||c.payload.jointValues==null)throw new ArgumentException("Invalid snapshot state");
     if(!string.IsNullOrEmpty(c.payload.selectedLink)&&Array.IndexOf(candidate.linkIds,c.payload.selectedLink)<0)throw new ArgumentException("Unknown selected link");
     foreach(var id in c.payload.hiddenLinks)if(Array.IndexOf(candidate.linkIds,id)<0)throw new ArgumentException("Unknown hidden link");
     foreach(var pose in c.payload.jointValues)if(pose==null||!float.IsFinite(pose.radians)||Array.Find(candidate.joints,j=>j.id==pose.name)==null)throw new ArgumentException("Invalid joint pose");
     active=candidate;
     if(active==rover)RoverProxy.Configure(rover,c.payload.rover);
     g1.gameObject.SetActive(active==g1);rover.gameObject.SetActive(active==rover);
     state=c.payload;active.ResetPose();foreach(var pose in state.jointValues)active.Pose(pose.name,pose.radians);cameraRig.ResetView(active==g1?1.3f:.35f);
    }else{
     if(state==null)throw new ArgumentException("Load a robot first");
     switch(c.operation){
      case "selectLink":if(Array.IndexOf(active.linkIds,c.payload.link)<0)throw new ArgumentException("Unknown link");state.selectedLink=c.payload.link;break;
      case "nextLink":var index=Array.IndexOf(active.linkIds,state.selectedLink);state.selectedLink=active.linkIds[(index+1)%active.linkIds.Length];break;
      case "setVisibility":if(Array.IndexOf(active.linkIds,c.payload.link)<0)throw new ArgumentException("Unknown link");var hidden=new List<string>(state.hiddenLinks);hidden.Remove(c.payload.link);if(!c.payload.visible)hidden.Add(c.payload.link);state.hiddenLinks=hidden.ToArray();break;
      case "setExplode":if(!float.IsFinite(c.payload.amount)||c.payload.amount<0||c.payload.amount>1)throw new ArgumentException("Invalid explode amount");state.explode=c.payload.amount;break;
      case "setJointPose":active.Pose(c.payload.joint,c.payload.radians);state.explode=0;break;
      case "resetView":active.ResetPose();state.explode=0;state.hiddenLinks=new string[0];cameraRig.ResetView(active==g1?1.3f:.35f);break;
      case "explainLink":if(string.IsNullOrEmpty(state.selectedLink))throw new ArgumentException("Select a link first");message=state.selectedLink+": manufacturer model link. Inspect its declared joints in the controls; no physical verification is implied.";break;
      case "pauseScene":cameraRig.paused=c.payload.paused;break;
      default:throw new ArgumentException("Unsupported operation");
     }
    }
    active.Display(state.selectedLink,state.hiddenLinks,state.explode);state.jointValues=Array.ConvertAll(active.joints,j=>new JointPose{name=j.id,radians=j.value});outcome="applied";if(c.operation!="explainLink")message="Unity applied "+c.operation+". Visual inspection only; no physical validation.";
   }catch(Exception error){message=error.Message;}
   if(c!=null)Emit(new SceneResult{protocolVersion=c.protocolVersion,sessionId=c.sessionId,robotId=c.robotId,versionId=c.versionId,draftRevision=c.draftRevision,requestId=c.requestId,status=outcome,message=message,state=outcome=="applied"?state:null});
  }
  public void SelectFromScene(string link){if(active==null||state==null)return;state.selectedLink=link;active.Display(link,state.hiddenLinks,state.explode);Emit(new SceneResult{sessionId=state.sessionId,robotId=state.robotId,versionId=state.versionId,draftRevision=state.draftRevision,requestId="selection",status="applied",message="Selected "+link,state=state});}
 }
}
