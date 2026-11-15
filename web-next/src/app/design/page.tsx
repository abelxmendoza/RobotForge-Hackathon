"use client";
import {useEffect} from 'react';
/* The rover designer is part of Wrench and the Workshop now: old
 * bookmarks open the Workshop's rover kit panel. */
export default function DesignPage(){
 useEffect(()=>{window.location.replace('/garage/'+window.location.search+'#kit');},[]);
 return <p>Rover design is in the <a href="/garage/#kit">Workshop</a>. Ask Wrench to design a rover.</p>;
}
