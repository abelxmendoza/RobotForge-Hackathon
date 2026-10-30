/* Compressed full-size photos in IndexedDB; thumbnails remain in inventory JSON.
 * No cloud upload: these bytes stay in this browser until an explicit model call. */
const DB='robotforge-photos-v1';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('photos');
    request.onerror=()=>reject(new Error('This browser cannot save the larger photo.'));
    request.onsuccess=()=>resolve(request.result);
  });
}
export async function saveInventoryPhoto(id:string,data:string):Promise<void>{
  const db=await database();
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').put(data,id);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('Photo storage is full or blocked.'));});}finally{db.close();}
}
export async function readInventoryPhoto(id:string):Promise<string|null>{
  const db=await database();
  try{return await new Promise((resolve,reject)=>{const request=db.transaction('photos').objectStore('photos').get(id);request.onsuccess=()=>resolve(typeof request.result==='string'?request.result:null);request.onerror=()=>reject(new Error('Cannot load this photo.'));});}finally{db.close();}
}
export async function removeInventoryPhoto(id:string):Promise<void>{
  const db=await database();
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('Cannot remove the photo.'));});}finally{db.close();}
}
