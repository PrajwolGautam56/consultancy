import { Resend } from "resend";

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]||char));
const appUrl=()=>String(process.env.APP_URL||"https://crm.aimsglobal.com.np").replace(/\/$/,"");

function brandedEmail({preview,content}:{preview:string;content:string}) {
  const logoUrl=`${appUrl()}/aims-logo.png`;
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;padding:24px 12px;font-family:Arial,sans-serif;color:#23334b"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e5eaf1;border-radius:14px;overflow:hidden"><tr><td style="height:7px;background:linear-gradient(90deg,#0754b8 0 72%,#ff6500 72%)"></td></tr><tr><td style="padding:28px 36px 12px;text-align:center"><img src="${logoUrl}" width="160" alt="Aims Global" style="display:inline-block;width:160px;max-width:55%;height:auto"></td></tr><tr><td style="padding:14px 36px 32px;font-size:15px;line-height:1.7">${content}</td></tr><tr><td style="padding:20px 36px;background:#f7f9fc;border-top:1px solid #e8edf4;color:#718096;font-size:12px;line-height:1.6;text-align:center"><strong style="color:#0754b8">Aims Global Consultancy</strong><br>Study abroad guidance, applications and student support<br><span style="color:#9aa6b5">This email was sent from Aims Global Consultancy CRM.</span></td></tr></table></td></tr></table></body></html>`;
}

function client() {
  const apiKey=process.env.RESEND_API_KEY; const from=process.env.EMAIL_FROM;
  if(!apiKey||!from)throw new Error("Email service is not configured");
  return {resend:new Resend(apiKey),from};
}

export async function sendVisitThankYou({name,email}:{name:string;email:string}) {
  if(!email)return {status:"skipped" as const};
  const {resend,from}=client(); const safeName=escapeHtml(name);
  const {data,error}=await resend.emails.send({
    from,to:[email],subject:"Thank you for visiting Aims Global Consultancy",
    html:brandedEmail({preview:"Thank you for visiting Aims Global Consultancy.",content:`<h1 style="font-size:24px;line-height:1.3;color:#123a72;margin:0 0 18px">Thank you for visiting, ${safeName}!</h1><p style="margin:0 0 14px">It was a pleasure welcoming you to <strong>Aims Global Consultancy</strong> today.</p><p style="margin:0 0 14px">We hope your counselling session was helpful. Our team is ready to support you with course and university selection, applications, scholarships, visa guidance and every next step of your study-abroad journey.</p><p style="margin:0 0 22px">If you have any questions or would like further assistance, simply reply to this email and our team will be happy to help.</p><p style="margin:0">Warm regards,<br><strong style="color:#0754b8">The Aims Global Team</strong></p>`}),
    text:`Hello ${name}, thank you for visiting Aims Global Consultancy today. We hope your counselling session was helpful. Our team is ready to support you with course and university selection, applications, scholarships, visa guidance and your next steps. Reply to this email if you need any assistance. Warm regards, The Aims Global Team.`,
  });
  if(error)throw new Error(error.message);
  return {status:"sent" as const,id:data?.id};
}

export async function sendCustomStudentEmail({name,email,subject,message}:{name:string;email:string;subject:string;message:string}) {
  const {resend,from}=client(); const safeName=escapeHtml(name); const safeMessage=escapeHtml(message).replace(/\r?\n/g,"<br>");
  const {data,error}=await resend.emails.send({
    from,to:[email],subject,
    html:brandedEmail({preview:subject,content:`<p style="margin:0 0 16px">Dear ${safeName},</p><div style="margin:0 0 24px">${safeMessage}</div><p style="margin:0">Warm regards,<br><strong style="color:#0754b8">The Aims Global Team</strong></p>`}),
    text:`Dear ${name},\n\n${message}\n\nWarm regards,\nThe Aims Global Team`,
  });
  if(error)throw new Error(error.message);
  return {id:data?.id};
}

export async function sendPasswordReset({name,email,resetUrl}:{name:string;email:string;resetUrl:string}) {
  const {resend,from}=client(); const safeName=escapeHtml(name); const safeUrl=escapeHtml(resetUrl);
  const {data,error}=await resend.emails.send({
    from,to:[email],subject:"Reset your Aims Global CRM password",
    html:brandedEmail({preview:"Reset your Aims Global CRM password.",content:`<h1 style="font-size:23px;color:#123a72;margin:0 0 18px">Password reset requested</h1><p>Hello ${safeName},</p><p>Use the button below to set a new CRM password. This link expires in 30 minutes and can be used once.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#0754b8;color:white;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Reset password</a></p><p>If you did not request this, you can safely ignore this email.</p>`}),
    text:`Hello ${name}, reset your Aims Global CRM password using this link: ${resetUrl}. The link expires in 30 minutes.`,
  });
  if(error)throw new Error(error.message); return {id:data?.id};
}
