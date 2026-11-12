mergeInto(LibraryManager.library, {
 RobotForgeEmit: function(pointer) {
  var message=UTF8ToString(pointer);
  if(typeof window.RobotForgeUnityReceive==='function') window.RobotForgeUnityReceive(message);
 }
});
