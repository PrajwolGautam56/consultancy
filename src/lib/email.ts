import { Resend } from "resend";

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]||char));

export async function sendVisitThankYou({name,email}:{name:string;email:string}) {
  const apiKey=process.env.RESEND_API_KEY; const from=process.env.EMAIL_FROM;
  if(!apiKey||!from||!email)return {status:"skipped" as const};
  const safeName=escapeHtml(name);
  const resend=new Resend(apiKey);
  const {data,error}=await resend.emails.send({
    from,
    to:[email],
    subject:"Thank you for visiting Aims Global Consultancy",
    html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1b2b40"><h2>Thank you for visiting, ${safeName}!</h2><p>It was a pleasure meeting you at Aims Global Consultancy today.</p><p>Our counselling team is here to help with your course, university, application and study-abroad questions. If you need anything else, simply reply to this email.</p><p style="margin-top:28px">Warm regards,<br><strong>Aims Global Consultancy</strong></p></div>`,
    text:`Thank you for visiting, ${name}! It was a pleasure meeting you at Aims Global Consultancy today. Our counselling team is here to help with your next steps.`,
  });
  if(error)throw new Error(error.message);
  return {status:"sent" as const,id:data?.id};
}
