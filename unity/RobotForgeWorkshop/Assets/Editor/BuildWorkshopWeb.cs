using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
namespace RobotForge.Editor {
 public static class BuildWorkshopWeb {
  [MenuItem("RobotForge/Build Workshop Web")]
  public static void Build(){
   var repo=Path.GetFullPath(Path.Combine(Application.dataPath,"../../.."));var buildId=Environment.GetEnvironmentVariable("RF_UNITY_BUILD_ID")??"development";
   if(!System.Text.RegularExpressions.Regex.IsMatch(buildId,"^[a-zA-Z0-9-]{1,80}$"))throw new Exception("Invalid build ID");
   Directory.CreateDirectory("Assets/Generated");Directory.CreateDirectory("Assets/Scenes");
   foreach(var file in new[]{"Assets/Generated/WorkshopRenderer.asset","Assets/Generated/WorkshopPipeline.asset"})if(File.Exists(file))AssetDatabase.DeleteAsset(file);
   var renderer=ScriptableObject.CreateInstance<UniversalRendererData>();AssetDatabase.CreateAsset(renderer,"Assets/Generated/WorkshopRenderer.asset");
   var pipeline=ScriptableObject.CreateInstance<UniversalRenderPipelineAsset>();var so=new SerializedObject(pipeline);var list=so.FindProperty("m_RendererDataList");list.arraySize=1;list.GetArrayElementAtIndex(0).objectReferenceValue=renderer;so.ApplyModifiedPropertiesWithoutUndo();AssetDatabase.CreateAsset(pipeline,"Assets/Generated/WorkshopPipeline.asset");GraphicsSettings.defaultRenderPipeline=pipeline;QualitySettings.renderPipeline=pipeline;
   var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);var cameraObject=new GameObject("WorkshopCamera");var camera=cameraObject.AddComponent<Camera>();camera.backgroundColor=new Color(.03f,.06f,.09f);camera.clearFlags=CameraClearFlags.SolidColor;camera.nearClipPlane=.01f;cameraObject.AddComponent<UniversalAdditionalCameraData>();var rig=cameraObject.AddComponent<WorkshopCamera>();
   var sun=new GameObject("Workshop light");sun.AddComponent<Light>().type=LightType.Directional;sun.GetComponent<Light>().intensity=2;sun.transform.rotation=Quaternion.Euler(45,-30,0);RenderSettings.ambientLight=new Color(.5f,.55f,.6f);
   Box("Workbench",new Vector3(0,-.06f,0),new Vector3(3.6f,.1f,2.4f),new Color(.42f,.31f,.18f));Box("Tool wall",new Vector3(0,.8f,1.2f),new Vector3(3.6f,1.6f,.06f),new Color(.08f,.13f,.18f));
   foreach(float x in new[]{-1.3f,1.3f}){Box("Parts tray",new Vector3(x,.01f,0),new Vector3(.6f,.03f,1.6f),new Color(.12f,.2f,.25f));for(int i=0;i<5;i++)Box("Tool",new Vector3(-1+i*.4f,.85f,1.14f),new Vector3(.04f,.4f,.04f),Color.gray);}
   var bridge=new GameObject("WorkshopBridge").AddComponent<WorkshopBridge>();bridge.buildId=buildId;bridge.cameraRig=rig;bridge.g1=ImportG1.Build(repo);bridge.rover=RoverProxy.Build();bridge.g1.gameObject.SetActive(false);bridge.rover.gameObject.SetActive(false);rig.ResetView(1.3f);
   var scenePath="Assets/Scenes/Workshop.unity";EditorSceneManager.SaveScene(scene,scenePath);AssetDatabase.SaveAssets();
   PlayerSettings.companyName="RobotForge";PlayerSettings.productName="RobotForge Workshop";PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;PlayerSettings.WebGL.decompressionFallback=false;PlayerSettings.WebGL.threadsSupport=false;PlayerSettings.SetScriptingBackend(NamedBuildTarget.WebGL,ScriptingImplementation.IL2CPP);
   var output=Path.Combine(repo,"build/unity",buildId);Directory.CreateDirectory(output);var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{scenePath},locationPathName=output,target=BuildTarget.WebGL,options=BuildOptions.None});if(report.summary.result!=BuildResult.Succeeded)throw new Exception("Unity build failed: "+report.summary.result);
   File.WriteAllText(Path.Combine(output,"robotforge-build.json"),"{\"buildId\":\""+buildId+"\",\"protocolVersion\":1}");
   Directory.CreateDirectory(Path.Combine(output,"Licenses"));File.Copy(Path.Combine(repo,"assets/models/unitree-g1/LICENSE"),Path.Combine(output,"Licenses/Unitree-G1-LICENSE.txt"),true);File.Copy(Path.Combine(repo,"assets/models/unitree-g1/provenance.json"),Path.Combine(output,"Licenses/Unitree-G1-provenance.json"),true);
  }
  static void Box(string name,Vector3 position,Vector3 size,Color color){var box=GameObject.CreatePrimitive(PrimitiveType.Cube);box.name=name;box.transform.position=position;box.transform.localScale=size;var material=new Material(Shader.Find("Universal Render Pipeline/Lit"));material.color=color;box.GetComponent<Renderer>().sharedMaterial=material;}
 }
}
