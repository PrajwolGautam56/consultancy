"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, MessageCircle, RefreshCw, Send, ShieldCheck, Upload, X } from "lucide-react";

type Contact = { _id: string; name: string; phone: string; whatsappOptIn?: boolean };
type Message = { _id: string; leadId?: string; direction: "inbound" | "outbound"; body: string; status: string; occurredAt: string };
type Campaign = { _id: string; name: string; status: string; total: number; sent: number; failed: number; createdAt: string };

export default function WhatsAppView({ privileged }: { privileged: boolean }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [configured, setConfigured] = useState(false);
  const [selectedContact, setSelectedContact] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  async function load() {
    const [messageResponse, campaignResponse] = await Promise.all([
      fetch("/api/whatsapp/messages"),
      privileged ? fetch("/api/whatsapp/campaigns") : Promise.resolve(null),
    ]);
    const messageData = await messageResponse.json();
    if (messageResponse.ok) {
      setContacts(messageData.leads || []); setMessages(messageData.messages || []); setConfigured(Boolean(messageData.configured));
      if (!selectedContact && messageData.leads?.[0]) setSelectedContact(String(messageData.leads[0]._id));
    }
    if (campaignResponse) { const data = await campaignResponse.json(); if (campaignResponse.ok) setCampaigns(data.campaigns || []); }
  }
  useEffect(() => {
    fetch("/api/whatsapp/messages")
      .then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (!ok) return;
        setContacts(data.leads || []); setMessages(data.messages || []); setConfigured(Boolean(data.configured));
        if (data.leads?.[0]) setSelectedContact(String(data.leads[0]._id));
      });
    if (privileged) fetch("/api/whatsapp/campaigns").then(async (response) => ({ ok: response.ok, data: await response.json() })).then(({ ok, data }) => { if (ok) setCampaigns(data.campaigns || []); });
  }, [privileged]);

  const filtered = contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(search.toLowerCase()));
  const thread = useMemo(() => messages.filter((message) => String(message.leadId || "") === selectedContact).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)), [messages, selectedContact]);
  const optedInSelected = checked.filter((id) => contacts.find((contact) => String(contact._id) === id)?.whatsappOptIn);

  function toggle(id: string) { setChecked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  async function recordConsent(optedIn: boolean) {
    if (!checked.length) return setNotice("Select at least one student first.");
    setBusy(true); setNotice("");
    const response = await fetch("/api/whatsapp/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds: checked, optedIn, source: optedIn ? "Recorded by staff in CRM" : "Student opted out" }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setNotice(data.error || "Consent could not be updated");
    setNotice(`${data.updated} student consent record(s) updated.`); setChecked([]); await load();
  }
  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!reply.trim() || !selectedContact) return;
    setBusy(true); setNotice("");
    const response = await fetch("/api/whatsapp/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: selectedContact, text: reply }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setNotice(data.error || "Reply could not be sent");
    setReply(""); await load();
  }
  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!optedInSelected.length) return setNotice("Select students with recorded WhatsApp opt-in.");
    const form = new FormData(event.currentTarget); setBusy(true); setNotice("");
    const response = await fetch("/api/whatsapp/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), templateName: form.get("templateName"), language: form.get("language"), leadIds: optedInSelected, bodyParameters: ["{{name}}", String(form.get("eventDetail") || "")] }) });
    const data = await response.json();
    if (!response.ok) { setBusy(false); return setNotice(data.error || "Campaign could not be created"); }
    let done = false; let progress = { sent: 0, failed: 0, total: data.campaign.total };
    while (!done) {
      const processResponse = await fetch("/api/whatsapp/campaigns/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: data.campaign._id }) });
      const result = await processResponse.json();
      if (!processResponse.ok) { setBusy(false); return setNotice(result.error || "Campaign paused"); }
      done = result.done; progress = result; setNotice(`Sending: ${result.sent + result.failed}/${result.total}`);
    }
    setBusy(false); setChecked([]); setNotice(`Campaign completed: ${progress.sent} sent, ${progress.failed} failed.`); await load();
  }
  function parseImport() {
    return importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const columns = line.split(line.includes("\t") ? "\t" : ",").map((value) => value.trim().replace(/^['"]|['"]$/g, ""));
      return { name: columns[0] || "", phone: columns[1] || "" };
    }).filter((contact, index) => contact.name && contact.phone && !(index === 0 && /name/i.test(contact.name) && /phone|mobile/i.test(contact.phone)));
  }
  async function importContacts() {
    const parsed = parseImport();
    if (!parsed.length) return setNotice("Paste contacts as Name, Phone — one student per line.");
    if (!consentConfirmed) return setNotice("Confirm that these students agreed to receive WhatsApp messages.");
    setBusy(true); setNotice(`Importing ${parsed.length} contacts…`);
    const response = await fetch("/api/whatsapp/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: parsed, consentConfirmed: true, consentSource: "Bulk campaign list confirmed by administrator" }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setNotice(data.error || "Contacts could not be imported");
    await load(); setChecked(data.leadIds || []); setShowImport(false); setImportText(""); setConsentConfirmed(false);
    setNotice(`${data.total} contacts ready and selected: ${data.created} new, ${data.matched} matched existing CRM records.`);
  }

  return <div className="wa-page">
    {!configured && <div className="wa-warning"><ShieldCheck size={20}/><span><strong>WhatsApp API setup required</strong><small>Add the Meta credentials in Vercel before sending. The inbox and consent preparation can be used now.</small></span></div>}
    {notice && <div className="team-success">{notice}</div>}
    <section className="panel wa-inbox">
      <div className="wa-contacts">
        <div className="wa-section-head"><span><strong>WhatsApp inbox</strong><small>{contacts.length} CRM contacts</small></span><button onClick={() => void load()} aria-label="Refresh"><RefreshCw size={15}/></button></div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student or phone" />
        <div className="wa-contact-list">{filtered.map((contact) => <button className={selectedContact === String(contact._id) ? "active" : ""} key={contact._id} onClick={() => setSelectedContact(String(contact._id))}><span>{contact.name.slice(0,1)}</span><b>{contact.name}<small>{contact.phone}</small></b>{contact.whatsappOptIn && <Check size={14}/>}</button>)}</div>
      </div>
      <div className="wa-thread">
        <div className="wa-section-head"><span><strong>{contacts.find((item) => String(item._id) === selectedContact)?.name || "Select a student"}</strong><small>Replies allowed during Meta’s 24-hour customer window</small></span><MessageCircle size={19}/></div>
        <div className="wa-messages">{thread.map((message) => <div key={message._id} className={`wa-bubble ${message.direction}`}><p>{message.body}</p><small>{new Date(message.occurredAt).toLocaleString("en-NP")} · {message.status}</small></div>)}{!thread.length && <div className="empty">No WhatsApp messages linked to this student yet.</div>}</div>
        <form className="wa-reply" onSubmit={sendReply}><input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply…"/><button className="primary" disabled={busy || !configured || !selectedContact}><Send size={15}/> Send</button></form>
      </div>
    </section>
    {privileged && <section className="panel wa-campaign">
      <div className="task-toolbar"><span><h2>Bulk WhatsApp campaign</h2><p>Import a name/phone list or select existing opted-in CRM contacts.</p></span><button className="primary" onClick={() => setShowImport(true)}><Upload size={15}/> Import contacts</button></div>
      {showImport && <div className="wa-import"><header><span><strong>Bulk import campaign contacts</strong><small>CSV columns or pasted lines: Name, Phone</small></span><button onClick={() => setShowImport(false)} aria-label="Close import"><X size={16}/></button></header><div><label>Paste name and phone<textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={"Name, Phone\nAayush Shrestha, 9841280991\nSita Rai, 9800000000"}/></label><label className="wa-file"><Upload size={18}/><span>Upload CSV file<small>The first two columns must be Name and Phone.</small></span><input type="file" accept=".csv,text/csv,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) file.text().then(setImportText); }}/></label></div><label className="wa-consent"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)}/><span>I confirm these students agreed to receive WhatsApp messages from AIMS Global. The CRM will store this consent source.</span></label><footer><span>{parseImport().length} valid row(s) detected</span><button className="primary" disabled={busy || !consentConfirmed || !parseImport().length} onClick={() => void importContacts()}>{busy ? "Importing…" : "Import and select students"}</button></footer></div>}
      <div className="wa-campaign-grid">
        <div className="wa-audience"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter students"/><div>{filtered.map((contact) => <label key={contact._id}><input type="checkbox" checked={checked.includes(String(contact._id))} onChange={() => toggle(String(contact._id))}/><span><strong>{contact.name}</strong><small>{contact.phone}</small></span><em className={contact.whatsappOptIn ? "yes" : "no"}>{contact.whatsappOptIn ? "Opted in" : "No consent"}</em></label>)}</div><footer><button className="secondary" disabled={busy} onClick={() => void recordConsent(true)}>Record opt-in</button><button className="secondary" disabled={busy} onClick={() => void recordConsent(false)}>Opt out</button></footer></div>
        <form className="wa-campaign-form" onSubmit={createCampaign}><label>Campaign name<input required name="name" placeholder="India scholarship – September"/></label><label>Approved Meta template name<input required name="templateName" pattern="[a-z0-9_]+" placeholder="india_scholarship_event"/></label><div><label>Language code<input required name="language" defaultValue="en"/></label><label>Event date/detail<input required name="eventDetail" placeholder="5 October, 11 AM"/></label></div><div className="wa-estimate"><strong>{optedInSelected.length} recipients selected</strong><span>Estimated Meta marketing fee: ≈ NPR {(optedInSelected.length * 13.87).toLocaleString("en-NP", { maximumFractionDigits: 0 })}</span><small>Estimate only; Meta bills by recipient country and delivered message.</small></div><button className="primary" disabled={busy || !configured || !optedInSelected.length}><Send size={16}/>{busy ? "Sending…" : "Create and send campaign"}</button></form>
      </div>
      {!!campaigns.length && <div className="wa-campaign-history"><h3>Recent campaigns</h3>{campaigns.map((campaign) => <div key={campaign._id}><span><strong>{campaign.name}</strong><small>{new Date(campaign.createdAt).toLocaleString("en-NP")}</small></span><b>{campaign.status}</b><em>{campaign.sent}/{campaign.total} sent · {campaign.failed} failed</em></div>)}</div>}
    </section>}
  </div>;
}
