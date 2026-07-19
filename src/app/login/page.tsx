"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [show,setShow]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
  async function login(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const data=new FormData(event.currentTarget);
    try {
      const response=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:data.get("email"),password:data.get("password")})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"Unable to sign in");
      window.location.href="/";
    } catch(error) { setError(error instanceof Error?error.message:"Unable to sign in"); setLoading(false); }
  }
  return <main className="login-page"><section className="login-brand"><div><span className="login-logo">A</span><h1>Welcome to Admitly</h1><p>Your consultancy’s leads, students, visits and follow-ups—securely managed in one place.</p><ul><li><ShieldCheck/> Role-based team access</li><li><ShieldCheck/> Protected student records</li><li><ShieldCheck/> Complete activity history</li></ul></div><small>CONSULTANCY OPERATIONS, SIMPLIFIED.</small></section><section className="login-side"><form className="login-form" onSubmit={login}><div className="login-mobile-brand"><span className="login-logo">A</span> Admitly</div><p className="eyebrow">SECURE TEAM ACCESS</p><h2>Sign in to your account</h2><p>Enter the credentials provided by your administrator.</p>{error&&<div className="login-error">{error}</div>}<label>Email address<div><Mail/><input name="email" type="email" autoComplete="email" required placeholder="you@consultancy.com"/></div></label><label>Password<div><LockKeyhole/><input name="password" type={show?"text":"password"} autoComplete="current-password" required placeholder="Enter your password"/><button type="button" onClick={()=>setShow(!show)} aria-label="Show password">{show?<EyeOff/>:<Eye/>}</button></div></label><div className="forgot-link"><a href="/forgot-password">Forgot password?</a></div><button className="login-submit" disabled={loading}>{loading?"Signing in…":"Sign in securely"}</button><small>Only authorized staff can access this system.</small></form></section></main>;
}
