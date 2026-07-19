"use client";
import { FormEvent,Suspense,useState } from "react";
import { LockKeyhole,CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm(){
  const token=useSearchParams().get("token")||"";const [error,setError]=useState("");const [done,setDone]=useState(false);const [loading,setLoading]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setLoading(true);setError("");const data=new FormData(event.currentTarget);const password=String(data.get("password"));const confirm=String(data.get("confirm"));if(password!==confirm){setError("Passwords do not match");setLoading(false);return;}const response=await fetch("/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,password})});const result=await response.json();if(!response.ok){setError(result.error||"Password could not be reset");setLoading(false);return;}setDone(true);}
  return <main className="auth-simple"><section><span className="login-logo">A</span><p className="eyebrow">SECURE PASSWORD RESET</p><h1>Set a new password</h1><p>Use at least 10 characters. Avoid reusing an old password.</p>{done?<div className="auth-success"><CheckCircle2/>Password changed successfully.<a href="/login">Continue to sign in</a></div>:<form onSubmit={submit}>{error&&<div className="login-error">{error}</div>}<label>New password<div><LockKeyhole/><input name="password" type="password" minLength={10} maxLength={128} required autoComplete="new-password"/></div></label><label>Confirm password<div><LockKeyhole/><input name="confirm" type="password" minLength={10} maxLength={128} required autoComplete="new-password"/></div></label><button className="login-submit" disabled={loading||!token}>{loading?"Changing…":"Change password"}</button>{!token&&<div className="login-error">This reset link is invalid.</div>}</form>}</section></main>;
}

export default function ResetPasswordPage(){return <Suspense fallback={<main className="auth-simple"><section>Loading secure reset…</section></main>}><ResetPasswordForm/></Suspense>}
