"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, ArrowLeft, Check, CheckCheck, ChevronDown, Clock3, FileText, ImagePlus, Loader2, MessageCircle, RefreshCw, Search, Send, ShieldCheck, Upload, X } from "lucide-react";

type Contact = { _id: string; name: string; phone: string; whatsappOptIn?: boolean; unlinked?: boolean };
type Message = { _id: string; leadId?: string | null; waId?: string; direction: "inbound" | "outbound"; type?: string; body: string; mediaId?: string; mimeType?: string; status: string; error?: string; occurredAt: string };
type Conversation = { conversationId: string; lastMessage: Message };
type Campaign = { _id: string; name: string; status: string; total: number; sent: number; failed: number; accepted?: number; delivered?: number; read?: number; deliveryFailed?: number; lastDeliveryError?: string; createdAt: string };
type Template = { name: string; language: string; category: string; parameterCount: number; body?: string };
type WhatsAppSetup = { accountId: string; phoneId: string; phoneMatches: boolean; phones: Array<{ id: string; displayPhoneNumber: string }>; subscribedApps: Array<{ id: string; name: string }>; templateCount: number; errors: { phones?: string; subscriptions?: string; templates?: string } };

function messageConversationId(message: Message) {
  return message.leadId ? String(message.leadId) : message.waId ? `wa:${message.waId}` : "";
}

function timeLabel(value?: string, detailed = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (!detailed && sameDay) return date.toLocaleTimeString("en-NP", { hour: "numeric", minute: "2-digit" });
  return date.toLocaleString("en-NP", detailed
    ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short" });
}

function statusLabel(status: string) {
  if (status === "read") return <><CheckCheck size={13} /> Read</>;
  if (status === "delivered") return <><CheckCheck size={13} /> Delivered</>;
  if (status === "sent") return <><Check size={13} /> Sent</>;
  if (status === "failed") return <><AlertCircle size={13} /> Failed</>;
  if (status === "queued") return <><Clock3 size={13} /> Queued</>;
  return status === "received" ? "Received" : status;
}

function MessageBody({ message }: { message: Message }) {
  const mediaUrl = message.mediaId ? `/api/whatsapp/media/${encodeURIComponent(message._id)}` : "";
  const hasCaption = Boolean(message.body && !/^\[[^\]]+\]$/.test(message.body));
  return <>
    {mediaUrl && (message.type === "image" || message.type === "sticker") && <a className="wa-media-image" href={mediaUrl} target="_blank" rel="noreferrer" aria-label="Open image"><Image src={mediaUrl} alt={hasCaption ? message.body : "WhatsApp image"} width={320} height={260} unoptimized/></a>}
    {mediaUrl && message.type === "audio" && <audio className="wa-media-player" controls preload="none" src={mediaUrl}>Audio message</audio>}
    {mediaUrl && message.type === "video" && <video className="wa-media-player" controls preload="none" src={mediaUrl}>Video message</video>}
    {mediaUrl && message.type === "document" && <a className="wa-media-document" href={mediaUrl} target="_blank" rel="noreferrer"><FileText size={19}/><span>Open document</span></a>}
    {(!mediaUrl || hasCaption) && <p>{message.body || `[${message.type || "message"}]`}</p>}
  </>;
}

async function readApi<T>(response: Response): Promise<T> {
  let data: { error?: string } & T;
  try { data = await response.json(); }
  catch { throw new Error(`Service returned an unreadable response (${response.status}). Please retry or check connection health.`); }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

export default function WhatsAppView({ privileged, superAdmin = false }: { privileged: boolean; superAdmin?: boolean }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [thread, setThread] = useState<Message[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedOneTemplate, setSelectedOneTemplate] = useState("");
  const [templateValues, setTemplateValues] = useState<string[]>([]);
  const [showTemplateComposer, setShowTemplateComposer] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [selectedContact, setSelectedContact] = useState("");
  const [inboxTab, setInboxTab] = useState<"chats" | "contacts">("chats");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [audienceSearch, setAudienceSearch] = useState("");
  const [reply, setReply] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [setup, setSetup] = useState<WhatsAppSetup | null>(null);
  const [setupError, setSetupError] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [threadError, setThreadError] = useState("");
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadReload, setThreadReload] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastInboundAt, setLastInboundAt] = useState<string | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const activeConversationRef = useRef("");

  const refreshInbox = useCallback(async (quiet = false) => {
    if (quiet && document.visibilityState === "hidden") return;
    if (!quiet) setRefreshing(true);
    try {
      const data = await readApi<{ configured: boolean; leads: Contact[]; messages: Message[]; conversations?: Conversation[] }>(await fetch("/api/whatsapp/messages", { cache: "no-store" }));
      const nextContacts = data.leads || [];
      const nextMessages = data.messages || [];
      const nextConversations = data.conversations || [];
      setContacts(nextContacts);
      setRecentMessages(nextMessages);
      setConversations(nextConversations);
      setConfigured(Boolean(data.configured));
      setInboxError("");
      setLastUpdated(new Date());
      setSelectedContact((current) => current || nextConversations[0]?.conversationId || messageConversationId(nextMessages[0] || {} as Message) || "");
    } catch (error) {
      if (!quiet) setInboxError(error instanceof Error ? error.message : "Inbox could not be loaded.");
    } finally {
      setLoadingInbox(false);
      setRefreshing(false);
    }
  }, []);

  const refreshMetadata = useCallback(async () => {
    const results = await Promise.allSettled([
      fetch("/api/whatsapp/templates", { cache: "no-store" }).then((response) => readApi<{ templates: Template[] }>(response)),
      privileged ? fetch("/api/whatsapp/campaigns", { cache: "no-store" }).then((response) => readApi<{ campaigns: Campaign[] }>(response)) : Promise.resolve({ campaigns: [] }),
    ]);
    if (results[0].status === "fulfilled") {
      const available = results[0].value.templates || [];
      setTemplates(available);
      setTemplateError("");
      setSelectedTemplate((current) => current || available[0]?.name || "");
      setSelectedOneTemplate((current) => current || available[0]?.name || "");
    } else setTemplateError(results[0].reason instanceof Error ? results[0].reason.message : "Approved templates could not be loaded.");
    if (results[1].status === "fulfilled") setCampaigns(results[1].value.campaigns || []);
  }, [privileged]);

  const refreshSetup = useCallback(async () => {
    if (!superAdmin) return;
    try {
      const data = await readApi<WhatsAppSetup>(await fetch("/api/whatsapp/setup", { cache: "no-store" }));
      setSetup(data); setSetupError("");
    } catch (error) { setSetupError(error instanceof Error ? error.message : "Connection status could not be loaded."); }
  }, [superAdmin]);

  async function connectWebhook() {
    setSetupBusy(true); setSetupError("");
    try {
      await readApi<{ success: boolean }>(await fetch("/api/whatsapp/setup", { method: "POST" }));
      await refreshSetup();
      setNotice("The CRM app is subscribed to incoming WhatsApp webhooks. Send a new test message to verify delivery.");
    } catch (error) { setSetupError(error instanceof Error ? error.message : "WhatsApp webhook could not be connected."); }
    finally { setSetupBusy(false); }
  }

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { if (alive) { void refreshInbox(); void refreshMetadata(); void refreshSetup(); } });
    const timer = window.setInterval(() => void refreshInbox(true), 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [refreshInbox, refreshMetadata, refreshSetup]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    activeConversationRef.current = selectedContact;
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      setThread([]); setHasMore(false); setLastInboundAt(undefined); setThreadError("");
      setLoadingThread(Boolean(selectedContact));
    });
    if (!selectedContact) return () => { alive = false; };
    async function refreshThread(quiet = false) {
      if (quiet && document.visibilityState === "hidden") return;
      try {
        const data = await readApi<{ messages: Message[]; hasMore: boolean; lastInboundAt?: string | null }>(await fetch(`/api/whatsapp/messages?conversationId=${encodeURIComponent(selectedContact)}`, { cache: "no-store" }));
        if (!alive) return;
        setThread((current) => quiet
          ? [...new Map([...current, ...data.messages].map((message) => [message._id, message])).values()].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
          : data.messages);
        if (!quiet) setHasMore(data.hasMore);
        setLastInboundAt(data.lastInboundAt);
        setThreadError("");
      } catch (error) {
        if (alive) setThreadError(error instanceof Error ? error.message : "Messages could not be loaded.");
      } finally {
        if (alive) setLoadingThread(false);
      }
    }
    void refreshThread();
    const timer = window.setInterval(() => void refreshThread(true), 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [selectedContact, threadReload]);

  const contactById = useMemo(() => new Map(contacts.map((contact) => [String(contact._id), contact])), [contacts]);
  const lastMessageById = useMemo(() => {
    const result = new Map<string, Message>();
    for (const item of conversations) if (item.conversationId && item.lastMessage) result.set(item.conversationId, item.lastMessage);
    for (const item of recentMessages) {
      const key = messageConversationId(item);
      if (key && (!result.has(key) || new Date(result.get(key)!.occurredAt).getTime() < new Date(item.occurredAt).getTime())) result.set(key, item);
    }
    return result;
  }, [conversations, recentMessages]);
  const chatContacts = useMemo(() => contacts.filter((contact) => lastMessageById.has(String(contact._id)))
    .sort((a, b) => new Date(lastMessageById.get(String(b._id))?.occurredAt || 0).getTime() - new Date(lastMessageById.get(String(a._id))?.occurredAt || 0).getTime()), [contacts, lastMessageById]);
  const displayedContacts = (inboxTab === "chats" ? chatContacts : contacts).filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(search.trim().toLowerCase()));
  const filteredAudience = contacts.filter((contact) => !contact.unlinked && `${contact.name} ${contact.phone}`.toLowerCase().includes(audienceSearch.trim().toLowerCase()));
  const selected = contactById.get(selectedContact);
  const latestInbound = [...thread].reverse().find((message) => message.direction === "inbound");
  const lastInboundTime = lastInboundAt !== undefined ? lastInboundAt : latestInbound?.occurredAt;
  const replyWindowEnds = lastInboundTime ? new Date(lastInboundTime).getTime() + 24 * 60 * 60 * 1000 : 0;
  const canReply = replyWindowEnds > now;
  const optedInSelected = checked.filter((id) => contacts.find((contact) => String(contact._id) === id)?.whatsappOptIn);
  const oneTemplate = templates.find((item) => item.name === selectedOneTemplate);
  const campaignTemplate = templates.find((item) => item.name === selectedTemplate);
  const lastThreadId = thread.at(-1)?._id;

  useEffect(() => { if (lastThreadId) messagesEndRef.current?.scrollIntoView({ block: "end" }); }, [selectedContact, lastThreadId]);

  function selectConversation(id: string) {
    setSelectedContact(id); setMobileThreadOpen(true); setShowTemplateComposer(false); setReply(""); setTemplateValues([]); setAttachment(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  function chooseAttachment(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setNotice("Choose a JPEG or PNG image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setNotice("Choose an image smaller than 5 MB.");
      return;
    }
    setAttachment(file);
    setNotice("");
  }

  async function loadEarlier() {
    if (!thread.length || !hasMore || loadingEarlier) return;
    setLoadingEarlier(true); setThreadError("");
    const currentConversation = selectedContact;
    try {
      const data = await readApi<{ messages: Message[]; hasMore: boolean }>(await fetch(`/api/whatsapp/messages?conversationId=${encodeURIComponent(currentConversation)}&before=${encodeURIComponent(thread[0].occurredAt)}`, { cache: "no-store" }));
      if (activeConversationRef.current !== currentConversation) return;
      setThread((current) => [...new Map([...data.messages, ...current].map((message) => [message._id, message])).values()].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()));
      setHasMore(data.hasMore);
    } catch (error) { setThreadError(error instanceof Error ? error.message : "Older messages could not be loaded."); }
    finally { setLoadingEarlier(false); }
  }

  function toggle(id: string) { setChecked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  async function recordConsent(optedIn: boolean) {
    if (!checked.length) return setNotice("Select at least one student first.");
    setBusy(true); setNotice("");
    try {
      const data = await readApi<{ updated: number }>(await fetch("/api/whatsapp/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds: checked, optedIn, source: optedIn ? "Recorded by staff in CRM" : "Student opted out" }) }));
      setNotice(`${data.updated} student consent record(s) updated.`); setChecked([]); await refreshInbox();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Consent could not be updated."); }
    finally { setBusy(false); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if ((!reply.trim() && !attachment) || !selectedContact || !canReply) return;
    const conversationId = selectedContact;
    setBusy(true); setNotice("");
    try {
      let response: Response;
      if (attachment) {
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("image", attachment);
        if (reply.trim()) form.set("caption", reply.trim());
        response = await fetch("/api/whatsapp/media", { method: "POST", body: form });
      } else {
        response = await fetch("/api/whatsapp/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(conversationId.startsWith("wa:") ? { waId: conversationId.slice(3), text: reply.trim() } : { leadId: conversationId, text: reply.trim() }) });
      }
      const data = await readApi<{ message?: Message; accepted?: boolean; error?: string }>(response);
      setReply("");
      setAttachment(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      const sentMessage = data.message;
      if (sentMessage && activeConversationRef.current === conversationId) setThread((current) => [...current.filter((message) => message._id !== sentMessage._id), sentMessage]);
      if (data.accepted && data.error) setNotice(data.error);
      await refreshInbox(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Message could not be sent."); }
    finally { setBusy(false); }
  }

  async function sendTemplate(event: FormEvent) {
    event.preventDefault();
    if (!selected || selected.unlinked || !oneTemplate) return;
    setBusy(true); setNotice("");
    const params = Array.from({ length: oneTemplate.parameterCount }, (_, index) => index === 0 ? selected.name : (templateValues[index] || "").trim());
    try {
      const data = await readApi<{ message?: Message; accepted?: boolean; error?: string }>(await fetch("/api/whatsapp/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: selected._id, templateName: oneTemplate.name, language: oneTemplate.language, bodyParameters: params }) }));
      const sentMessage = data.message;
      if (sentMessage) setThread((current) => [...current.filter((message) => message._id !== sentMessage._id), sentMessage]);
      setShowTemplateComposer(false);
      setNotice(data.accepted && data.error ? data.error : "Approved template submitted to Meta. Watch the message status for delivery.");
      await refreshInbox(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Template could not be sent."); }
    finally { setBusy(false); }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!optedInSelected.length) return setNotice("Select students with recorded WhatsApp opt-in.");
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice("");
    const bodyParameters = Array.from({ length: campaignTemplate?.parameterCount || 0 }, (_, index) => index === 0 ? "{{name}}" : String(form.get(`parameter${index + 1}`) || ""));
    try {
      const data = await readApi<{ campaign: { _id: string; total: number } }>(await fetch("/api/whatsapp/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), templateName: selectedTemplate, language: campaignTemplate?.language || "en_US", leadIds: optedInSelected, bodyParameters }) }));
      let done = false; let progress = { sent: 0, failed: 0, total: data.campaign.total };
      while (!done) {
        const result = await readApi<{ done: boolean; sent: number; failed: number; total: number }>(await fetch("/api/whatsapp/campaigns/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: data.campaign._id }) }));
        done = result.done; progress = result; setNotice(`Sending: ${result.sent + result.failed}/${result.total}`);
      }
      setChecked([]); setNotice(`Campaign submitted: ${progress.sent} accepted by Meta, ${progress.failed} rejected immediately. Delivery receipts may take a moment.`);
      await refreshInbox(true); await refreshMetadata();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Campaign paused."); }
    finally { setBusy(false); }
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
    try {
      const data = await readApi<{ total: number; created: number; matched: number; leadIds: string[] }>(await fetch("/api/whatsapp/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: parsed, consentConfirmed: true, consentSource: "Bulk campaign list confirmed by administrator" }) }));
      await refreshInbox(); setChecked(data.leadIds || []); setShowImport(false); setImportText(""); setConsentConfirmed(false);
      setNotice(`${data.total} contacts ready and selected: ${data.created} new, ${data.matched} matched existing CRM records.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Contacts could not be imported."); }
    finally { setBusy(false); }
  }

  return <div className="wa-page">
    {!configured && !loadingInbox && !inboxError && <div className="wa-warning"><ShieldCheck size={20}/><span><strong>WhatsApp API setup required</strong><small>Add Meta credentials in Vercel to send messages. Existing conversation history remains available here.</small></span></div>}
    {notice && <div className="wa-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={16}/></button></div>}
    <section className={`panel wa-inbox ${mobileThreadOpen ? "wa-show-thread" : ""}`} aria-label="WhatsApp inbox">
      <div className="wa-contacts">
        <div className="wa-section-head"><span><strong>WhatsApp inbox</strong><small>{chatContacts.length} conversations · {contacts.filter((contact) => !contact.unlinked).length} contacts</small></span><button type="button" onClick={() => void refreshInbox()} disabled={refreshing} aria-label="Refresh inbox" title="Refresh inbox"><RefreshCw size={17} className={refreshing ? "wa-spinning" : ""}/></button></div>
        <div className="wa-tabs" role="tablist" aria-label="Inbox view"><button type="button" role="tab" aria-selected={inboxTab === "chats"} className={inboxTab === "chats" ? "active" : ""} onClick={() => setInboxTab("chats")}>Chats <span>{chatContacts.length}</span></button><button type="button" role="tab" aria-selected={inboxTab === "contacts"} className={inboxTab === "contacts" ? "active" : ""} onClick={() => setInboxTab("contacts")}>All contacts</button></div>
        <label className="wa-search"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone" aria-label="Search WhatsApp contacts"/>{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={15}/></button>}</label>
        <div className="wa-contact-list">
          {loadingInbox ? <div className="wa-list-state"><Loader2 className="wa-spinning" size={22}/><span>Loading conversations…</span></div>
            : inboxError ? <div className="wa-list-state error"><AlertCircle size={22}/><span>{inboxError}</span><button type="button" onClick={() => void refreshInbox()}>Try again</button></div>
            : displayedContacts.length ? displayedContacts.map((contact) => {
              const last = lastMessageById.get(String(contact._id));
              return <button type="button" className={`wa-contact-row ${selectedContact === String(contact._id) ? "active" : ""}`} key={contact._id} onClick={() => selectConversation(String(contact._id))}>
                <span className="wa-avatar">{contact.name?.trim().slice(0, 1).toUpperCase() || "?"}</span>
                <span className="wa-contact-text"><strong>{contact.name || contact.phone}</strong><small>{last ? `${last.direction === "outbound" ? "You: " : ""}${last.body || `[${last.type || "message"}]`}` : contact.phone}</small></span>
                <span className="wa-contact-side"><time>{timeLabel(last?.occurredAt)}</time>{contact.unlinked ? <em>New</em> : contact.whatsappOptIn ? <Check size={14} aria-label="Opted in"/> : null}</span>
              </button>;
            }) : <div className="wa-list-state"><MessageCircle size={25}/><span>{search ? "No matches for this search." : inboxTab === "chats" ? "No conversations yet. Open a contact to view their chat." : "No CRM contacts found."}</span>{inboxTab === "chats" && !search && <button type="button" onClick={() => setInboxTab("contacts")}>Browse contacts</button>}</div>}
        </div>
        {lastUpdated && !inboxError && <div className="wa-sync-note">Updated {timeLabel(lastUpdated.toISOString(), true)} · refreshes automatically</div>}
      </div>

      <div className="wa-thread">
        {selected ? <>
          <div className="wa-thread-head"><button type="button" className="wa-back" onClick={() => setMobileThreadOpen(false)} aria-label="Back to conversations"><ArrowLeft size={20}/></button><span className="wa-avatar">{selected.name?.trim().slice(0, 1).toUpperCase() || "?"}</span><span className="wa-thread-identity"><strong>{selected.name || selected.phone}</strong><small>{selected.phone}{selected.unlinked ? " · Not in CRM" : ""}</small></span>{configured && !selected.unlinked && <button type="button" className="wa-template-action" onClick={() => setShowTemplateComposer((current) => !current)}>{showTemplateComposer ? "Close template" : "Send template"}</button>}</div>
          <div className="wa-messages" aria-live="polite">
            {hasMore && <button type="button" className="wa-load-earlier" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{loadingEarlier ? <Loader2 className="wa-spinning" size={14}/> : <ChevronDown size={14}/>} Load earlier messages</button>}
            {loadingThread ? <div className="wa-thread-state"><Loader2 className="wa-spinning" size={25}/><strong>Loading messages…</strong></div>
              : threadError && !thread.length ? <div className="wa-thread-state error"><AlertCircle size={25}/><strong>Could not load this chat</strong><span>{threadError}</span><button type="button" onClick={() => setThreadReload((current) => current + 1)}>Try again</button></div>
              : !thread.length ? <div className="wa-thread-state"><MessageCircle size={30}/><strong>No messages yet</strong><span>{selected.unlinked ? "Incoming messages from this number will appear here." : "Messages from this student will appear here once they contact your WhatsApp number."}</span></div>
              : thread.map((message) => <div key={message._id} className={`wa-bubble ${message.direction} ${message.status === "failed" ? "failed" : ""}`}><MessageBody message={message}/><small><time>{timeLabel(message.occurredAt, true)}</time>{message.direction === "outbound" && <span>{statusLabel(message.status)}</span>}</small>{message.error && <em>{message.error}</em>}</div>)}
            {threadError && !!thread.length && <div className="wa-thread-inline-error"><AlertCircle size={14}/> {threadError}</div>}
            <div ref={messagesEndRef}/>
          </div>
          {showTemplateComposer && !selected.unlinked && <form className="wa-single-template" onSubmit={sendTemplate}><div><strong>Send an approved template</strong><small>Use this when the 24-hour reply window is closed. The student must have opted in.</small></div>{templateError && <div className="wa-template-error"><AlertCircle size={15}/><span>{templateError}</span><button type="button" onClick={() => void refreshMetadata()}>Retry</button></div>}{!templateError && !templates.length && <small className="wa-template-hint">No approved Meta templates are available yet.</small>}<label>Meta template<select required value={selectedOneTemplate} onChange={(event) => { setSelectedOneTemplate(event.target.value); setTemplateValues([]); }}><option value="">Select a template</option>{templates.map((template) => <option key={`${template.name}-${template.language}`} value={template.name}>{template.name} · {template.language}</option>)}</select></label>{oneTemplate?.body && <p className="wa-template-preview">{oneTemplate.body.replace(/\{\{1\}\}/g, selected.name)}</p>}{oneTemplate && oneTemplate.parameterCount > 0 && <small className="wa-template-hint">{"{{1}}"} uses {selected.name} automatically.</small>}{Array.from({ length: Math.max(0, (oneTemplate?.parameterCount || 0) - 1) }, (_, index) => <label key={index}>Value for {`{{${index + 2}}}`}<input required value={templateValues[index + 1] || ""} onChange={(event) => setTemplateValues((current) => { const next = [...current]; next[index + 1] = event.target.value; return next; })}/></label>)}<button type="submit" className="primary" disabled={busy || !configured || !selected.whatsappOptIn || !oneTemplate}>{busy ? "Sending…" : "Send template"}</button>{!selected.whatsappOptIn && <small className="wa-consent-reminder">Record this student&apos;s WhatsApp opt-in before sending a template.</small>}</form>}
          {!showTemplateComposer && <div className={`wa-reply-area ${canReply ? "" : "closed"}`}>
            {!canReply && <div className="wa-window-notice"><Clock3 size={16}/><span>{lastInboundTime ? "The 24-hour reply window has closed." : "A student must message first to open the 24-hour reply window."} {!selected.unlinked ? "Send an approved template to start a conversation." : ""}</span>{!selected.unlinked && <button type="button" onClick={() => setShowTemplateComposer(true)}>Choose template</button>}</div>}
            {attachment && <div className="wa-attachment-preview"><ImagePlus size={17}/><span>{attachment.name}</span><button type="button" onClick={() => { setAttachment(null); if (attachmentInputRef.current) attachmentInputRef.current.value = ""; }} aria-label="Remove attached image"><X size={16}/></button></div>}
            <form className="wa-reply" onSubmit={sendReply}><input ref={attachmentInputRef} type="file" accept="image/jpeg,image/png" className="wa-file-input" aria-label="Choose WhatsApp image" onChange={(event) => chooseAttachment(event.target.files?.[0])}/><button type="button" className="wa-attach" onClick={() => attachmentInputRef.current?.click()} disabled={!canReply || !configured || busy} aria-label="Attach image" title="Attach JPEG or PNG image"><ImagePlus size={19}/></button><textarea rows={1} value={reply} maxLength={attachment ? 1024 : 4096} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={canReply ? attachment ? "Add a caption (optional)…" : "Write a WhatsApp message…" : "Reply window closed"} aria-label="WhatsApp message" disabled={!canReply || !configured || busy}/><button type="submit" className="primary" disabled={busy || !configured || !canReply || (!reply.trim() && !attachment)} aria-label="Send WhatsApp message"><Send size={17}/><span>Send</span></button></form>
          </div>}
        </> : <div className="wa-thread-state wa-thread-placeholder"><MessageCircle size={38}/><strong>Select a conversation</strong><span>Choose a chat or search your CRM contacts to open their WhatsApp history.</span></div>}
      </div>
    </section>

    {superAdmin && <details className="panel wa-setup"><summary><ShieldCheck size={18}/> WhatsApp connection health</summary><div className="wa-setup-content">
      {setupError && <p className="wa-template-error" role="alert"><AlertCircle size={16}/>{setupError}</p>}
      {!setup && !setupError && <p>Checking Meta connection…</p>}
      {setup && <>
        <p><strong>Phone:</strong> {setup.phoneMatches ? "Connected to the configured business account" : "Phone number does not belong to the configured business account"}</p>
        <p><strong>Meta app subscriptions:</strong> {setup.subscribedApps.length ? setup.subscribedApps.map((app) => app.name || app.id).join(", ") : "None yet"}</p>
        <p><strong>Approved templates:</strong> {setup.templateCount}</p>
        {Object.entries(setup.errors).map(([key, value]) => value && <p className="wa-setup-error" key={key}>{key}: {value}</p>)}
        {!setup.phoneMatches && <p className="wa-setup-error">Check WHATSAPP_BUSINESS_ACCOUNT_ID in Vercel before subscribing. The configured phone and account must match.</p>}
      </>}
      <div className="wa-setup-actions"><button type="button" className="secondary" onClick={() => void refreshSetup()} disabled={setupBusy}>Refresh status</button><button type="button" className="primary" onClick={() => void connectWebhook()} disabled={setupBusy || !setup?.phoneMatches}>{setupBusy ? "Connecting…" : "Connect incoming messages"}</button></div>
    </div></details>}

    {privileged && <section className="panel wa-campaign">
      <div className="task-toolbar"><span><h2>Bulk WhatsApp campaign</h2><p>Import a name and phone list or select existing opted-in CRM contacts.</p></span><button className="primary" type="button" onClick={() => setShowImport(true)}><Upload size={15}/> Import contacts</button></div>
      {showImport && <div className="wa-import"><header><span><strong>Bulk import campaign contacts</strong><small>CSV columns or pasted lines: Name, Phone</small></span><button type="button" onClick={() => setShowImport(false)} aria-label="Close import"><X size={16}/></button></header><div><label>Paste name and phone<textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={"Name, Phone\nAayush Shrestha, 9841280991\nSita Rai, 9800000000"}/></label><label className="wa-file"><Upload size={18}/><span>Upload CSV file<small>The first two columns must be Name and Phone.</small></span><input type="file" accept=".csv,text/csv,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setImportText); }}/></label></div><label className="wa-consent"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)}/><span>I confirm these students agreed to receive WhatsApp messages from AIMS Global. The CRM will store this consent source.</span></label><footer><span>{parseImport().length} valid row(s) detected</span><button type="button" className="primary" disabled={busy || !consentConfirmed || !parseImport().length} onClick={() => void importContacts()}>{busy ? "Importing…" : "Import and select students"}</button></footer></div>}
      {templateError && <div className="wa-template-error" role="alert"><AlertCircle size={16}/><span>Approved templates could not load: {templateError}</span><button type="button" onClick={() => void refreshMetadata()}>Retry</button></div>}
      <div className="wa-campaign-grid">
        <div className="wa-audience"><label className="wa-search"><Search size={16}/><input value={audienceSearch} onChange={(event) => setAudienceSearch(event.target.value)} placeholder="Filter students" aria-label="Filter campaign students"/></label><div>{filteredAudience.map((contact) => <label key={contact._id}><input type="checkbox" checked={checked.includes(String(contact._id))} onChange={() => toggle(String(contact._id))}/><span><strong>{contact.name}</strong><small>{contact.phone}</small></span><em className={contact.whatsappOptIn ? "yes" : "no"}>{contact.whatsappOptIn ? "Opted in" : "No consent"}</em></label>)}{!filteredAudience.length && <div className="empty compact">No students found.</div>}</div><footer><button type="button" className="secondary" disabled={busy} onClick={() => void recordConsent(true)}>Record opt-in</button><button type="button" className="secondary" disabled={busy} onClick={() => void recordConsent(false)}>Opt out</button></footer></div>
        <form className="wa-campaign-form" onSubmit={createCampaign}><label>Campaign name<input required name="name" placeholder="WhatsApp test campaign"/></label><label>Approved Meta template<select required value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}><option value="">Select approved template</option>{templates.map((template) => <option key={`${template.name}-${template.language}`} value={template.name}>{template.name} · {template.category} · {template.language}</option>)}</select></label>{campaignTemplate?.body && <p className="wa-template-preview">{campaignTemplate.body}</p>}{Array.from({ length: Math.max(0, (campaignTemplate?.parameterCount || 0) - 1) }, (_, index) => <label key={index}>Template value {index + 2}<input required name={`parameter${index + 2}`} placeholder={`Value for {{${index + 2}}}`}/></label>)}{(campaignTemplate?.parameterCount || 0) > 0 && <small>Variable {"{{1}}"} uses each selected student&apos;s CRM name automatically.</small>}<div className="wa-estimate"><strong>{optedInSelected.length} recipients selected</strong><span>Estimated Meta marketing fee: ≈ NPR {(optedInSelected.length * 13.87).toLocaleString("en-NP", { maximumFractionDigits: 0 })}</span><small>Estimate only; Meta bills by recipient country and delivered message.</small></div><button className="primary" disabled={busy || !configured || !optedInSelected.length || !selectedTemplate}><Send size={16}/>{busy ? "Sending…" : "Create and send campaign"}</button></form>
      </div>
      {!!campaigns.length && <div className="wa-campaign-history"><h3>Recent campaigns</h3>{campaigns.map((campaign) => <div key={campaign._id}><span><strong>{campaign.name}</strong><small>{timeLabel(campaign.createdAt, true)}{campaign.lastDeliveryError ? ` · ${campaign.lastDeliveryError}` : ""}</small></span><b>{campaign.status}</b><em>{campaign.accepted ?? campaign.sent}/{campaign.total} Meta accepted · {campaign.delivered ?? 0} delivered · {(campaign.deliveryFailed ?? 0) + campaign.failed} failed</em></div>)}</div>}
    </section>}
  </div>;
}
