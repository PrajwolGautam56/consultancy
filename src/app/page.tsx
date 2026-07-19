"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, CalendarClock, CheckCircle2, ChevronRight, CircleUserRound,
  LayoutDashboard, LogOut, Menu, MessageSquareText, Pencil, Phone, Plus,
  Search, Settings, Sparkles, UserCheck, UserRoundPlus, Users, X,
} from "lucide-react";

type Stage = "New inquiry" | "Contacted" | "Counselling" | "Application" | "Enrolled" | "Lost";
type Activity = { type:string; text:string; authorName:string; occurredAt:string };
type Lead = {
  id: string; name: string; phone: string; email: string; address: string;
  education: string; country: string; course: string; university: string;
  source: string; stage: Stage; counsellor: string; updated: string;
  nextFollowUp: string; nextFollowUpISO?:string|null; priority: "High" | "Medium" | "Low"; inOffice?: boolean; activities?:Activity[];
};

const nav = [
  ["Dashboard", LayoutDashboard], ["Leads & students", Users], ["Office visitors", UserCheck],
  ["Follow-ups", CalendarClock], ["Team", CircleUserRound], ["Settings", Settings],
] as const;

const stageStyle: Record<Stage, string> = {
  "New inquiry": "blue", Contacted: "violet", Counselling: "amber", Application: "cyan", Enrolled: "green", Lost: "slate",
};

function Avatar({ name, warm = false }: { name: string; warm?: boolean }) {
  return <span className={`avatar ${warm ? "warm" : ""}`}>{name.split(" ").map(x => x[0]).slice(0, 2).join("")}</span>;
}

function mapLead(raw:Record<string,unknown>):Lead {
  const date=(value:unknown)=>value?new Intl.DateTimeFormat("en-NP",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(String(value))):"Not scheduled";
  return { id:String(raw._id),name:String(raw.name||""),phone:String(raw.phone||""),email:String(raw.email||""),address:String(raw.address||""),education:String(raw.education||""),country:String(raw.country||""),course:String(raw.course||""),university:String(raw.university||""),source:String(raw.source||"Other"),stage:(raw.stage||"New inquiry") as Stage,counsellor:String(raw.counsellor||"Unassigned"),updated:raw.updatedAt?date(raw.updatedAt):"Just now",nextFollowUp:date(raw.nextFollowUp),nextFollowUpISO:raw.nextFollowUp?String(raw.nextFollowUp):undefined,priority:(raw.priority||"Medium") as Lead["priority"],inOffice:Boolean(raw.inOffice),activities:(raw.activities||[]) as Activity[] };
}

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [active, setActive] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [loading,setLoading]=useState(true);
  const [appError,setAppError]=useState("");
  const [stageFilter,setStageFilter]=useState("All stages");
  const [counsellorFilter,setCounsellorFilter]=useState("All counsellors");
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [staffCounsellors,setStaffCounsellors]=useState<string[]>([]);
  const searchRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{ fetch("/api/leads").then(async response=>{ if(response.status===401){window.location.href="/login";return;} const data=await response.json(); if(!response.ok)throw new Error(data.error||"Could not load contacts"); setLeads((data.leads||[]).map(mapLead)); }).catch(error=>setAppError(error.message)).finally(()=>setLoading(false)); },[]);
  useEffect(()=>{fetch("/api/users?directory=1").then(async response=>response.ok?response.json():{users:[]}).then(data=>setStaffCounsellors((data.users||[]).filter((user:TeamMember)=>user.active&&["super_admin","admin","manager","counsellor"].includes(user.role)).map((user:TeamMember)=>user.name))).catch(()=>setStaffCounsellors([]))},[]);

  const filtered = useMemo(() => leads.filter(l => `${l.name} ${l.phone} ${l.email} ${l.country} ${l.course}`.toLowerCase().includes(query.toLowerCase()) && (stageFilter==="All stages"||l.stage===stageFilter) && (counsellorFilter==="All counsellors"||l.counsellor===counsellorFilter)), [leads, query,stageFilter,counsellorFilter]);
  const office = leads.filter(l => l.inOffice);
  const counsellors=useMemo(()=>Array.from(new Set([...staffCounsellors,...leads.map(l=>l.counsellor)].filter(name=>name&&name!=="Unassigned"))).sort(),[leads,staffCounsellors]);
  const dueFollowUps=leads.filter(l=>l.nextFollowUpISO);

  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();searchRef.current?.focus();}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler)},[]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  function openLeadForm(){setAppError("");setShowNew(true)}

  async function addLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload=Object.fromEntries(data.entries()); setAppError("");
    const response=await fetch("/api/leads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const result=await response.json();
    if(!response.ok){setAppError(result.error||"Could not create lead");return;}
    setLeads([mapLead(result.lead),...leads]); setShowNew(false); setActive("Leads & students");
  }

  async function persistLead(changed:Lead,activity?:{type:string;text:string}) {
    const previous=leads.find(l=>l.id===changed.id); setLeads(leads.map(l=>l.id===changed.id?changed:l)); setSelected(changed); setAppError("");
    const fields={name:changed.name,phone:changed.phone,email:changed.email,address:changed.address,education:changed.education,country:changed.country,course:changed.course,university:changed.university,source:changed.source,stage:changed.stage,counsellor:changed.counsellor,priority:changed.priority,inOffice:Boolean(changed.inOffice),...(changed.nextFollowUpISO!==undefined?{nextFollowUp:changed.nextFollowUpISO}:{})};
    const response=await fetch(`/api/leads/${encodeURIComponent(changed.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...fields,activity})}); const result=await response.json();
    if(!response.ok){if(previous)setLeads(current=>current.map(l=>l.id===changed.id?previous:l));setAppError(result.error||"Changes could not be saved");return;}
    const saved=mapLead(result.lead); setLeads(current=>current.map(l=>l.id===changed.id?saved:l)); setSelected(saved);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><span className="brandmark">A</span><span>Admitly<small>CONSULTANCY CRM</small></span><button className="mobile-close" onClick={() => setMobileNav(false)}><X /></button></div>
        <nav>{nav.map(([label, Icon]) => <button key={label} className={active === label ? "active" : ""} onClick={() => { setActive(label); setMobileNav(false); }}><Icon size={19}/><span>{label}</span>{label === "Follow-ups" && leads.filter(l=>l.nextFollowUpISO).length>0 && <b>{leads.filter(l=>l.nextFollowUpISO).length}</b>}</button>)}</nav>
        <div className="sidebar-card"><Sparkles size={19}/><strong>CRM is protected</strong><p>Student records require an authenticated staff session.</p><div><i style={{width:"100%"}} /></div></div>
        <div className="user-card"><Avatar name="Prajwol Gautam" warm/><span><strong>Prajwol Gautam</strong><small>Super administrator</small></span><button className="logout-btn" onClick={logout} title="Sign out"><LogOut size={16}/></button></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><button className="menu" onClick={() => setMobileNav(true)}><Menu/></button><div className="global-search"><Search size={18}/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone, email..."/><kbd>⌘ K</kbd></div><div className="notification-wrap"><button className="icon-btn" onClick={()=>setNotificationsOpen(!notificationsOpen)} aria-label="Notifications"><Bell size={20}/>{dueFollowUps.length>0&&<i/>}</button>{notificationsOpen&&<div className="notification-popover"><div><strong>Follow-up reminders</strong><button onClick={()=>setNotificationsOpen(false)}><X size={15}/></button></div>{dueFollowUps.slice(0,5).map(lead=><button key={lead.id} onClick={()=>{setSelected(lead);setNotificationsOpen(false)}}><CalendarClock size={16}/><span><strong>{lead.name}</strong><small>{lead.nextFollowUp}</small></span></button>)}{dueFollowUps.length===0&&<p>No scheduled reminders.</p>}<button className="view-reminders" onClick={()=>{setActive("Follow-ups");setNotificationsOpen(false)}}>View all follow-ups</button></div>}</div><button className="primary" onClick={openLeadForm}><Plus size={18}/> Add new lead</button></header>

        <div className="content">
          {appError&&<div className="app-alert"><span>{appError}</span><button onClick={()=>setAppError("")}><X size={15}/></button></div>}
          <div className="page-heading"><div><p className="eyebrow">{new Intl.DateTimeFormat("en-NP",{weekday:"long",day:"numeric",month:"long"}).format(new Date()).toUpperCase()}</p><h1>{active === "Dashboard" ? "Good morning, Prajwol" : active}</h1><p>{active === "Dashboard" ? "Here’s what’s happening at your consultancy today." : `Manage your ${active.toLowerCase()} from one place.`}</p></div>{active === "Leads & students" && <button className="primary" onClick={openLeadForm}><Plus size={18}/> Add new lead</button>}</div>

          {active === "Dashboard" ? <>
            <div className="stats">
              <Stat icon={<Users/>} label="Total active leads" value={loading?"—":String(leads.filter(l=>l.stage!=="Lost").length)} trend="Excludes lost enquiries" color="blue" />
              <Stat icon={<UserRoundPlus/>} label="New inquiries" value={loading?"—":String(leads.filter(l=>l.stage==="New inquiry").length)} trend="Awaiting first contact" color="violet" />
              <Stat icon={<UserCheck/>} label="In office now" value={loading?"—":String(office.length)} trend="Live visitor status" color="amber" />
              <Stat icon={<CheckCircle2/>} label="Enrolled" value={loading?"—":String(leads.filter(l=>l.stage==="Enrolled").length)} trend="All-time conversions" color="green" />
            </div>
            <div className="dashboard-grid">
              <section className="panel leads-panel"><PanelTitle title="Recent leads" subtitle="Latest enquiries and student updates" action={() => setActive("Leads & students")}/><LeadTable leads={filtered.slice(0,5)} select={setSelected} update={persistLead}/></section>
              <section className="panel visitors"><PanelTitle title="In office now" subtitle="Checked in by reception"/>{office.map((l,i) => <button key={l.id} className="visitor" onClick={() => setSelected(l)}><Avatar name={l.name} warm={i%2===0}/><span><strong>{l.name}</strong><small>Assigned to {l.counsellor}</small></span><em>In office</em></button>)}{office.length===0&&<div className="empty compact">No visitors in office.</div>}<button className="checkin" onClick={() => setActive("Office visitors")}><Plus size={17}/> Check in a visitor</button></section>
              <section className="panel followups"><PanelTitle title="Scheduled follow-ups" subtitle={`${leads.filter(l=>l.nextFollowUpISO).length} scheduled`} action={() => setActive("Follow-ups")}/>{leads.filter(l=>l.nextFollowUpISO).sort((a,b)=>String(a.nextFollowUpISO).localeCompare(String(b.nextFollowUpISO))).slice(0,4).map(l=><button className="followup" key={l.id} onClick={()=>setSelected(l)}><span className="timebox"><CalendarClock size={18}/></span><span><strong>{l.name}</strong><small>{l.nextFollowUp} · {l.country||"General enquiry"}</small></span><Avatar name={l.counsellor}/><Phone size={16}/></button>)}{leads.filter(l=>l.nextFollowUpISO).length===0&&<div className="empty compact">No follow-ups scheduled.</div>}</section>
              <section className="panel activity"><PanelTitle title="Team activity" subtitle="Latest saved CRM updates"/>{leads.flatMap(l=>(l.activities||[]).map(a=>({...a,leadName:l.name,leadId:l.id}))).sort((a,b)=>String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0,5).map((item,i)=><div className="activity-row" key={`${item.leadId}-${item.occurredAt}-${i}`}><span className={`activity-icon a${i%4}`}><MessageSquareText size={16}/></span><p><strong>{item.authorName}</strong> {item.text} <b>{item.leadName}</b><small>{new Intl.DateTimeFormat("en-NP",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(item.occurredAt))}</small></p></div>)}{leads.every(l=>!l.activities?.length)&&<div className="empty compact">No team activity yet.</div>}</section>
            </div>
          </> : active === "Office visitors" ? <OfficeView leads={leads} update={persistLead} select={setSelected} addNew={openLeadForm}/> : active === "Team" ? <TeamView/> : active === "Follow-ups" ? <FollowUpsView leads={leads} select={setSelected} update={persistLead}/> : active === "Settings" ? <SettingsView logout={logout}/> : <section className="panel directory"><div className="directory-tools"><div className="global-search inner"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search records..."/></div><select value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option>All stages</option>{Object.keys(stageStyle).map(s=><option key={s}>{s}</option>)}</select><select value={counsellorFilter} onChange={e=>setCounsellorFilter(e.target.value)}><option>All counsellors</option>{counsellors.map(name=><option key={name}>{name}</option>)}</select>{(stageFilter!=="All stages"||counsellorFilter!=="All counsellors"||query)&&<button className="clear-filters" onClick={()=>{setStageFilter("All stages");setCounsellorFilter("All counsellors");setQuery("")}}><X size={14}/> Clear</button>}</div><LeadTable leads={filtered} select={setSelected} update={persistLead}/></section>}
        </div>
      </section>

      {showNew && <Modal close={() => setShowNew(false)} title="Add new enquiry" subtitle="Create a lead profile. You can add more details later."><form onSubmit={addLead} className="lead-form">{appError&&<div className="form-error wide">{appError}</div>}<label>Full name *<input required name="name" placeholder="Student’s full name"/></label><label>Phone number *<input required name="phone" placeholder="98XXXXXXXX"/></label><label>Email<input name="email" type="email" placeholder="name@email.com"/></label><label>Address<input name="address" placeholder="City, district"/></label><label>Education background<input name="education" placeholder="e.g. BBS · 68%"/></label><label>Lead source<select name="source"><option>Facebook</option><option>Phone call</option><option>Walk-in</option><option>Instagram</option><option>Referral</option><option>Website</option><option>Other</option></select></label><label>Interested country<input name="country" placeholder="e.g. Australia"/></label><label>Course / subject<input name="course" placeholder="e.g. Master of IT"/></label><label className="wide">Preferred university<input name="university" placeholder="University name (optional)"/></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setShowNew(false)}>Cancel</button><button className="primary">Create lead</button></div></form></Modal>}
      {selected && <Profile lead={selected} counsellors={counsellors} close={()=>setSelected(null)} update={persistLead}/>}
    </main>
  );
}

function Stat({icon,label,value,trend,color}:{icon:React.ReactNode,label:string,value:string,trend:string,color:string}) { return <div className="stat"><span className={`stat-icon ${color}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong><small className={color}>{trend}</small></div></div> }
function PanelTitle({title,subtitle,action}:{title:string;subtitle:string;action?:()=>void}) { return <div className="panel-title"><div><h2>{title}</h2><p>{subtitle}</p></div>{action&&<button onClick={action}>View all <ChevronRight size={15}/></button>}</div> }
function StageSelect({lead,onChange,compact=false}:{lead:Lead;onChange:(stage:Stage)=>void;compact?:boolean}) { return <select aria-label={`Change stage for ${lead.name}`} className={`stage-select ${stageStyle[lead.stage]} ${compact?"compact":""}`} value={lead.stage} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();onChange(e.target.value as Stage)}}>{Object.keys(stageStyle).map(stage=><option key={stage}>{stage}</option>)}</select> }
function LeadTable({leads,select,update}:{leads:Lead[];select:(l:Lead)=>void;update:(l:Lead)=>void}) { return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Interest</th><th>Stage</th><th>Counsellor</th><th>Updated</th><th/></tr></thead><tbody>{leads.map(l=><tr key={l.id} onClick={()=>select(l)}><td><div className="student-cell"><Avatar name={l.name}/><span><strong>{l.name}</strong><small>{l.phone}</small></span></div></td><td><strong>{l.country}</strong><small>{l.course}</small></td><td><StageSelect lead={l} onChange={stage=>update({...l,stage,updated:"Stage changed just now"})}/></td><td><strong>{l.counsellor}</strong><small>{l.nextFollowUp}</small></td><td>{l.updated}</td><td><ChevronRight size={17}/></td></tr>)}</tbody></table>{leads.length===0&&<div className="empty">No matching records found.</div>}</div> }
function Modal({children,close,title,subtitle}:{children:React.ReactNode;close:()=>void;title:string;subtitle:string}) { return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><section className="modal"><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={close}><X/></button></div>{children}</section></div> }

type TeamMember={_id:string;name:string;email:string;phone?:string;role:"super_admin"|"admin"|"manager"|"counsellor"|"receptionist";active:boolean;lastLoginAt?:string;createdAt:string};
const roleLabel:Record<TeamMember["role"],string>={super_admin:"Super administrator",admin:"Administrator",manager:"Manager",counsellor:"Counsellor",receptionist:"Receptionist"};

function TeamView() {
  const [members,setMembers]=useState<TeamMember[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(""); const [adding,setAdding]=useState(false); const [created,setCreated]=useState("");
  useEffect(()=>{fetch("/api/users").then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load team");setMembers(data.users)}).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);
  async function addMember(event:FormEvent<HTMLFormElement>){event.preventDefault();setError("");const form=event.currentTarget;const payload=Object.fromEntries(new FormData(form).entries());const response=await fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok){setError(result.error||"Could not add team member");return;}setMembers([...members,result.user].sort((a,b)=>a.name.localeCompare(b.name)));setCreated(`${result.user.name} can now sign in using ${result.user.email}. Share the temporary password securely.`);setAdding(false);form.reset();}
  return <><section className="panel team-panel"><div className="team-toolbar"><div><h2>Team members</h2><p>Manage staff accounts and consultancy roles.</p></div><button className="primary" onClick={()=>{setAdding(true);setCreated("")}}><UserRoundPlus size={17}/> Add team member</button></div>{error&&<div className="app-alert"><span>{error}</span><button onClick={()=>setError("")}><X size={15}/></button></div>}{created&&<div className="team-success"><CheckCircle2 size={17}/>{created}</div>}<div className="team-summary"><div><strong>{members.length}</strong><span>Total staff</span></div><div><strong>{members.filter(m=>m.active).length}</strong><span>Active accounts</span></div><div><strong>{members.filter(m=>m.role==="counsellor").length}</strong><span>Counsellors</span></div><div><strong>{members.filter(m=>m.role==="receptionist").length}</strong><span>Receptionists</span></div></div><div className="team-list">{loading&&<div className="empty">Loading team…</div>}{!loading&&members.map(member=><div className="team-member" key={member._id}><Avatar name={member.name} warm={member.role==="super_admin"}/><span className="team-person"><strong>{member.name}</strong><small>{member.email}{member.phone?` · ${member.phone}`:""}</small></span><span className={`role-badge role-${member.role}`}>{roleLabel[member.role]}</span><span className={`account-status ${member.active?"active":""}`}>{member.active?"Active":"Inactive"}</span><span className="last-login"><small>Last login</small>{member.lastLoginAt?new Intl.DateTimeFormat("en-NP",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(member.lastLoginAt)):"Never"}</span></div>)}{!loading&&members.length===0&&<div className="empty">No staff accounts yet.</div>}</div></section>{adding&&<Modal close={()=>setAdding(false)} title="Add team member" subtitle="Create a secure login for a consultant or staff member."><form className="lead-form" onSubmit={addMember}><label>Full name *<input name="name" required minLength={2} maxLength={120} placeholder="Staff member’s name"/></label><label>Work email *<input name="email" required type="email" autoComplete="off" placeholder="name@consultancy.com"/></label><label>Phone number<input name="phone" maxLength={24} placeholder="98XXXXXXXX"/></label><label>Role *<select name="role" defaultValue="counsellor"><option value="counsellor">Counsellor</option><option value="receptionist">Receptionist</option><option value="manager">Manager</option><option value="admin">Administrator</option></select></label><label className="wide">Temporary password *<input name="password" required type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="Minimum 10 characters"/><small>Send this privately. The password is stored only as a secure hash.</small></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setAdding(false)}>Cancel</button><button className="primary">Create staff account</button></div></form></Modal>}</>;
}

function FollowUpsView({leads,select,update}:{leads:Lead[];select:(lead:Lead)=>void;update:(lead:Lead,activity?:{type:string;text:string})=>void}) {
  const scheduled=leads.filter(lead=>lead.nextFollowUpISO).sort((a,b)=>String(a.nextFollowUpISO).localeCompare(String(b.nextFollowUpISO)));
  const [now]=useState(()=>Date.now()); const overdue=scheduled.filter(lead=>new Date(String(lead.nextFollowUpISO)).getTime()<now); const upcoming=scheduled.filter(lead=>new Date(String(lead.nextFollowUpISO)).getTime()>=now);
  const row=(lead:Lead,isOverdue:boolean)=><div className="followup-row" key={lead.id}><span className={`followup-date ${isOverdue?"overdue":""}`}><CalendarClock size={18}/></span><button className="followup-person" onClick={()=>select(lead)}><strong>{lead.name}</strong><small>{lead.phone} · {lead.country||"General enquiry"}</small></button><span className="followup-owner"><small>Assigned to</small>{lead.counsellor}</span><span className="followup-when"><small>{isOverdue?"Overdue":"Scheduled"}</small>{lead.nextFollowUp}</span><button className="secondary" onClick={()=>select(lead)}>Reschedule</button><button className="complete-followup" onClick={()=>update({...lead,nextFollowUp:"Not scheduled",nextFollowUpISO:null,updated:"Follow-up completed just now"},{type:"follow_up",text:"Follow-up marked complete"})}><CheckCircle2 size={16}/> Complete</button></div>;
  return <div className="followup-page"><div className="followup-stats"><div><strong>{scheduled.length}</strong><span>Scheduled</span></div><div className="danger-stat"><strong>{overdue.length}</strong><span>Overdue</span></div><div><strong>{upcoming.length}</strong><span>Upcoming</span></div><div><strong>{leads.filter(l=>!l.nextFollowUpISO).length}</strong><span>Not scheduled</span></div></div>{overdue.length>0&&<section className="panel followup-section"><PanelTitle title="Overdue follow-ups" subtitle="These students need immediate attention"/>{overdue.map(lead=>row(lead,true))}</section>}<section className="panel followup-section"><PanelTitle title="Upcoming follow-ups" subtitle="Calls, messages and meetings scheduled next"/>{upcoming.map(lead=>row(lead,false))}{upcoming.length===0&&<div className="empty">No upcoming follow-ups. Open a student profile to schedule one.</div>}</section></div>;
}

function SettingsView({logout}:{logout:()=>void}) {
  const [user,setUser]=useState<{name:string;email:string;role:string}|null>(null);
  useEffect(()=>{fetch("/api/auth/me").then(response=>response.json()).then(data=>setUser(data.user||null)).catch(()=>setUser(null))},[]);
  return <div className="settings-grid"><section className="panel settings-card"><div className="settings-title"><CircleUserRound/><div><h2>Your account</h2><p>Current authenticated staff profile</p></div></div><dl><div><dt>Name</dt><dd>{user?.name||"Loading…"}</dd></div><div><dt>Email</dt><dd>{user?.email||"—"}</dd></div><div><dt>Access role</dt><dd>{user?.role?.replace("_"," ")||"—"}</dd></div><div><dt>Session</dt><dd><span className="healthy-dot"/> Active and protected</dd></div></dl><button className="danger" onClick={logout}><LogOut size={16}/> Sign out of this device</button></section><section className="panel settings-card"><div className="settings-title"><Settings/><div><h2>CRM configuration</h2><p>Current workspace capabilities</p></div></div><ul className="settings-list"><li><CheckCircle2/> MongoDB persistent storage</li><li><CheckCircle2/> Role-based team accounts</li><li><CheckCircle2/> Secure session authentication</li><li><CheckCircle2/> Lead duplicate prevention</li><li><CheckCircle2/> Activity and visit history</li></ul><p className="settings-note">Workspace branding, branches, custom pipeline stages and messaging integrations require an administrator configuration module before they can be changed here.</p></section></div>;
}

function OfficeView({leads,update,select,addNew}:{leads:Lead[];update:(x:Lead,activity?:{type:string;text:string})=>void;select:(x:Lead)=>void;addNew:()=>void}) {
  const [visitorSearch,setVisitorSearch]=useState("");
  const office=leads.filter(l=>l.inOffice);
  const normalized=visitorSearch.trim().toLowerCase();
  const matches=leads.filter(l=>!l.inOffice && (!normalized || `${l.name} ${l.phone} ${l.email}`.toLowerCase().includes(normalized))).slice(0,6);
  const checkIn=(lead:Lead)=>{ update({...lead,inOffice:true,updated:"Just checked in"},{type:"visit",text:"Visitor checked in"}); setVisitorSearch(""); };
  return <div className="office-grid">
    <section className="panel"><PanelTitle title={`Currently in office · ${office.length}`} subtitle="Live visitor board for reception and counsellors"/>{office.length===0&&<div className="empty compact">No visitors are checked in right now.</div>}{office.map(l=><div className="office-row" key={l.id}><Avatar name={l.name}/><span><strong>{l.name}</strong><small>{l.phone} · {l.country} · {l.course}</small><em>{l.counsellor} · Follow-up: {l.nextFollowUp}</em></span><StageSelect lead={l} compact onChange={stage=>update({...l,stage,updated:"Stage changed just now"},{type:"stage",text:`Stage changed to ${stage}`})}/><button className="secondary" onClick={()=>select(l)}>Open profile</button><button className="danger" onClick={()=>update({...l,inOffice:false,updated:"Just checked out"},{type:"visit",text:"Visitor checked out"})}>Check out</button></div>)}</section>
    <section className="panel quick-checkin"><PanelTitle title="Quick check-in" subtitle="Find any existing lead by name or phone"/>
      <div className="visitor-search"><Search size={19}/><input autoFocus value={visitorSearch} onChange={e=>setVisitorSearch(e.target.value)} placeholder="Type name, phone or email..."/>{visitorSearch&&<button onClick={()=>setVisitorSearch("")} aria-label="Clear search"><X size={16}/></button>}</div>
      <p className="search-hint">{normalized?`${matches.length} matching contact${matches.length===1?"":"s"}`:"Recent contacts"}</p>
      <div className="visitor-results">{matches.map(l=><div className="visitor-result" key={l.id}><button className="visitor-identity" onClick={()=>select(l)}><Avatar name={l.name}/><span><strong>{l.name}</strong><small>{l.phone}{l.email?` · ${l.email}`:""}</small><em>{l.country||"No country preference"} · {l.course||"No course"} · {l.counsellor}</em></span></button><StageSelect lead={l} compact onChange={stage=>update({...l,stage,updated:"Stage changed just now"},{type:"stage",text:`Stage changed to ${stage}`})}/><button className="checkin-now" onClick={()=>checkIn(l)}><UserCheck size={16}/> Check in</button></div>)}</div>
      {normalized&&matches.length===0&&<div className="no-contact"><CircleUserRound size={28}/><strong>No existing contact found</strong><p>Check the phone number or create a new enquiry.</p><button className="primary" onClick={addNew}><Plus size={16}/> Add new lead</button></div>}
    </section>
  </div>
}

function Profile({lead,counsellors,close,update}:{lead:Lead;counsellors:string[];close:()=>void;update:(l:Lead,activity?:{type:string;text:string})=>void}) {
  const [note,setNote]=useState("");
  const notes=(lead.activities||[]).slice().reverse();
  const [action,setAction]=useState<"call"|"followup"|null>(null);
  const [feedback,setFeedback]=useState("");
  const [editing,setEditing]=useState(false);

  function saveCall(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data=new FormData(event.currentTarget); const outcome=String(data.get("outcome")); const details=String(data.get("details")||"").trim();
    const text=`Call logged · ${outcome}${details?` — ${details}`:""}`; update({...lead,updated:"Call logged just now"},{type:"call",text}); setAction(null); setFeedback("Call saved to the student timeline.");
  }
  function saveFollowUp(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data=new FormData(event.currentTarget); const value=String(data.get("date")); if(!value)return;
    const formatted=new Intl.DateTimeFormat("en-NP",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(value));
    const text=`Follow-up scheduled for ${formatted} · ${String(data.get("method"))}`; update({...lead,nextFollowUp:formatted,nextFollowUpISO:new Date(value).toISOString(),updated:"Follow-up scheduled just now"},{type:"follow_up",text}); setAction(null); setFeedback(`Follow-up scheduled for ${formatted}.`);
  }
  function toggleOffice() { const checkedOut=lead.inOffice; update({...lead,inOffice:!lead.inOffice,updated:checkedOut?"Just checked out":"Just checked in"},{type:"visit",text:`Visitor ${checkedOut?"checked out":"checked in"}`}); setFeedback(`${lead.name} has been ${checkedOut?"checked out":"checked in"}.`); }
  function saveDetails(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data=new FormData(event.currentTarget);
    const changed:Lead={...lead,name:String(data.get("name")).trim(),phone:String(data.get("phone")).trim(),email:String(data.get("email")).trim(),address:String(data.get("address")).trim(),education:String(data.get("education")).trim(),country:String(data.get("country")).trim(),course:String(data.get("course")).trim(),university:String(data.get("university")).trim(),source:String(data.get("source")),stage:String(data.get("stage")) as Stage,counsellor:String(data.get("counsellor")),priority:String(data.get("priority")) as Lead["priority"],updated:"Edited just now"};
    update(changed,{type:"note",text:"Student and enquiry details updated"}); setEditing(false); setFeedback("Student details updated successfully.");
  }

  return <div className="drawer-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><aside className="profile-drawer">
    <div className="modal-head"><div><p className="eyebrow">STUDENT #{lead.id}</p></div><button onClick={close}><X/></button></div>
    <div className="profile-hero"><Avatar name={lead.name} warm/><div><h2>{lead.name}</h2><p>{lead.phone} · {lead.email}</p><div className="profile-status"><StageSelect lead={lead} onChange={stage=>{update({...lead,stage,updated:"Stage changed just now"},{type:"stage",text:`Stage changed to ${stage}`});setFeedback(`Stage changed to ${stage}.`)}}/>{lead.inOffice&&<span className="office-status">In office</span>}</div></div></div>
    <div className="quick-actions"><button className={action==="call"?"selected":""} onClick={()=>{setAction(action==="call"?null:"call");setFeedback("")}}><Phone/> Log call</button><button className={action==="followup"?"selected":""} onClick={()=>{setAction(action==="followup"?null:"followup");setFeedback("")}}><CalendarClock/> Follow-up</button><button onClick={toggleOffice}><UserCheck/> {lead.inOffice?"Check out":"Check in"}</button></div>
    {feedback&&<div className="action-success"><CheckCircle2 size={16}/>{feedback}</div>}
    {action==="call"&&<form className="action-form" onSubmit={saveCall}><div className="action-form-title"><Phone size={17}/><div><strong>Log a phone call</strong><small>Save the result in this student’s timeline</small></div></div><label>Call outcome<select name="outcome"><option>Connected</option><option>No answer</option><option>Busy</option><option>Call back requested</option><option>Wrong number</option></select></label><label>Call notes<textarea name="details" required placeholder="What was discussed?"/></label><div><button type="button" className="secondary" onClick={()=>setAction(null)}>Cancel</button><button className="primary">Save call</button></div></form>}
    {action==="followup"&&<form className="action-form" onSubmit={saveFollowUp}><div className="action-form-title"><CalendarClock size={17}/><div><strong>Schedule follow-up</strong><small>Create the next reminder for this student</small></div></div><label>Date and time<input name="date" type="datetime-local" required min={new Date().toISOString().slice(0,16)}/></label><label>Follow-up method<select name="method"><option>Phone call</option><option>WhatsApp</option><option>Email</option><option>Office meeting</option></select></label><div><button type="button" className="secondary" onClick={()=>setAction(null)}>Cancel</button><button className="primary">Schedule</button></div></form>}
    <div className="profile-section"><div className="section-heading"><h3>Student & enquiry details</h3><button className="edit-details" onClick={()=>{setEditing(!editing);setFeedback("")}}><Pencil size={14}/> {editing?"Close editor":"Edit details"}</button></div>
      {editing?<form className="edit-form" onSubmit={saveDetails}><label>Student name<input name="name" required defaultValue={lead.name}/></label><label>Phone number<input name="phone" required defaultValue={lead.phone}/></label><label>Email address<input name="email" type="email" defaultValue={lead.email}/></label><label>Address<input name="address" defaultValue={lead.address}/></label><label>Education<input name="education" defaultValue={lead.education}/></label><label>Interested country<input name="country" defaultValue={lead.country}/></label><label>Course / subject<input name="course" defaultValue={lead.course}/></label><label>Preferred university<input name="university" defaultValue={lead.university}/></label><label>Lead source<select name="source" defaultValue={lead.source}><option>Facebook</option><option>Phone call</option><option>Walk-in</option><option>Instagram</option><option>Referral</option><option>Website</option><option>Other</option></select></label><label>Pipeline stage<select name="stage" defaultValue={lead.stage}>{Object.keys(stageStyle).map(stage=><option key={stage}>{stage}</option>)}</select></label><label>Assigned counsellor<select name="counsellor" defaultValue={lead.counsellor}><option>Unassigned</option>{counsellors.map(name=><option key={name}>{name}</option>)}</select></label><label>Priority<select name="priority" defaultValue={lead.priority}><option>High</option><option>Medium</option><option>Low</option></select></label><div className="edit-actions"><button type="button" className="secondary" onClick={()=>setEditing(false)}>Cancel</button><button className="primary">Save changes</button></div></form>:<dl><div><dt>Country</dt><dd>{lead.country||"—"}</dd></div><div><dt>Course</dt><dd>{lead.course||"—"}</dd></div><div><dt>University</dt><dd>{lead.university||"—"}</dd></div><div><dt>Education</dt><dd>{lead.education||"—"}</dd></div><div><dt>Address</dt><dd>{lead.address||"—"}</dd></div><div><dt>Source</dt><dd>{lead.source}</dd></div><div><dt>Assigned to</dt><dd>{lead.counsellor}</dd></div><div><dt>Next follow-up</dt><dd>{lead.nextFollowUp}</dd></div></dl>}
    </div>
    <div className="profile-section"><h3>Conversation timeline</h3><form className="note-box" onSubmit={e=>{e.preventDefault();if(note.trim()){update({...lead,updated:"Note added just now"},{type:"note",text:note});setNote("");setFeedback("Note saved to the timeline.")}}}><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Write today’s discussion, requirement or remark..."/><button className="primary">Save note</button></form><div className="timeline">{notes.map((item,i)=><div key={`${item.occurredAt}-${i}`}><span><MessageSquareText size={15}/></span><p>{item.text}<small>{new Intl.DateTimeFormat("en-NP",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(item.occurredAt))} · {item.authorName}</small></p></div>)}{notes.length===0&&<div className="empty compact">No activity yet.</div>}</div></div>
  </aside></div>
}
