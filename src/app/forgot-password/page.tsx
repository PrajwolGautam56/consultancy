"use client";
import { FormEvent,useState } from "react";
import { Mail,ArrowLeft,CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage(){
  const [message,setMessage]=useState("");const [loading,setLoading]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setLoading(true);const email=String(new FormData(event.currentTarget).get("email"));const response=await fetch("/api/auth/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});const result=await response.json();setMessage(result.message||"If an active account exists, a reset link has been sent.");setLoading(false);}
  return <main className="auth-simple"><section><a href="/login" className="back-login"><ArrowLeft size={15}/> Back to sign in</a><span className="login-logo">A</span><p className="eyebrow">ACCOUNT RECOVERY</p><h1>Forgot your password?</h1><p>Enter your staff email. We’ll send a secure link that expires in 30 minutes.</p>{message?<div className="auth-success"><CheckCircle2/>{message}</div>:<form onSubmit={submit}><label>Email address<div><Mail/><input name="email" type="email" required autoComplete="email" placeholder="you@consultancy.com"/></div></label><button className="login-submit" disabled={loading}>{loading?"Sending…":"Send reset link"}</button></form>}</section></main>;
}
