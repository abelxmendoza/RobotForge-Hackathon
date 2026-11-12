using UnityEngine;
namespace RobotForge {
 public class WorkshopCamera:MonoBehaviour {
  public bool paused;public Vector3 target;float yaw=25,pitch=20,distance=3;Vector3 pointer;bool pressed;
  public void ResetView(float height){target=new Vector3(0,height*.5f,0);distance=Mathf.Max(1,height*2.5f);yaw=25;pitch=20;Frame();}
  void Frame(){transform.rotation=Quaternion.Euler(pitch,yaw,0);transform.position=target-transform.forward*distance;}
  void Update(){if(paused)return;var pointerPosition=Input.mousePosition;if(Input.GetMouseButtonDown(0)){pressed=true;pointer=pointerPosition;}
   if(Input.GetMouseButton(0)&&pressed){var delta=pointerPosition-pointer;if(Input.mousePosition.x>=0&&Input.mousePosition.x<=Screen.width){yaw+=Input.GetAxis("Mouse X")*3;pitch=Mathf.Clamp(pitch-Input.GetAxis("Mouse Y")*3,-5,80);}}
   if(Input.GetMouseButtonUp(0)&&pressed){pressed=false;if((pointerPosition-pointer).magnitude<6){var ray=GetComponent<Camera>().ScreenPointToRay(pointerPosition);if(Physics.Raycast(ray,out var hit)){var part=hit.collider.GetComponent<SelectableLink>();if(part)FindFirstObjectByType<WorkshopBridge>().SelectFromScene(part.linkId);}}}
   if(pointerPosition.x>=0&&pointerPosition.x<=Screen.width&&pointerPosition.y>=0&&pointerPosition.y<=Screen.height)distance=Mathf.Clamp(distance-Input.mouseScrollDelta.y*.15f,.4f,8);Frame();
  }
 }
}
