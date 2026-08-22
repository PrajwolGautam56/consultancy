"use client";

import { Download, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaInstall() {
  const [prompt,setPrompt]=useState<InstallPromptEvent|null>(null);
  const [hidden,setHidden]=useState(true);

  useEffect(()=>{
    if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>undefined);
    const standalone=window.matchMedia("(display-mode: standalone)").matches;
    if(standalone)return;
    const beforeInstall=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPromptEvent);setHidden(false)};
    const installed=()=>{setPrompt(null);setHidden(true)};
    window.addEventListener("beforeinstallprompt",beforeInstall);
    window.addEventListener("appinstalled",installed);
    return()=>{window.removeEventListener("beforeinstallprompt",beforeInstall);window.removeEventListener("appinstalled",installed)};
  },[]);

  if(hidden||!prompt)return null;
  return <aside className="pwa-install" role="status"><Image src="/icon-192.png" alt="" width={46} height={46}/><span><strong>Install AIMS CRM</strong><small>Add a secure app shortcut to this device.</small></span><button className="pwa-install-action" onClick={async()=>{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==="accepted")setHidden(true)}}><Download size={16}/> Install</button><button className="pwa-install-close" aria-label="Dismiss install suggestion" onClick={()=>setHidden(true)}><X size={15}/></button></aside>;
}
