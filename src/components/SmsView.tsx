"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Coins, FileSpreadsheet, Loader2, MessageSquareText, Plus, RefreshCw, Search, Send, Upload, Users, X } from "lucide-react";

type Lead = { _id: string; name: string; phone: string; country?: string; course?: string; university?: string; counsellor?: string };
type Group = { _id: string; name: string; description?: string; color?: string; memberIds: string[] };
type Balance = { routeId: string; route: string; balance: number };
type ProviderId = "samaya" | "smspasal";
type Provider = {
  id: ProviderId; name: string; configured: boolean; senderId: string; routeId: string; campaignId: string;
  balances: Balance[]; error?: string;
  lastTransaction?: { submissionTime: string; chargePerSms: number; totalCreditsDeducted: number; smsText: string } | null;
};
type Campaign = { _id: string; name: string; providerId: string; senderId: string; status: string; total: number; submitted: number; delivered: number; failed: number; estimatedCredits: number; scheduledAt?: string; createdAt: string; lastError?: string };
type ImportCell = string | number | boolean | Date | null;
type ImportSheet = { sheet: string; data: ImportCell[][] };

async function api<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function normalizeLocalPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("977") && digits.length === 13) digits = digits.slice(3);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return digits;
}

const gsmBasic = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""));
const gsmExtended = new Set("^{}\\[~]|€".split(""));
function estimate(message: string) {
  let units = 0; let unicode = false;
  for (const character of message) {
    if (gsmBasic.has(character)) units += 1;
    else if (gsmExtended.has(character)) units += 2;
    else { unicode = true; units = Array.from(message).length; break; }
  }
  const single = unicode ? 70 : 160; const joined = unicode ? 67 : 153;
  return { encoding: unicode ? "Unicode" : "GSM text", units, segments: units <= single ? 1 : Math.ceil(units / joined) };
}

function renderMessage(template: string, lead: Lead) {
  const values: Record<string, string> = {
    name: lead.name || "", phone: normalizeLocalPhone(lead.phone), country: lead.country || "",
    course: lead.course || "", university: lead.university || "", counsellor: lead.counsellor || "",
  };
  return template.replace(/\{\{\s*(name|phone|country|course|university|counsellor)\s*\}\}/gi, (_, key: string) => values[key.toLowerCase()] || "");
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function SmsView({ privileged }: { privileged: boolean }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>("samaya");
  const [groupId, setGroupId] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [senderId, setSenderId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [providerCampaignId, setProviderCampaignId] = useState("");
  const [message, setMessage] = useState("Hello {{name}}, ");
  const [scheduledAt, setScheduledAt] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<Array<{ name: string; phone: string }>>([]);
  const [importGroupId, setImportGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [consentSource, setConsentSource] = useState("CRM bulk import");
  const [importConsent, setImportConsent] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [status, audience, history] = await Promise.all([
        api<{ providers: Provider[] }>(await fetch("/api/sms/status", { cache: "no-store" })),
        api<{ leads: Lead[]; groups: Group[] }>(await fetch("/api/sms/audience", { cache: "no-store" })),
        api<{ campaigns: Campaign[] }>(await fetch("/api/sms/campaigns", { cache: "no-store" })),
      ]);
      setProviders(status.providers || []); setLeads(audience.leads || []); setGroups(audience.groups || []); setCampaigns(history.campaigns || []);
      const provider = status.providers?.find((item) => item.id === providerId) || status.providers?.[0];
      if (provider) {
        setSenderId((current) => current || provider.senderId); setRouteId((current) => current || provider.routeId);
        setProviderCampaignId((current) => current || provider.campaignId);
      }
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "SMS workspace could not be loaded"); }
    finally { setRefreshing(false); }
  }, [providerId]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { if (alive && privileged) void load(); });
    return () => { alive = false; };
  }, [load, privileged]);

  const filtered = useMemo(() => {
    const group = groups.find((item) => item._id === groupId);
    const members = group ? new Set(group.memberIds) : null;
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => (!members || members.has(lead._id)) && (!query || `${lead.name} ${lead.phone} ${lead.country || ""} ${lead.course || ""}`.toLowerCase().includes(query)));
  }, [groups, groupId, leads, search]);
  const selectedLeads = useMemo(() => leads.filter((lead) => selected.includes(lead._id)), [leads, selected]);
  const previewLead = selectedLeads[0] || { _id: "preview", name: "Student", phone: "98XXXXXXXX" };
  const preview = renderMessage(message, previewLead);
  const previewEstimate = estimate(preview);
  const totalCredits = selectedLeads.reduce((sum, lead) => sum + estimate(renderMessage(message, lead)).segments, 0);
  const provider = providers.find((item) => item.id === providerId);
  const activeBalance = provider?.balances.find((item) => item.routeId === routeId) || provider?.balances[0];

  function chooseProvider(nextProviderId: ProviderId) {
    setProviderId(nextProviderId);
    const nextProvider = providers.find((item) => item.id === nextProviderId);
    if (!nextProvider) return;
    setSenderId(nextProvider.senderId);
    setRouteId(nextProvider.routeId);
    setProviderCampaignId(nextProvider.campaignId);
  }

  function toggleAll() {
    const ids = filtered.map((lead) => lead._id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected(allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  }

  async function processCampaign(campaignId: string) {
    for (let page = 0; page < 120; page += 1) {
      const result = await api<{ done: boolean; scheduled?: boolean }>(await fetch("/api/sms/campaigns/process", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId }),
      }));
      if (result.done || result.scheduled) return;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    throw new Error("Campaign remains queued. Reopen SMS to continue processing.");
  }

  async function sendCampaign() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ campaign: { _id: string; total: number; estimatedCredits: number } }>(await fetch("/api/sms/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName || `SMS ${new Date().toLocaleDateString("en-NP")}`, providerId, senderId, routeId,
          providerCampaignId, messageTemplate: message, leadIds: selected, consentConfirmed,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        }),
      }));
      setNotice(`Campaign queued for ${result.campaign.total} contacts. Estimated ${result.campaign.estimatedCredits} credits.`);
      await processCampaign(result.campaign._id); setSelected([]); setCampaignName(""); await load(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Campaign could not be sent"); }
    finally { setBusy(false); }
  }

  async function refreshDlr(campaignId: string) {
    setBusy(true); setError("");
    try {
      const result = await api<{ delivered: number; failed: number; checked: number }>(await fetch("/api/sms/campaigns/dlr", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId }),
      }));
      setNotice(`Delivery report checked ${result.checked} messages: ${result.delivered} delivered, ${result.failed} failed.`); await load(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Delivery report could not be refreshed"); }
    finally { setBusy(false); }
  }

  function parsePastedContacts(value: string) {
    const rows = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.split(",");
      return { name: String(cells[0] || "").trim(), phone: String(cells[1] || "").trim() };
    }).filter((row, index) => index > 0 || !/name/i.test(row.name) || !/phone|mobile|contact/i.test(row.phone));
    setImportRows(rows.filter((row) => row.name.length >= 2 && row.phone).slice(0, 1000));
  }

  async function loadSpreadsheet(file: File) {
    setError("");
    try {
      if (/\.csv$|\.tsv$/i.test(file.name)) { parsePastedContacts(await file.text()); return; }
      const readXlsxFile = (await import("read-excel-file/browser")).default;
      const sheets = await readXlsxFile(file) as ImportSheet[];
      const rows = sheets[0]?.data || [];
      const values = rows.map((row: ImportCell[]) => row.map((cell: ImportCell) => String(cell ?? "").trim()));
      const header = values.findIndex((row) => row.some((cell) => /name|student/i.test(cell)) && row.some((cell) => /phone|mobile|contact/i.test(cell)));
      const headerRow = header >= 0 ? values[header] : values[0] || [];
      const nameColumn = Math.max(0, headerRow.findIndex((cell) => /name|student/i.test(cell)));
      const phoneFound = headerRow.findIndex((cell) => /phone|mobile|contact/i.test(cell));
      const phoneColumn = phoneFound >= 0 ? phoneFound : nameColumn === 0 ? 1 : 0;
      setImportRows(values.slice((header >= 0 ? header : -1) + 1).map((row) => ({ name: row[nameColumn] || "", phone: row[phoneColumn] || "" })).filter((row) => row.name.length >= 2 && row.phone).slice(0, 1000));
    } catch (err) { setError(err instanceof Error ? err.message : "Spreadsheet could not be read"); }
  }

  async function importContacts() {
    setBusy(true); setError(""); setNotice("");
    try {
      let targetGroupId = importGroupId || undefined;
      if (newGroupName.trim()) {
        const created = await api<{ group: Group }>(await fetch("/api/whatsapp/groups", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newGroupName.trim(), description: "Imported from SMS workspace", color: "blue" }),
        }));
        targetGroupId = created.group._id;
      }
      const result = await api<{ total: number; created: number; matched: number; skipped: number }>(await fetch("/api/sms/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: importRows, consentConfirmed: importConsent, consentSource, ...(targetGroupId ? { groupId: targetGroupId } : {}) }),
      }));
      setNotice(`Imported ${result.total}: ${result.created} new, ${result.matched} matched, ${result.skipped} skipped.`);
      setShowImport(false); setImportRows([]); setNewGroupName(""); await load(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Contacts could not be imported"); }
    finally { setBusy(false); }
  }

  if (!privileged) return <section className="panel sms-denied"><AlertCircle/><strong>Administrator or manager access is required for bulk SMS.</strong></section>;

  return <div className="sms-workspace">
    <div className="sms-title-row">
      <div><span className="eyebrow">MOBILE MESSAGING</span><h2>SMS campaigns</h2><p>Send personalized mobile SMS to CRM contacts and reusable groups.</p></div>
      <div className="sms-title-actions"><button className="secondary" onClick={() => setShowImport(true)}><Upload size={16}/> Import contacts</button><button className="secondary" onClick={() => void load()} disabled={refreshing}><RefreshCw className={refreshing ? "sms-spin" : ""} size={16}/> Refresh</button></div>
    </div>
    {error && <div className="sms-alert error"><AlertCircle size={18}/><span>{error}</span></div>}
    {notice && <div className="sms-alert success"><CheckCircle2 size={18}/><span>{notice}</span></div>}

    <section className="sms-provider-strip">
      {(providers.length ? providers : [{ id: "samaya", name: "Samaya SMS", configured: false, senderId: "", routeId: "", campaignId: "", balances: [], error: "Loading provider..." } as Provider]).map((item) => <article key={item.id} className={item.configured ? "connected" : "disconnected"}>
        <div className="sms-provider-icon"><MessageSquareText size={20}/></div>
        <div className="sms-provider-main"><strong>{item.name}</strong><small>{item.configured ? "Connected through server environment" : "Not configured"}</small>{item.error && <em>{item.error}</em>}</div>
        <div className="sms-balance"><Coins size={17}/><span><strong>{item.balances.reduce((sum, balance) => sum + balance.balance, 0).toLocaleString()}</strong><small>credits available</small></span></div>
        <div className="sms-last"><small>Last charge</small><strong>{item.lastTransaction ? `${item.lastTransaction.totalCreditsDeducted} credits (${item.lastTransaction.chargePerSms}/SMS)` : "No transaction data"}</strong></div>
      </article>)}
    </section>

    <div className="sms-campaign-grid">
      <section className="panel sms-audience">
        <header><div><Users size={18}/><span><strong>Audience</strong><small>{selected.length} selected from {leads.length}</small></span></div><button onClick={toggleAll}>{filtered.length && filtered.every((lead) => selected.includes(lead._id)) ? "Clear shown" : "Select shown"}</button></header>
        <div className="sms-audience-tools"><label>Contact group<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="all">All contacts</option>{groups.map((group) => <option key={group._id} value={group._id}>{group.name} ({group.memberIds.length})</option>)}</select></label><div className="sms-search"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone"/></div></div>
        <div className="sms-contact-list">{filtered.map((lead) => <label key={lead._id}><input type="checkbox" checked={selected.includes(lead._id)} onChange={() => setSelected((current) => current.includes(lead._id) ? current.filter((id) => id !== lead._id) : [...current, lead._id])}/><span className="sms-avatar">{lead.name.slice(0,1).toUpperCase()}</span><span><strong>{lead.name}</strong><small>{lead.phone}{lead.country ? ` · ${lead.country}` : ""}</small></span></label>)}{filtered.length === 0 && <div className="empty">No matching contacts.</div>}</div>
      </section>

      <section className="panel sms-composer">
        <header><div><Send size={18}/><span><strong>Create campaign</strong><small>Dynamic fields are rendered separately for every contact.</small></span></div></header>
        <div className="sms-form">
          <div className="sms-form-row"><label>Campaign name<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="October counselling reminder"/></label><label>Provider<select value={providerId} onChange={(event) => chooseProvider(event.target.value as ProviderId)}>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}{item.configured ? "" : " · not configured"}</option>)}</select></label></div>
          <div className="sms-form-row triple"><label>Sender ID<input value={senderId} onChange={(event) => setSenderId(event.target.value)} placeholder="Approved sender ID"/></label><label>Route<select value={routeId} onChange={(event) => setRouteId(event.target.value)}>{provider?.balances.length ? provider.balances.map((balance) => <option key={balance.routeId} value={balance.routeId}>{balance.route} · {balance.balance}</option>) : <option value={routeId}>{routeId || "Default route"}</option>}</select></label><label>Provider campaign ID<input value={providerCampaignId} onChange={(event) => setProviderCampaignId(event.target.value)}/></label></div>
          <label>Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={720}/></label>
          <div className="sms-tokens">{["name","phone","country","course","university","counsellor"].map((token) => <button key={token} type="button" onClick={() => setMessage((current) => `${current}{{${token}}}`)}>{`{{${token}}}`}</button>)}</div>
          <div className="sms-preview"><span><strong>Preview for {previewLead.name}</strong><small>{previewEstimate.encoding} · {previewEstimate.units} units · {previewEstimate.segments} SMS segment{previewEstimate.segments === 1 ? "" : "s"}</small></span><p>{preview || "Your message preview appears here."}</p></div>
          <label>Schedule (optional)<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)}/></label>
          <label className="sms-consent"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)}/><span><strong>Recipient permission confirmed</strong><small>I confirm these contacts can receive this organization&apos;s SMS.</small></span></label>
          <div className="sms-send-dock"><span><strong>{selected.length} recipients · about {totalCredits} credits</strong><small>{activeBalance ? `${activeBalance.balance} credits currently reported on ${activeBalance.route}` : "Provider balance unavailable"}</small></span><button className="primary" disabled={busy || !provider?.configured || !selected.length || !message.trim() || !senderId.trim() || !consentConfirmed || totalCredits > (activeBalance?.balance ?? Number.POSITIVE_INFINITY)} onClick={() => void sendCampaign()}>{busy ? <Loader2 className="sms-spin" size={17}/> : <Send size={17}/>} {scheduledAt ? "Schedule SMS" : "Queue and send"}</button></div>
        </div>
      </section>
    </div>

    <section className="panel sms-history"><header><div><Clock3 size={18}/><span><strong>Campaign history</strong><small>Submission and provider delivery status</small></span></div></header><div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Provider</th><th>Status</th><th>Recipients</th><th>Credits</th><th>Created</th><th></th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign._id}><td><strong>{campaign.name}</strong><small>{campaign.senderId}</small>{campaign.lastError ? <small className="sms-row-error">{campaign.lastError}</small> : null}</td><td>{providers.find((item) => item.id === campaign.providerId)?.name || campaign.providerId}</td><td><span className={`sms-status ${campaign.status}`}>{campaign.status.replaceAll("_", " ")}</span></td><td>{campaign.submitted} submitted · {campaign.delivered} delivered · {campaign.failed} failed</td><td>{campaign.estimatedCredits}</td><td>{formatDate(campaign.createdAt)}{campaign.scheduledAt ? <small>Scheduled {formatDate(campaign.scheduledAt)}</small> : null}</td><td><button className="secondary sms-dlr" disabled={busy || !campaign.submitted} onClick={() => void refreshDlr(campaign._id)}>Check DLR</button></td></tr>)}</tbody></table>{campaigns.length === 0 && <div className="empty">No SMS campaigns yet.</div>}</div></section>

    {showImport && <div className="modal-backdrop"><section className="modal sms-import-modal"><header className="modal-head"><div><h2>Import SMS contacts</h2><p>Upload CSV/XLSX or paste Name and Phone columns. Duplicates are matched to existing CRM records.</p></div><button onClick={() => setShowImport(false)}><X size={18}/></button></header><div className="sms-import-body">
      <label className="sms-file-drop"><FileSpreadsheet size={23}/><span><strong>Select spreadsheet</strong><small>.xlsx, .csv or .tsv · maximum 1,000 contacts</small></span><input type="file" accept=".xlsx,.csv,.tsv" onChange={(event) => { const file=event.target.files?.[0]; if(file) void loadSpreadsheet(file); }}/></label>
      <label>Or paste Name, Phone<textarea placeholder={"Name,Phone\nAayush Shrestha,9841280991"} onChange={(event) => parsePastedContacts(event.target.value)}/></label>
      <div className="sms-import-grid"><label>Existing group<select value={importGroupId} onChange={(event) => setImportGroupId(event.target.value)}><option value="">No group</option>{groups.map((group) => <option key={group._id} value={group._id}>{group.name}</option>)}</select></label><label>Or create new group<input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="e.g. CEE 2026"/></label><label>Permission source<input value={consentSource} onChange={(event) => setConsentSource(event.target.value)} placeholder="Form, event, CRM import..."/></label></div>
      <div className="sms-import-preview"><strong>{importRows.length} valid rows ready</strong>{importRows.slice(0,5).map((row,index) => <span key={`${row.phone}-${index}`}>{row.name}<small>{row.phone}</small></span>)}</div>
      <label className="sms-consent"><input type="checkbox" checked={importConsent} onChange={(event) => setImportConsent(event.target.checked)}/><span><strong>SMS permission confirmed</strong><small>I confirm these contacts can receive this organization&apos;s SMS and the source above is accurate.</small></span></label>
    </div><footer className="sms-import-footer"><button className="secondary" onClick={() => setShowImport(false)}>Cancel</button><button className="primary" disabled={busy || !importRows.length || !importConsent || consentSource.trim().length < 3} onClick={() => void importContacts()}>{busy ? <Loader2 className="sms-spin" size={16}/> : <Plus size={16}/>} Import {importRows.length || ""} contacts</button></footer></section></div>}
  </div>;
}
