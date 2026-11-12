"use client";
import {useEffect} from 'react';
/** Keep existing design bookmarks while the editor lives in Workshop. */
export default function DesignPage(){
 useEffect(()=>{window.location.replace('/garage/'+window.location.search+'#rover-design');},[]);
 return <p>The rover designer is now in <a href="/garage/#rover-design">Workshop</a>.</p>;
}
