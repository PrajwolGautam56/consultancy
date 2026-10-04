"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Camera, Link2, MessageCircle, MessagesSquare, RefreshCw, Search, Send, ShieldCheck } from "lucide-react";

type Account = { _id: string; pageId: string; pageName: string; instagramAccountId?: string; instagramUsername?: string; instagramName?: string; instagramAvatar?: string; subscribed: boolean; subscriptionError?: string };
type Conversation = {
  _id: string; platform: "facebook" | "instagram"; participantId: string; participantName: string; participantAvatar?: string;
  lastMessage?: string; lastMessageAt?: string; lastInboundAt?: string; unreadCount: number;
  accountId: { _id: string; pageId: string; pageName: string; instagramAccountId?: string; instagramUsername?: string };
};
type Message = { _id: string; direction: "inbound" | "outbound"; text?: string; attachments?: Array<{ type: string; url: string }>; status: string; occurredAt: string };

async function readApi<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function timeLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value); const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("en-NP", sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(date);
}

export default function MetaInboxView({ privileged }: { privileged: boolean }) {
  const [configured, setConfigured] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [platform, setPlatform] = useState<"all" | "facebook" | "instagram">("all");
  const [accountId, setAccountId] = useState("all");
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [status, inbox] = await Promise.all([
        readApi<{ configured: boolean; accounts: Account[] }>(await fetch("/api/meta/status", { cache: "no-store" })),
        readApi<{ conversations: Conversation[] }>(await fetch("/api/meta/messages", { cache: "no-store" })),
      ]);
      setConfigured(status.configured); setAccounts(status.accounts || []); setConversations(inbox.conversations || []); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Social inbox could not load"); }
  }, []);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 20_000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [load]);
  const selected = conversations.find((item) => item._id === selectedId);
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    void fetch(`/api/meta/messages?conversationId=${encodeURIComponent(selectedId)}`, { cache: "no-store" }).then((response) => readApi<{ messages: Message[] }>(response))
      .then((result) => { if (alive) { setMessages(result.messages || []); setConversations((current) => current.map((item) => item._id === selectedId ? { ...item, unreadCount: 0 } : item)); } })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Conversation could not load"); });
    return () => { alive = false; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) =>
      (platform === "all" || conversation.platform === platform) &&
      (accountId === "all" || conversation.accountId?._id === accountId) &&
      (!query || `${conversation.participantName} ${conversation.lastMessage || ""} ${conversation.accountId?.pageName || ""}`.toLowerCase().includes(query))
    );
  }, [accountId, conversations, platform, search]);

  async function syncHistory() {
    setBusy(true); setError(""); setNotice("Syncing recent conversations…");
    try {
      const result = await readApi<{ imported: number; errors: string[] }>(await fetch("/api/meta/sync", { method: "POST" }));
      setNotice(`Sync complete: ${result.imported} messages checked.${result.errors.length ? ` ${result.errors[0]}` : ""}`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sync failed"); setNotice(""); }
    finally { setBusy(false); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!selected || !reply.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await readApi<{ message: Message }>(await fetch("/api/meta/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selected._id, text: reply.trim() }) }));
      setMessages((current) => [...current, result.message]); setReply(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Reply failed"); }
    finally { setBusy(false); }
  }

  const replyOpen = Boolean(selected?.lastInboundAt && now - new Date(selected.lastInboundAt).getTime() <= 24 * 60 * 60 * 1000);

  return <div className="meta-inbox-page">
    <div className="meta-title-row"><div><span className="eyebrow">SOCIAL MESSAGING</span><h2>Facebook & Instagram inbox</h2><p>Manage every connected Page and professional Instagram account in one place.</p></div><div className="meta-title-actions">{privileged && <button className="secondary" disabled={busy || !accounts.length} onClick={() => void syncHistory()}><RefreshCw className={busy ? "meta-spin" : ""} size={16}/> Sync messages</button>}{privileged && <button className="primary" disabled={!configured} onClick={() => window.location.assign("/api/meta/connect")}><Link2 size={16}/>{accounts.length ? "Connect more Pages" : "Connect Facebook & Instagram"}</button>}</div></div>
    {!configured && <div className="meta-alert warning"><ShieldCheck size={18}/><span><strong>Meta connection setup required.</strong> Add the Meta App ID, secret and webhook verify token in Vercel first.</span></div>}
    {error && <div className="meta-alert error"><AlertCircle size={18}/>{error}</div>}
    {notice && <div className="meta-alert success">{notice}</div>}
    {!!accounts.length && <div className="meta-account-strip">{accounts.map((account) => <article key={account._id}><span className="meta-account-icon"><MessageCircle size={17}/></span><span><strong>{account.pageName}</strong><small>{account.instagramUsername ? `@${account.instagramUsername} connected` : "Facebook Page"}</small></span><em className={account.subscribed ? "connected" : "issue"}>{account.subscribed ? "Live" : "Needs webhook"}</em></article>)}</div>}
    <section className="panel meta-inbox-shell">
      <aside className="meta-conversations">
        <header><span><strong>Inbox</strong><small>{filtered.length} conversation{filtered.length === 1 ? "" : "s"}</small></span><button onClick={() => void load()} aria-label="Refresh"><RefreshCw size={16}/></button></header>
        <div className="meta-channel-tabs"><button className={platform === "all" ? "active" : ""} onClick={() => setPlatform("all")}><MessagesSquare size={16}/>All</button><button className={platform === "facebook" ? "active" : ""} onClick={() => setPlatform("facebook")}><MessageCircle size={16}/>Facebook</button><button className={platform === "instagram" ? "active" : ""} onClick={() => setPlatform("instagram")}><Camera size={16}/>Instagram</button></div>
        <select className="meta-account-filter" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="all">All connected Pages</option>{accounts.map((account) => <option key={account._id} value={account._id}>{account.pageName}</option>)}</select>
        <label className="meta-search"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations"/></label>
        <div className="meta-conversation-list">{filtered.map((conversation) => <button key={conversation._id} className={selectedId === conversation._id ? "active" : ""} onClick={() => { setMessages([]); setSelectedId(conversation._id); }}><span className={`meta-avatar ${conversation.platform}`}>{conversation.participantAvatar ? <img src={conversation.participantAvatar} alt=""/> : conversation.participantName.slice(0, 1).toUpperCase()}</span><span><strong>{conversation.participantName}</strong><small>{conversation.lastMessage || "Message"}</small><em>{conversation.accountId?.pageName}</em></span><time>{timeLabel(conversation.lastMessageAt)}</time>{conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}</button>)}{!filtered.length && <div className="empty compact">{accounts.length ? "No messages found. Sync history or wait for a new message." : "Connect a Facebook Page to begin."}</div>}</div>
      </aside>
      <div className="meta-thread">{selected ? <><header><button className="meta-back" onClick={() => setSelectedId("")} aria-label="Back to conversations"><ArrowLeft size={18}/></button><span className={`meta-avatar ${selected.platform}`}>{selected.participantName.slice(0, 1).toUpperCase()}</span><span><strong>{selected.participantName}</strong><small>{selected.platform === "facebook" ? "Facebook Messenger" : "Instagram Direct"} · {selected.accountId?.pageName}</small></span></header><div className="meta-message-list">{messages.map((message) => <article key={message._id} className={message.direction}><p>{message.text || `[${message.attachments?.[0]?.type || "attachment"}]`}</p>{message.attachments?.map((attachment, index) => attachment.url && attachment.type?.startsWith("image") ? <img key={index} src={attachment.url} alt="Attachment"/> : null)}<small>{timeLabel(message.occurredAt)}{message.direction === "outbound" ? ` · ${message.status}` : ""}</small></article>)}{!messages.length && <div className="empty">No messages in this conversation.</div>}</div><form className="meta-reply" onSubmit={sendReply}>{!replyOpen && <span><AlertCircle size={15}/>The 24-hour reply window is closed.</span>}<textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={replyOpen ? "Write a reply…" : "Reply window closed"} disabled={!replyOpen || busy} maxLength={1000}/><button className="primary" disabled={!replyOpen || busy || !reply.trim()}><Send size={16}/>{busy ? "Sending…" : "Send"}</button></form></> : <div className="meta-thread-empty"><MessagesSquare size={40}/><strong>Select a conversation</strong><span>Facebook and Instagram messages will appear together here.</span></div>}</div>
    </section>
  </div>;
}
