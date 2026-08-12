"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  ExternalLink,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Mail,
  Menu,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  UserCheck,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";

type Stage =
  | "New inquiry"
  | "Contacted"
  | "Counselling"
  | "Application"
  | "Enrolled"
  | "Lost";
type Activity = {
  type: string;
  text: string;
  authorName: string;
  occurredAt: string;
};
type VisitRecord = {
  id: string;
  leadId: string;
  name: string;
  phone: string;
  email?: string;
  country?: string;
  course?: string;
  counsellor?: string;
  inOffice?: boolean;
  checkedInAt: string;
  checkedInBy: string;
};
type WorkTask = {
  _id: string;
  title: string;
  description: string;
  status: "To do" | "In progress" | "Blocked" | "Completed";
  priority: "Low" | "Medium" | "High" | "Urgent";
  progress: number;
  dueAt: string;
  links: string[];
  assignees: { userId: string; name: string; email: string }[];
  createdBy: string;
  createdByName: string;
  comments: {
    _id?: string;
    text: string;
    authorName: string;
    createdAt: string;
  }[];
  updatedAt: string;
};
type Lead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  education: string;
  passedOutInstitute: string;
  country: string;
  course: string;
  university: string;
  source: string;
  stage: Stage;
  counsellor: string;
  updated: string;
  assignedTo?: string | null;
  nextFollowUp: string;
  nextFollowUpISO?: string | null;
  followUpAssignedTo?: string | null;
  followUpAssignee: string;
  priority: "High" | "Medium" | "Low";
  tags: string[];
  inOffice?: boolean;
  activities?: Activity[];
};

const nav = [
  ["Dashboard", LayoutDashboard],
  ["Leads & students", Users],
  ["Office visitors", UserCheck],
  ["Tasks", ListTodo],
  ["Follow-ups", CalendarClock],
  ["Team", CircleUserRound],
  ["Settings", Settings],
] as const;
type CurrentUser = {
  userId: string;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "manager" | "counsellor" | "receptionist";
};

const stageStyle: Record<Stage, string> = {
  "New inquiry": "blue",
  Contacted: "violet",
  Counselling: "amber",
  Application: "cyan",
  Enrolled: "green",
  Lost: "slate",
};
const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function Avatar({ name, warm = false }: { name: string; warm?: boolean }) {
  return (
    <span className={`avatar ${warm ? "warm" : ""}`}>
      {name
        .split(" ")
        .map((x) => x[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}

function mapLead(raw: Record<string, unknown>): Lead {
  const date = (value: unknown) =>
    value
      ? new Intl.DateTimeFormat("en-NP", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(String(value)))
      : "Not scheduled";
  return {
    id: String(raw._id),
    name: String(raw.name || ""),
    phone: String(raw.phone || ""),
    email: String(raw.email || ""),
    address: String(raw.address || ""),
    education: String(raw.education || ""),
    passedOutInstitute: String(raw.passedOutInstitute || ""),
    country: String(raw.country || ""),
    course: String(raw.course || ""),
    university: String(raw.university || ""),
    source: String(raw.source || "Other"),
    stage: (raw.stage || "New inquiry") as Stage,
    counsellor: String(raw.counsellor || "Unassigned"),
    assignedTo: raw.assignedTo ? String(raw.assignedTo) : null,
    updated: raw.updatedAt ? date(raw.updatedAt) : "Just now",
    nextFollowUp: date(raw.nextFollowUp),
    nextFollowUpISO: raw.nextFollowUp ? String(raw.nextFollowUp) : undefined,
    followUpAssignedTo: raw.followUpAssignedTo
      ? String(raw.followUpAssignedTo)
      : null,
    followUpAssignee: String(raw.followUpAssignee || ""),
    priority: (raw.priority || "Medium") as Lead["priority"],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    inOffice: Boolean(raw.inOffice),
    activities: (raw.activities || []) as Activity[],
  };
}

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [active, setActive] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState("");
  const [stageFilter, setStageFilter] = useState("All stages");
  const [counsellorFilter, setCounsellorFilter] = useState("All counsellors");
  const [tagFilter, setTagFilter] = useState("All tags");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [staffCounsellors, setStaffCounsellors] = useState<TeamMember[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [todayVisits, setTodayVisits] = useState<VisitRecord[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/leads")
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Could not load contacts");
        setLeads((data.leads || []).map(mapLead));
      })
      .catch((error) => setAppError(error.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    let active = true;
    const checkSession = () =>
      fetch("/api/auth/me")
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const data = await response.json();
          if (active) setCurrentUser(data.user);
        })
        .catch(() => {
          if (active) window.location.replace("/login?reason=session-ended");
        });
    checkSession();
    const interval = window.setInterval(checkSession, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkSession();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    fetch("/api/users?directory=1")
      .then(async (response) => (response.ok ? response.json() : { users: [] }))
      .then((data) =>
        setStaffCounsellors(
          (data.users || []).filter(
            (user: TeamMember) =>
              user.active &&
              ["super_admin", "admin", "manager", "counsellor"].includes(
                user.role,
              ),
          ),
        ),
      )
      .catch(() => setStaffCounsellors([]));
  }, []);
  async function refreshTodayVisits() {
    try {
      const response = await fetch(`/api/visits?date=${localDateKey()}`);
      const data = await response.json();
      setTodayVisits(response.ok ? data.visits || [] : []);
    } catch {
      setTodayVisits([]);
    }
  }
  useEffect(() => {
    fetch(`/api/visits?date=${localDateKey()}`)
      .then(async (response) => ({
        ok: response.ok,
        data: await response.json(),
      }))
      .then(({ ok, data }) => setTodayVisits(ok ? data.visits || [] : []))
      .catch(() => setTodayVisits([]));
  }, []);

  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          `${l.name} ${l.phone} ${l.email} ${l.country} ${l.course} ${l.passedOutInstitute} ${l.tags.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (stageFilter === "All stages" || l.stage === stageFilter) &&
          (counsellorFilter === "All counsellors" ||
            l.counsellor === counsellorFilter) &&
          (tagFilter === "All tags" || l.tags.includes(tagFilter)),
      ),
    [leads, query, stageFilter, counsellorFilter, tagFilter],
  );
  const office = leads.filter((l) => l.inOffice);
  const counsellors = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...staffCounsellors.map((member) => member.name),
            ...leads.map((l) => l.counsellor),
          ].filter((name) => name && name !== "Unassigned"),
        ),
      ).sort(),
    [leads, staffCounsellors],
  );
  const allTags = useMemo(
    () =>
      Array.from(new Set(leads.flatMap((l) => l.tags))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [leads],
  );
  const allInstitutes = useMemo(
    () =>
      Array.from(
        new Set(leads.map((l) => l.passedOutInstitute.trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [leads],
  );
  const dueFollowUps = leads.filter((l) => l.nextFollowUpISO);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  function openLeadForm() {
    setAppError("");
    setShowNew(true);
  }

  async function addLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload = Object.fromEntries(data.entries());
    setAppError("");
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      setAppError(result.error || "Could not create lead");
      return;
    }
    setLeads([mapLead(result.lead), ...leads]);
    setShowNew(false);
    setActive("Leads & students");
  }

  async function persistLead(
    changed: Lead,
    activity?: { type: string; text: string },
  ) {
    const previous = leads.find((l) => l.id === changed.id);
    setLeads(leads.map((l) => (l.id === changed.id ? changed : l)));
    setSelected(changed);
    setAppError("");
    const role = currentUser?.role;
    const fields: Record<string, unknown> =
      role === "receptionist"
        ? { inOffice: Boolean(changed.inOffice), tags: changed.tags }
        : {
            name: changed.name,
            phone: changed.phone,
            email: changed.email,
            address: changed.address,
            education: changed.education,
            passedOutInstitute: changed.passedOutInstitute,
            country: changed.country,
            course: changed.course,
            university: changed.university,
            tags: changed.tags,
            source: changed.source,
            stage: changed.stage,
            priority: changed.priority,
            inOffice: Boolean(changed.inOffice),
            followUpAssignedTo: changed.followUpAssignedTo || null,
            followUpAssignee: changed.followUpAssignee,
            ...(changed.nextFollowUpISO !== undefined
              ? { nextFollowUp: changed.nextFollowUpISO }
              : {}),
          };
    if (role === "super_admin" || role === "admin") {
      fields.counsellor = changed.counsellor;
      fields.assignedTo = changed.assignedTo || null;
    }
    const response = await fetch(
      `/api/leads/${encodeURIComponent(changed.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, activity }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      if (previous)
        setLeads((current) =>
          current.map((l) => (l.id === changed.id ? previous : l)),
        );
      setAppError(result.error || "Changes could not be saved");
      return;
    }
    const saved = mapLead(result.lead);
    setLeads((current) =>
      current.map((l) => (l.id === changed.id ? saved : l)),
    );
    setSelected(saved);
    if (result.emailStatus === "failed")
      setAppError(
        "Visitor was checked out, but the thank-you email could not be sent.",
      );
  }
  async function deleteLead(lead: Lead) {
    setAppError("");
    const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) {
      setAppError(result.error || "Lead could not be deleted");
      return false;
    }
    setLeads((current) => current.filter((item) => item.id !== lead.id));
    setSelected(null);
    await refreshTodayVisits();
    return true;
  }

  return (
    <main className="app-shell">
      {mobileNav && (
        <button
          className="mobile-overlay"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <span className="brandmark">A</span>
          <span>
            Admitly<small>CONSULTANCY CRM</small>
          </span>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            <X />
          </button>
        </div>
        <nav>
          {nav
            .filter(
              ([label]) =>
                label !== "Team" ||
                ["super_admin", "admin", "manager"].includes(
                  currentUser?.role || "",
                ),
            )
            .map(([label, Icon]) => (
              <button
                key={label}
                className={active === label ? "active" : ""}
                onClick={() => {
                  setActive(label);
                  setMobileNav(false);
                }}
              >
                <Icon size={19} />
                <span>{label}</span>
                {label === "Follow-ups" &&
                  leads.filter((l) => l.nextFollowUpISO).length > 0 && (
                    <b>{leads.filter((l) => l.nextFollowUpISO).length}</b>
                  )}
              </button>
            ))}
        </nav>
        <div className="sidebar-card">
          <Sparkles size={19} />
          <strong>CRM is protected</strong>
          <p>Student records require an authenticated staff session.</p>
          <div>
            <i style={{ width: "100%" }} />
          </div>
        </div>
        <div className="user-card">
          <Avatar name={currentUser?.name || "Staff User"} warm />
          <span>
            <strong>{currentUser?.name || "Loading…"}</strong>
            <small>
              {currentUser ? roleLabel[currentUser.role] : "Checking session…"}
            </small>
          </span>
          <button className="logout-btn" onClick={logout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button
            className="menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu />
          </button>
          <div className="global-search">
            <Search size={18} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, email..."
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="notification-wrap">
            <button
              className="icon-btn"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              aria-label="Notifications"
            >
              <Bell size={20} />
              {dueFollowUps.length > 0 && <i />}
            </button>
            {notificationsOpen && (
              <div className="notification-popover">
                <div>
                  <strong>Follow-up reminders</strong>
                  <button
                    onClick={() => setNotificationsOpen(false)}
                    aria-label="Close notifications"
                  >
                    <X size={15} />
                  </button>
                </div>
                {dueFollowUps.slice(0, 5).map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelected(lead);
                      setNotificationsOpen(false);
                    }}
                  >
                    <CalendarClock size={16} />
                    <span>
                      <strong>{lead.name}</strong>
                      <small>{lead.nextFollowUp}</small>
                    </span>
                  </button>
                ))}
                {dueFollowUps.length === 0 && <p>No scheduled reminders.</p>}
                <button
                  className="view-reminders"
                  onClick={() => {
                    setActive("Follow-ups");
                    setNotificationsOpen(false);
                  }}
                >
                  View all follow-ups
                </button>
              </div>
            )}
          </div>
          <button
            className="primary"
            aria-label="Add new lead"
            onClick={openLeadForm}
          >
            <Plus size={18} /> Add new lead
          </button>
        </header>

        <div className="content">
          {appError && (
            <div className="app-alert">
              <span>{appError}</span>
              <button onClick={() => setAppError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {new Intl.DateTimeFormat("en-NP", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
                  .format(new Date())
                  .toUpperCase()}
              </p>
              <h1>
                {active === "Dashboard" ? "Good morning, Prajwol" : active}
              </h1>
              <p>
                {active === "Dashboard"
                  ? "Here’s what’s happening at your consultancy today."
                  : `Manage your ${active.toLowerCase()} from one place.`}
              </p>
            </div>
            {active === "Leads & students" && (
              <button className="primary" onClick={openLeadForm}>
                <Plus size={18} /> Add new lead
              </button>
            )}
          </div>

          {active === "Dashboard" ? (
            <>
              <div className="stats">
                <Stat
                  icon={<Users />}
                  label="Total active leads"
                  value={
                    loading
                      ? "—"
                      : String(leads.filter((l) => l.stage !== "Lost").length)
                  }
                  trend="Excludes lost enquiries"
                  color="blue"
                />
                <Stat
                  icon={<UserRoundPlus />}
                  label="New inquiries"
                  value={
                    loading
                      ? "—"
                      : String(
                          leads.filter((l) => l.stage === "New inquiry").length,
                        )
                  }
                  trend="Awaiting first contact"
                  color="violet"
                />
                <Stat
                  icon={<UserCheck />}
                  label="In office now"
                  value={loading ? "—" : String(office.length)}
                  trend="Live visitor status"
                  color="amber"
                />
                <Stat
                  icon={<CheckCircle2 />}
                  label="Enrolled"
                  value={
                    loading
                      ? "—"
                      : String(
                          leads.filter((l) => l.stage === "Enrolled").length,
                        )
                  }
                  trend="All-time conversions"
                  color="green"
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel leads-panel">
                  <PanelTitle
                    title="Recent leads"
                    subtitle="Latest enquiries and student updates"
                    action={() => setActive("Leads & students")}
                  />
                  <LeadTable
                    leads={filtered.slice(0, 5)}
                    select={setSelected}
                    update={persistLead}
                  />
                </section>
                <section className="panel visitors">
                  <PanelTitle
                    title={`Today’s office visitors · ${todayVisits.length}`}
                    subtitle="Everyone who checked in today"
                  />
                  {todayVisits.slice(0, 6).map((visit, i) => (
                    <button
                      key={visit.id}
                      className="visitor"
                      onClick={() => {
                        const lead = leads.find(
                          (item) => item.id === visit.leadId,
                        );
                        if (lead) setSelected(lead);
                      }}
                    >
                      <Avatar name={visit.name} warm={i % 2 === 0} />
                      <span>
                        <strong>{visit.name}</strong>
                        <small>
                          {new Intl.DateTimeFormat("en-NP", {
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(visit.checkedInAt))}{" "}
                          · {visit.checkedInBy}
                        </small>
                      </span>
                      {visit.inOffice && <em>In office</em>}
                    </button>
                  ))}
                  {todayVisits.length === 0 && (
                    <div className="empty compact">
                      No visitors checked in today.
                    </div>
                  )}
                  <button
                    className="checkin"
                    onClick={() => setActive("Office visitors")}
                  >
                    <CalendarClock size={17} /> View visitor history
                  </button>
                </section>
                <section className="panel followups">
                  <PanelTitle
                    title="Scheduled follow-ups"
                    subtitle={`${leads.filter((l) => l.nextFollowUpISO).length} scheduled`}
                    action={() => setActive("Follow-ups")}
                  />
                  {leads
                    .filter((l) => l.nextFollowUpISO)
                    .sort((a, b) =>
                      String(a.nextFollowUpISO).localeCompare(
                        String(b.nextFollowUpISO),
                      ),
                    )
                    .slice(0, 4)
                    .map((l) => (
                      <button
                        className="followup"
                        key={l.id}
                        onClick={() => setSelected(l)}
                      >
                        <span className="timebox">
                          <CalendarClock size={18} />
                        </span>
                        <span>
                          <strong>{l.name}</strong>
                          <small>
                            {l.nextFollowUp} · {l.country || "General enquiry"}
                          </small>
                        </span>
                        <Avatar name={l.followUpAssignee || l.counsellor} />
                        <Phone size={16} />
                      </button>
                    ))}
                  {leads.filter((l) => l.nextFollowUpISO).length === 0 && (
                    <div className="empty compact">
                      No follow-ups scheduled.
                    </div>
                  )}
                </section>
                <section className="panel activity">
                  <PanelTitle
                    title="Team activity"
                    subtitle="Latest saved CRM updates"
                  />
                  {leads
                    .flatMap((l) =>
                      (l.activities || []).map((a) => ({
                        ...a,
                        leadName: l.name,
                        leadId: l.id,
                      })),
                    )
                    .sort((a, b) =>
                      String(b.occurredAt).localeCompare(String(a.occurredAt)),
                    )
                    .slice(0, 5)
                    .map((item, i) => (
                      <div
                        className="activity-row"
                        key={`${item.leadId}-${item.occurredAt}-${i}`}
                      >
                        <span className={`activity-icon a${i % 4}`}>
                          <MessageSquareText size={16} />
                        </span>
                        <p>
                          <strong>{item.authorName}</strong> {item.text}{" "}
                          <b>{item.leadName}</b>
                          <small>
                            {new Intl.DateTimeFormat("en-NP", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(new Date(item.occurredAt))}
                          </small>
                        </p>
                      </div>
                    ))}
                  {leads.every((l) => !l.activities?.length) && (
                    <div className="empty compact">No team activity yet.</div>
                  )}
                </section>
              </div>
            </>
          ) : active === "Office visitors" ? (
            <OfficeView
              leads={leads}
              update={persistLead}
              select={setSelected}
              addNew={openLeadForm}
              onVisitRecorded={refreshTodayVisits}
            />
          ) : active === "Tasks" ? (
            <TasksView
              leads={leads}
              currentUser={currentUser}
              selectLead={setSelected}
            />
          ) : active === "Team" ? (
            <TeamView />
          ) : active === "Follow-ups" ? (
            <FollowUpsView
              leads={leads}
              select={setSelected}
              update={persistLead}
            />
          ) : active === "Settings" ? (
            <SettingsView logout={logout} />
          ) : (
            <section className="panel directory">
              <div className="directory-tools">
                <div className="global-search inner">
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search records..."
                  />
                </div>
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                >
                  <option>All stages</option>
                  {Object.keys(stageStyle).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  value={counsellorFilter}
                  onChange={(e) => setCounsellorFilter(e.target.value)}
                >
                  <option>All counsellors</option>
                  {counsellors.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                >
                  <option>All tags</option>
                  {allTags.map((tag) => (
                    <option key={tag}>{tag}</option>
                  ))}
                </select>
                {(stageFilter !== "All stages" ||
                  counsellorFilter !== "All counsellors" ||
                  tagFilter !== "All tags" ||
                  query) && (
                  <button
                    className="clear-filters"
                    onClick={() => {
                      setStageFilter("All stages");
                      setCounsellorFilter("All counsellors");
                      setTagFilter("All tags");
                      setQuery("");
                    }}
                  >
                    <X size={14} /> Clear
                  </button>
                )}
              </div>
              <LeadTable
                leads={filtered}
                select={setSelected}
                update={persistLead}
              />
            </section>
          )}
        </div>
      </section>

      {showNew && (
        <Modal
          close={() => setShowNew(false)}
          title="Add new enquiry"
          subtitle="Create a lead profile. You can add more details later."
        >
          <form onSubmit={addLead} className="lead-form">
            {appError && <div className="form-error wide">{appError}</div>}
            <label>
              Full name *
              <input required name="name" placeholder="Student’s full name" />
            </label>
            <label>
              Phone number *
              <input required name="phone" placeholder="98XXXXXXXX" />
            </label>
            <label>
              Email
              <input name="email" type="email" placeholder="name@email.com" />
            </label>
            <label>
              Address
              <input name="address" placeholder="City, district" />
            </label>
            <label>
              Education background
              <input name="education" placeholder="e.g. BBS · 68%" />
            </label>
            <label>
              Passed-out institute
              <input
                name="passedOutInstitute"
                list="institute-options"
                placeholder="+2 or Bachelor’s college name"
              />
              <small>
                Previously added institutes will appear as suggestions.
              </small>
            </label>
            <datalist id="institute-options">
              {allInstitutes.map((institute) => (
                <option key={institute} value={institute} />
              ))}
            </datalist>
            <label>
              Lead source
              <select name="source">
                <option>Facebook</option>
                <option>Phone call</option>
                <option>Walk-in</option>
                <option>Instagram</option>
                <option>Referral</option>
                <option>Website</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Interested country
              <input name="country" placeholder="e.g. Australia" />
            </label>
            <label>
              Course / subject
              <input name="course" placeholder="e.g. Master of IT" />
            </label>
            <label className="wide">
              Preferred university
              <input
                name="university"
                placeholder="University name (optional)"
              />
            </label>
            <label className="wide">
              Tags
              <input
                name="tags"
                placeholder="India, SRM, September intake (comma separated)"
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setShowNew(false)}
              >
                Cancel
              </button>
              <button className="primary">Create lead</button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Profile
          lead={selected}
          counsellorOptions={staffCounsellors}
          canManageAssignments={
            currentUser?.role === "super_admin" || currentUser?.role === "admin"
          }
          canDelete={
            currentUser?.role === "super_admin" || currentUser?.role === "admin"
          }
          allTags={allTags}
          allInstitutes={allInstitutes}
          close={() => setSelected(null)}
          update={persistLead}
          onDelete={deleteLead}
        />
      )}
    </main>
  );
}

function Stat({
  icon,
  label,
  value,
  trend,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend: string;
  color: string;
}) {
  return (
    <div className="stat">
      <span className={`stat-icon ${color}`}>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small className={color}>{trend}</small>
      </div>
    </div>
  );
}
function PanelTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: () => void;
}) {
  return (
    <div className="panel-title">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button onClick={action}>
          View all <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}
function StageSelect({
  lead,
  onChange,
  compact = false,
}: {
  lead: Lead;
  onChange: (stage: Stage) => void;
  compact?: boolean;
}) {
  return (
    <select
      aria-label={`Change stage for ${lead.name}`}
      className={`stage-select ${stageStyle[lead.stage]} ${compact ? "compact" : ""}`}
      value={lead.stage}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onChange(e.target.value as Stage);
      }}
    >
      {Object.keys(stageStyle).map((stage) => (
        <option key={stage}>{stage}</option>
      ))}
    </select>
  );
}
function LeadTable({
  leads,
  select,
  update,
}: {
  leads: Lead[];
  select: (l: Lead) => void;
  update: (l: Lead) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Interest & tags</th>
            <th>Stage</th>
            <th>Counsellor</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} onClick={() => select(l)}>
              <td>
                <div className="student-cell">
                  <Avatar name={l.name} />
                  <span>
                    <strong>{l.name}</strong>
                    <small>{l.phone}</small>
                  </span>
                </div>
              </td>
              <td>
                <strong>{l.country}</strong>
                <small>{l.course}</small>
                {l.tags.length > 0 && (
                  <div className="table-tags">
                    {l.tags.slice(0, 3).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                    {l.tags.length > 3 && <span>+{l.tags.length - 3}</span>}
                  </div>
                )}
              </td>
              <td>
                <StageSelect
                  lead={l}
                  onChange={(stage) =>
                    update({ ...l, stage, updated: "Stage changed just now" })
                  }
                />
              </td>
              <td>
                <strong>{l.counsellor}</strong>
                <small>{l.nextFollowUp}</small>
              </td>
              <td>{l.updated}</td>
              <td>
                <ChevronRight size={17} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {leads.length === 0 && (
        <div className="empty">No matching records found.</div>
      )}
    </div>
  );
}
function Modal({
  children,
  close,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  close: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section className="modal">
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button aria-label="Close dialog" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

type TeamMember = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: "super_admin" | "admin" | "manager" | "counsellor" | "receptionist";
  active: boolean;
  lastLoginAt?: string;
  createdAt: string;
};
const roleLabel: Record<TeamMember["role"], string> = {
  super_admin: "Super administrator",
  admin: "Administrator",
  manager: "Manager",
  counsellor: "Counsellor",
  receptionist: "Receptionist",
};

function TasksView({
  leads,
  currentUser,
  selectLead,
}: {
  leads: Lead[];
  currentUser: CurrentUser | null;
  selectLead: (lead: Lead) => void;
}) {
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkTask | null>(null);
  const [filter, setFilter] = useState("Open");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load tasks");
        return data.tasks || [];
      }),
      fetch("/api/users?directory=1").then(async (response) =>
        response.ok ? (await response.json()).users || [] : [],
      ),
    ])
      .then(([loadedTasks, loadedMembers]) => {
        setTasks(loadedTasks);
        setMembers(loadedMembers.filter((member: TeamMember) => member.active));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);
  const [now] = useState(() => Date.now());
  const overdue = tasks.filter(
    (task) =>
      task.status !== "Completed" && new Date(task.dueAt).getTime() < now,
  );
  const open = tasks.filter((task) => task.status !== "Completed");
  const completed = tasks.filter((task) => task.status === "Completed");
  const mine = tasks.filter((task) =>
    task.assignees.some((item) => String(item.userId) === currentUser?.userId),
  );
  const visible = tasks.filter(
    (task) =>
      filter === "All" ||
      (filter === "Open" && task.status !== "Completed") ||
      (filter === "Overdue" &&
        task.status !== "Completed" &&
        new Date(task.dueAt).getTime() < now) ||
      (filter === "Completed" && task.status === "Completed") ||
      (filter === "My tasks" &&
        task.assignees.some(
          (item) => String(item.userId) === currentUser?.userId,
        )),
  );
  const dueFollowUps = leads
    .filter((lead) => lead.nextFollowUpISO)
    .sort((a, b) =>
      String(a.nextFollowUpISO).localeCompare(String(b.nextFollowUpISO)),
    );
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const due = String(data.get("dueAt"));
    const links = String(data.get("links") || "")
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);
    const payload = {
      title: String(data.get("title")),
      description: String(data.get("description") || ""),
      priority: String(data.get("priority")),
      dueAt: new Date(due).toISOString(),
      assigneeIds: data.getAll("assignees").map(String),
      links,
    };
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(result.error || "Could not create task");
      return;
    }
    setTasks((current) => [result.task, ...current]);
    setAdding(false);
    setNotice(
      result.emailStatus === "failed"
        ? "Task created, but assignment email could not be sent."
        : result.emailStatus === "sent"
          ? "Task created and assignees were notified by email."
          : "Task created successfully.",
    );
    form.reset();
  }
  async function updateTask(task: WorkTask, payload: Record<string, unknown>) {
    setSaving(true);
    setError("");
    const response = await fetch(`/api/tasks/${task._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(result.error || "Could not update task");
      return;
    }
    setTasks((current) =>
      current.map((item) => (item._id === task._id ? result.task : item)),
    );
    setSelectedTask(result.task);
    setNotice(
      result.emailStatus === "failed"
        ? "Update saved, but email notification failed."
        : "Task updated and participants notified.",
    );
  }
  async function deleteTask(task: WorkTask) {
    setSaving(true);
    const response = await fetch(`/api/tasks/${task._id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(result.error || "Could not delete task");
      return;
    }
    setTasks((current) => current.filter((item) => item._id !== task._id));
    setSelectedTask(null);
    setNotice("Task deleted.");
  }
  return (
    <div className="tasks-page">
      {error && (
        <div className="app-alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="team-success">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      <div className="task-stats">
        <button onClick={() => setFilter("Open")}>
          <strong>{open.length}</strong>
          <span>Open tasks</span>
        </button>
        <button
          onClick={() => setFilter("Overdue")}
          className="task-stat-danger"
        >
          <strong>{overdue.length}</strong>
          <span>Overdue</span>
        </button>
        <button onClick={() => setFilter("My tasks")}>
          <strong>{mine.length}</strong>
          <span>Assigned to me</span>
        </button>
        <button onClick={() => setFilter("Completed")}>
          <strong>{completed.length}</strong>
          <span>Completed</span>
        </button>
      </div>
      <section className="panel task-board">
        <div className="task-toolbar">
          <div>
            <h2>Team tasks</h2>
            <p>Create, assign and track office work.</p>
          </div>
          <div className="task-toolbar-actions">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option>Open</option>
              <option>My tasks</option>
              <option>Overdue</option>
              <option>Completed</option>
              <option>All</option>
            </select>
            <button
              className="primary"
              onClick={() => {
                setAdding(true);
                setNotice("");
              }}
            >
              <Plus size={16} /> New task
            </button>
          </div>
        </div>
        {loading && <div className="empty">Loading tasks…</div>}
        <div className="task-list">
          {!loading &&
            visible.map((task) => (
              <button
                className="task-row"
                key={task._id}
                onClick={() => setSelectedTask(task)}
              >
                <span
                  className={`task-priority priority-${task.priority.toLowerCase()}`}
                >
                  {task.priority}
                </span>
                <span className="task-main">
                  <strong>{task.title}</strong>
                  <small>
                    {task.assignees.map((item) => item.name).join(", ")} ·
                    Created by {task.createdByName}
                  </small>
                  <i>
                    <span style={{ width: `${task.progress}%` }} />
                  </i>
                </span>
                <span
                  className={`task-status status-${task.status.toLowerCase().replaceAll(" ", "-")}`}
                >
                  {task.status}
                </span>
                <time
                  className={
                    task.status !== "Completed" &&
                    new Date(task.dueAt).getTime() < now
                      ? "overdue-text"
                      : ""
                  }
                >
                  {new Intl.DateTimeFormat("en-NP", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(task.dueAt))}
                </time>
                <ChevronRight size={17} />
              </button>
            ))}
          {!loading && visible.length === 0 && (
            <div className="empty">No tasks in this view.</div>
          )}
        </div>
      </section>
      <section className="panel task-followups">
        <PanelTitle
          title={`Student follow-ups · ${dueFollowUps.length}`}
          subtitle="CRM follow-up work shown alongside team tasks"
        />
        {dueFollowUps.slice(0, 8).map((lead) => (
          <button key={lead.id} onClick={() => selectLead(lead)}>
            <CalendarClock size={17} />
            <span>
              <strong>{lead.name}</strong>
              <small>
                {lead.phone} · Assigned to{" "}
                {lead.followUpAssignee || lead.counsellor}
              </small>
            </span>
            <time>{lead.nextFollowUp}</time>
            <ChevronRight size={16} />
          </button>
        ))}
        {dueFollowUps.length === 0 && (
          <div className="empty compact">No student follow-ups scheduled.</div>
        )}
      </section>
      {adding && (
        <Modal
          close={() => !saving && setAdding(false)}
          title="Create a new task"
          subtitle="Assign one task to one or multiple team members."
        >
          <form className="task-form" onSubmit={createTask}>
            <label>
              Task title *
              <input
                name="title"
                required
                minLength={3}
                maxLength={180}
                placeholder="e.g. Prepare Australia intake campaign"
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                maxLength={5000}
                placeholder="Explain what needs to be done and the expected result..."
              />
            </label>
            <div className="task-form-grid">
              <label>
                Due date and time *
                <input
                  name="dueAt"
                  required
                  type="datetime-local"
                  min={new Date().toISOString().slice(0, 16)}
                />
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="Medium">
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                  <option>Urgent</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Assign to *</legend>
              <div className="assignee-grid">
                {members.map((member) => (
                  <label key={member._id}>
                    <input
                      type="checkbox"
                      name="assignees"
                      value={member._id}
                      defaultChecked={member._id === currentUser?.userId}
                    />
                    <Avatar name={member.name} />
                    <span>
                      {member.name}
                      <small>{roleLabel[member.role]}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Links<small>One Google Drive or reference link per line.</small>
              <textarea
                name="links"
                placeholder="https://drive.google.com/..."
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                {saving ? "Creating…" : "Create & notify"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selectedTask && (
        <Modal
          close={() => !saving && setSelectedTask(null)}
          title={selectedTask.title}
          subtitle={`Created by ${selectedTask.createdByName}`}
        >
          <div className="task-detail">
            <p className="task-description">
              {selectedTask.description || "No description provided."}
            </p>
            <div className="task-meta">
              <span>
                <small>Status</small>
                {selectedTask.status}
              </span>
              <span>
                <small>Priority</small>
                {selectedTask.priority}
              </span>
              <span>
                <small>Due</small>
                {new Intl.DateTimeFormat("en-NP", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(selectedTask.dueAt))}
              </span>
              <span>
                <small>Assignees</small>
                {selectedTask.assignees.map((item) => item.name).join(", ")}
              </span>
            </div>
            {selectedTask.links?.length > 0 && (
              <div className="task-links">
                {selectedTask.links.map((link) => (
                  <a key={link} href={link} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    {link}
                  </a>
                ))}
              </div>
            )}
            <form
              className="task-progress-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void updateTask(selectedTask, {
                  status: String(data.get("status")),
                  progress: Number(data.get("progress")),
                });
              }}
            >
              <label>
                Status
                <select name="status" defaultValue={selectedTask.status}>
                  <option>To do</option>
                  <option>In progress</option>
                  <option>Blocked</option>
                  <option>Completed</option>
                </select>
              </label>
              <label>
                Progress: {selectedTask.progress}%
                <input
                  name="progress"
                  type="range"
                  min="0"
                  max="100"
                  defaultValue={selectedTask.progress}
                />
              </label>
              <button className="primary" disabled={saving}>
                Save progress
              </button>
            </form>
            <div className="task-thread">
              <h3>Updates & remarks</h3>
              {selectedTask.comments
                .slice()
                .reverse()
                .map((comment, index) => (
                  <div key={comment._id || `${comment.createdAt}-${index}`}>
                    <Avatar name={comment.authorName} />
                    <p>
                      {comment.text}
                      <small>
                        {comment.authorName} ·{" "}
                        {new Intl.DateTimeFormat("en-NP", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(comment.createdAt))}
                      </small>
                    </p>
                  </div>
                ))}
            </div>
            <form
              className="task-comment"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const comment = String(
                  new FormData(form).get("comment") || "",
                ).trim();
                if (comment) {
                  void updateTask(selectedTask, { comment });
                  form.reset();
                }
              }}
            >
              <textarea
                name="comment"
                required
                maxLength={3000}
                placeholder="Write progress update, question or remark..."
              />
              <button className="primary" disabled={saving}>
                Post update
              </button>
            </form>
            {(currentUser?.role === "super_admin" ||
              currentUser?.role === "admin" ||
              String(selectedTask.createdBy) === currentUser?.userId) && (
              <button
                className="delete-task"
                disabled={saving}
                onClick={() => deleteTask(selectedTask)}
              >
                <Trash2 size={14} /> Delete task
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function TeamView() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState("");
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [deleting, setDeleting] = useState<TeamMember | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [transferToUserId, setTransferToUserId] = useState("");
  useEffect(() => {
    fetch("/api/users")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load team");
        setMembers(data.users);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "Could not add team member");
      return;
    }
    setMembers(
      [...members, result.user].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setCreated(
      result.invitationStatus === "sent"
        ? `${result.user.name} was added and a CRM welcome email was sent to ${result.user.email}.`
        : `${result.user.name} was added, but the welcome email could not be sent. Share the CRM link and temporary password securely.`,
    );
    setAdding(false);
    form.reset();
  }
  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetting) return;
    setError("");
    const password = String(new FormData(event.currentTarget).get("password"));
    const response = await fetch(`/api/users/${resetting._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "Could not reset password");
      return;
    }
    setCreated(
      `Password reset for ${resetting.name}. Share the new temporary password securely.`,
    );
    setResetting(null);
  }
  async function deleteMember() {
    if (!deleting || !transferToUserId) return;
    setDeleteBusy(true);
    setError("");
    const response = await fetch(`/api/users/${deleting._id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transferToUserId }),
    });
    const result = await response.json();
    setDeleteBusy(false);
    if (!response.ok) {
      setError(result.error || "Could not delete team member");
      return;
    }
    setMembers((current) =>
      current.filter((member) => member._id !== deleting._id),
    );
    setCreated(
      `${deleting.name} was removed. ${result.transferSummary.leads} lead(s), ${result.transferSummary.followUps} follow-up(s), and ${result.transferSummary.tasks} task(s) were handed over to ${result.transferredTo.name}.`,
    );
    setDeleting(null);
    setTransferToUserId("");
  }
  return (
    <>
      <section className="panel team-panel">
        <div className="team-toolbar">
          <div>
            <h2>Team members</h2>
            <p>Manage staff accounts and consultancy roles.</p>
          </div>
          <button
            className="primary"
            onClick={() => {
              setAdding(true);
              setCreated("");
            }}
          >
            <UserRoundPlus size={17} /> Add team member
          </button>
        </div>
        {error && (
          <div className="app-alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {created && (
          <div className="team-success">
            <CheckCircle2 size={17} />
            {created}
          </div>
        )}
        <div className="team-summary">
          <div>
            <strong>{members.length}</strong>
            <span>Total staff</span>
          </div>
          <div>
            <strong>{members.filter((m) => m.active).length}</strong>
            <span>Active accounts</span>
          </div>
          <div>
            <strong>
              {members.filter((m) => m.role === "counsellor").length}
            </strong>
            <span>Counsellors</span>
          </div>
          <div>
            <strong>
              {members.filter((m) => m.role === "receptionist").length}
            </strong>
            <span>Receptionists</span>
          </div>
        </div>
        <div className="team-list">
          {loading && <div className="empty">Loading team…</div>}
          {!loading &&
            members.map((member) => (
              <div className="team-member" key={member._id}>
                <Avatar
                  name={member.name}
                  warm={member.role === "super_admin"}
                />
                <span className="team-person">
                  <strong>{member.name}</strong>
                  <small>
                    {member.email}
                    {member.phone ? ` · ${member.phone}` : ""}
                  </small>
                </span>
                <span className={`role-badge role-${member.role}`}>
                  {roleLabel[member.role]}
                </span>
                <span
                  className={`account-status ${member.active ? "active" : ""}`}
                >
                  {member.active ? "Active" : "Inactive"}
                </span>
                <span className="last-login">
                  <small>Last login</small>
                  {member.lastLoginAt
                    ? new Intl.DateTimeFormat("en-NP", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(member.lastLoginAt))
                    : "Never"}
                </span>
                <div className="team-actions">
                  <button
                    className="reset-password"
                    onClick={() => {
                      setResetting(member);
                      setCreated("");
                    }}
                  >
                    Reset password
                  </button>
                  {member.role !== "super_admin" && (
                    <button
                      className="delete-member"
                      aria-label={`Delete ${member.name}`}
                      onClick={() => {
                        setDeleting(member);
                        setTransferToUserId("");
                        setCreated("");
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          {!loading && members.length === 0 && (
            <div className="empty">No staff accounts yet.</div>
          )}
        </div>
      </section>
      {adding && (
        <Modal
          close={() => setAdding(false)}
          title="Add team member"
          subtitle="Create a secure login for a consultant or staff member."
        >
          <form className="lead-form" onSubmit={addMember}>
            <label>
              Full name *
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="Staff member’s name"
              />
            </label>
            <label>
              Work email *
              <input
                name="email"
                required
                type="email"
                autoComplete="off"
                placeholder="name@consultancy.com"
              />
            </label>
            <label>
              Phone number
              <input name="phone" maxLength={24} placeholder="98XXXXXXXX" />
            </label>
            <label>
              Role *
              <select name="role" defaultValue="counsellor">
                <option value="counsellor">Counsellor</option>
                <option value="receptionist">Receptionist</option>
                <option value="manager">Manager</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <label className="wide">
              Temporary password *
              <input
                name="password"
                required
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Minimum 10 characters"
              />
              <small>
                Send this privately. The password is stored only as a secure
                hash.
              </small>
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="primary">Create staff account</button>
            </div>
          </form>
        </Modal>
      )}
      {resetting && (
        <Modal
          close={() => setResetting(null)}
          title="Reset team password"
          subtitle={`Set a new temporary password for ${resetting.name}.`}
        >
          <form className="lead-form" onSubmit={resetPassword}>
            <label className="wide">
              New temporary password *
              <input
                name="password"
                required
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Minimum 10 characters"
              />
              <small>The old password will stop working immediately.</small>
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setResetting(null)}
              >
                Cancel
              </button>
              <button className="primary">Reset password</button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          close={() => !deleteBusy && setDeleting(null)}
          title="Delete team member"
          subtitle={`Remove ${deleting.name} and revoke their CRM access permanently?`}
        >
          <div className="delete-confirm">
            <div>
              <Trash2 size={20} />
              <p>
                <strong>Handover required before removal.</strong>
                <span>
                  Leads, follow-ups and tasks will transfer to the selected
                  active team member. Notes and activity history remain intact.
                </span>
              </p>
            </div>
            <label className="handover-select">
              Transfer all work to *
              <select
                value={transferToUserId}
                required
                disabled={deleteBusy}
                onChange={(event) => setTransferToUserId(event.target.value)}
              >
                <option value="">Select replacement staff</option>
                {members
                  .filter(
                    (member) => member.active && member._id !== deleting._id,
                  )
                  .map((member) => (
                    <option key={member._id} value={member._id}>
                      {member.name} · {roleLabel[member.role]}
                    </option>
                  ))}
              </select>
              <small>
                Student ownership, assigned follow-ups and open task access
                will move to this person.
              </small>
            </label>
            <footer>
              <button
                className="secondary"
                disabled={deleteBusy}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                className="danger solid"
                disabled={deleteBusy || !transferToUserId}
                onClick={deleteMember}
              >
                {deleteBusy ? "Deleting…" : "Delete team member"}
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </>
  );
}

function FollowUpsView({
  leads,
  select,
  update,
}: {
  leads: Lead[];
  select: (lead: Lead) => void;
  update: (lead: Lead, activity?: { type: string; text: string }) => void;
}) {
  const scheduled = leads
    .filter((lead) => lead.nextFollowUpISO)
    .sort((a, b) =>
      String(a.nextFollowUpISO).localeCompare(String(b.nextFollowUpISO)),
    );
  const [now] = useState(() => Date.now());
  const overdue = scheduled.filter(
    (lead) => new Date(String(lead.nextFollowUpISO)).getTime() < now,
  );
  const upcoming = scheduled.filter(
    (lead) => new Date(String(lead.nextFollowUpISO)).getTime() >= now,
  );
  const row = (lead: Lead, isOverdue: boolean) => (
    <div className="followup-row" key={lead.id}>
      <span className={`followup-date ${isOverdue ? "overdue" : ""}`}>
        <CalendarClock size={18} />
      </span>
      <button className="followup-person" onClick={() => select(lead)}>
        <strong>{lead.name}</strong>
        <small>
          {lead.phone} · {lead.country || "General enquiry"}
        </small>
      </button>
      <span className="followup-owner">
        <small>Follow-up assigned to</small>
        {lead.followUpAssignee || lead.counsellor || "Unassigned"}
      </span>
      <span className="followup-when">
        <small>{isOverdue ? "Overdue" : "Scheduled"}</small>
        {lead.nextFollowUp}
      </span>
      <button className="secondary" onClick={() => select(lead)}>
        Reschedule
      </button>
      <button
        className="complete-followup"
        onClick={() =>
          update(
            {
              ...lead,
              nextFollowUp: "Not scheduled",
              nextFollowUpISO: null,
              followUpAssignedTo: null,
              followUpAssignee: "",
              updated: "Follow-up completed just now",
            },
            { type: "follow_up", text: "Follow-up marked complete" },
          )
        }
      >
        <CheckCircle2 size={16} /> Complete
      </button>
    </div>
  );
  return (
    <div className="followup-page">
      <div className="followup-stats">
        <div>
          <strong>{scheduled.length}</strong>
          <span>Scheduled</span>
        </div>
        <div className="danger-stat">
          <strong>{overdue.length}</strong>
          <span>Overdue</span>
        </div>
        <div>
          <strong>{upcoming.length}</strong>
          <span>Upcoming</span>
        </div>
        <div>
          <strong>{leads.filter((l) => !l.nextFollowUpISO).length}</strong>
          <span>Not scheduled</span>
        </div>
      </div>
      {overdue.length > 0 && (
        <section className="panel followup-section">
          <PanelTitle
            title="Overdue follow-ups"
            subtitle="These students need immediate attention"
          />
          {overdue.map((lead) => row(lead, true))}
        </section>
      )}
      <section className="panel followup-section">
        <PanelTitle
          title="Upcoming follow-ups"
          subtitle="Calls, messages and meetings scheduled next"
        />
        {upcoming.map((lead) => row(lead, false))}
        {upcoming.length === 0 && (
          <div className="empty">
            No upcoming follow-ups. Open a student profile to schedule one.
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsView({ logout }: { logout: () => void }) {
  const [user, setUser] = useState<{
    name: string;
    email: string;
    role: string;
  } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => setUser(data.user || null))
      .catch(() => setUser(null));
  }, []);
  return (
    <div className="settings-grid">
      <section className="panel settings-card">
        <div className="settings-title">
          <CircleUserRound />
          <div>
            <h2>Your account</h2>
            <p>Current authenticated staff profile</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Name</dt>
            <dd>{user?.name || "Loading…"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user?.email || "—"}</dd>
          </div>
          <div>
            <dt>Access role</dt>
            <dd>{user?.role?.replace("_", " ") || "—"}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>
              <span className="healthy-dot" /> Active and protected
            </dd>
          </div>
        </dl>
        <button className="danger" onClick={logout}>
          <LogOut size={16} /> Sign out of this device
        </button>
      </section>
      <section className="panel settings-card">
        <div className="settings-title">
          <Settings />
          <div>
            <h2>CRM configuration</h2>
            <p>Current workspace capabilities</p>
          </div>
        </div>
        <ul className="settings-list">
          <li>
            <CheckCircle2 /> MongoDB persistent storage
          </li>
          <li>
            <CheckCircle2 /> Role-based team accounts
          </li>
          <li>
            <CheckCircle2 /> Secure session authentication
          </li>
          <li>
            <CheckCircle2 /> Lead duplicate prevention
          </li>
          <li>
            <CheckCircle2 /> Activity and visit history
          </li>
        </ul>
        <p className="settings-note">
          Workspace branding, branches, custom pipeline stages and messaging
          integrations require an administrator configuration module before they
          can be changed here.
        </p>
      </section>
    </div>
  );
}

function OfficeView({
  leads,
  update,
  select,
  addNew,
  onVisitRecorded,
}: {
  leads: Lead[];
  update: (x: Lead, activity?: { type: string; text: string }) => Promise<void>;
  select: (x: Lead) => void;
  addNew: () => void;
  onVisitRecorded: () => Promise<void>;
}) {
  const [visitorSearch, setVisitorSearch] = useState("");
  const [visitDate, setVisitDate] = useState(localDateKey());
  const [visitHistory, setVisitHistory] = useState<VisitRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  async function loadVisitHistory(date: string) {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/visits?date=${date}`);
      const data = await response.json();
      setVisitHistory(response.ok ? data.visits || [] : []);
    } catch {
      setVisitHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/visits?date=${visitDate}`)
      .then(async (response) => ({
        ok: response.ok,
        data: await response.json(),
      }))
      .then(({ ok, data }) => {
        if (active) setVisitHistory(ok ? data.visits || [] : []);
      })
      .catch(() => {
        if (active) setVisitHistory([]);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visitDate]);
  const office = leads.filter((l) => l.inOffice);
  const normalized = visitorSearch.trim().toLowerCase();
  const matches = leads
    .filter(
      (l) =>
        !l.inOffice &&
        (!normalized ||
          `${l.name} ${l.phone} ${l.email}`.toLowerCase().includes(normalized)),
    )
    .slice(0, 6);
  const checkIn = async (lead: Lead) => {
    await update(
      { ...lead, inOffice: true, updated: "Just checked in" },
      { type: "visit", text: "Visitor checked in" },
    );
    setVisitorSearch("");
    await onVisitRecorded();
    if (visitDate === localDateKey()) await loadVisitHistory(visitDate);
  };
  const yesterday = () => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return localDateKey(date);
  };
  const selectVisitDate = (date: string) => {
    setHistoryLoading(true);
    setVisitDate(date);
  };
  return (
    <div className="office-grid">
      <section className="panel">
        <PanelTitle
          title={`Currently in office · ${office.length}`}
          subtitle="Live visitor board for reception and counsellors"
        />
        {office.length === 0 && (
          <div className="empty compact">
            No visitors are checked in right now.
          </div>
        )}
        {office.map((l) => (
          <div className="office-row" key={l.id}>
            <Avatar name={l.name} />
            <span>
              <strong>{l.name}</strong>
              <small>
                {l.phone} · {l.country} · {l.course}
              </small>
              <em>
                {l.counsellor} · Follow-up: {l.nextFollowUp}
              </em>
            </span>
            <StageSelect
              lead={l}
              compact
              onChange={(stage) =>
                update(
                  { ...l, stage, updated: "Stage changed just now" },
                  { type: "stage", text: `Stage changed to ${stage}` },
                )
              }
            />
            <button className="secondary" onClick={() => select(l)}>
              Open profile
            </button>
            <button
              className="danger"
              onClick={() =>
                update(
                  { ...l, inOffice: false, updated: "Just checked out" },
                  { type: "visit", text: "Visitor checked out" },
                )
              }
            >
              Check out
            </button>
          </div>
        ))}
      </section>
      <section className="panel quick-checkin">
        <PanelTitle
          title="Quick check-in"
          subtitle="Find any existing lead by name or phone"
        />
        <div className="visitor-search">
          <Search size={19} />
          <input
            autoFocus
            value={visitorSearch}
            onChange={(e) => setVisitorSearch(e.target.value)}
            placeholder="Type name, phone or email..."
          />
          {visitorSearch && (
            <button
              onClick={() => setVisitorSearch("")}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <p className="search-hint">
          {normalized
            ? `${matches.length} matching contact${matches.length === 1 ? "" : "s"}`
            : "Recent contacts"}
        </p>
        <div className="visitor-results">
          {matches.map((l) => (
            <div className="visitor-result" key={l.id}>
              <button className="visitor-identity" onClick={() => select(l)}>
                <Avatar name={l.name} />
                <span>
                  <strong>{l.name}</strong>
                  <small>
                    {l.phone}
                    {l.email ? ` · ${l.email}` : ""}
                  </small>
                  <em>
                    {l.country || "No country preference"} ·{" "}
                    {l.course || "No course"} · {l.counsellor}
                  </em>
                </span>
              </button>
              <StageSelect
                lead={l}
                compact
                onChange={(stage) =>
                  update(
                    { ...l, stage, updated: "Stage changed just now" },
                    { type: "stage", text: `Stage changed to ${stage}` },
                  )
                }
              />
              <button className="checkin-now" onClick={() => checkIn(l)}>
                <UserCheck size={16} /> Check in
              </button>
            </div>
          ))}
        </div>
        {normalized && matches.length === 0 && (
          <div className="no-contact">
            <CircleUserRound size={28} />
            <strong>No existing contact found</strong>
            <p>Check the phone number or create a new enquiry.</p>
            <button className="primary" onClick={addNew}>
              <Plus size={16} /> Add new lead
            </button>
          </div>
        )}
      </section>
      <section className="panel visit-history">
        <div className="visit-history-head">
          <div>
            <h2>Office visitor history</h2>
            <p>View every check-in date by date.</p>
          </div>
          <div className="visit-date-tools">
            <button
              className={visitDate === localDateKey() ? "active" : ""}
              onClick={() => selectVisitDate(localDateKey())}
            >
              Today
            </button>
            <button
              className={visitDate === yesterday() ? "active" : ""}
              onClick={() => selectVisitDate(yesterday())}
            >
              Yesterday
            </button>
            <input
              aria-label="Visitor history date"
              type="date"
              value={visitDate}
              max={localDateKey()}
              onChange={(event) => selectVisitDate(event.target.value)}
            />
          </div>
        </div>
        <div className="visit-history-summary">
          <strong>{historyLoading ? "—" : visitHistory.length}</strong>
          <span>
            visitor check-in{visitHistory.length === 1 ? "" : "s"} on{" "}
            {new Intl.DateTimeFormat("en-NP", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            }).format(new Date(`${visitDate}T00:00:00`))}
          </span>
        </div>
        <div className="visit-history-list">
          {historyLoading && (
            <div className="empty compact">Loading visitor history…</div>
          )}
          {!historyLoading &&
            visitHistory.map((visit) => (
              <button
                key={visit.id}
                className="visit-history-row"
                onClick={() => {
                  const lead = leads.find((item) => item.id === visit.leadId);
                  if (lead) select(lead);
                }}
              >
                <Avatar name={visit.name} />
                <span>
                  <strong>{visit.name}</strong>
                  <small>
                    {visit.phone} · {visit.country || "General enquiry"}
                    {visit.course ? ` · ${visit.course}` : ""}
                  </small>
                  <em>Checked in by {visit.checkedInBy}</em>
                </span>
                <time>
                  {new Intl.DateTimeFormat("en-NP", {
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(visit.checkedInAt))}
                </time>
                {visit.inOffice && visitDate === localDateKey() && (
                  <b>In office</b>
                )}
              </button>
            ))}
          {!historyLoading && visitHistory.length === 0 && (
            <div className="empty compact">
              No office visits recorded for this date.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Profile({
  lead,
  counsellorOptions,
  canManageAssignments,
  canDelete,
  allTags,
  allInstitutes,
  close,
  update,
  onDelete,
}: {
  lead: Lead;
  counsellorOptions: TeamMember[];
  canManageAssignments: boolean;
  canDelete: boolean;
  allTags: string[];
  allInstitutes: string[];
  close: () => void;
  update: (l: Lead, activity?: { type: string; text: string }) => void;
  onDelete: (lead: Lead) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const notes = (lead.activities || []).slice().reverse();
  const [action, setAction] = useState<"call" | "followup" | "email" | null>(
    null,
  );
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const ownerOption =
    counsellorOptions.find((member) => member._id === lead.assignedTo) ||
    counsellorOptions.find((member) => member.name === lead.counsellor);
  const defaultFollowUpAssignee =
    lead.followUpAssignedTo || ownerOption?._id || "";

  function saveCall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const outcome = String(data.get("outcome"));
    const details = String(data.get("details") || "").trim();
    const text = `Call logged · ${outcome}${details ? ` — ${details}` : ""}`;
    update(
      { ...lead, updated: "Call logged just now" },
      { type: "call", text },
    );
    setAction(null);
    setFeedback("Call saved to the student timeline.");
  }
  function saveFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = String(data.get("date"));
    if (!value) return;
    const assigneeId = String(data.get("assignee") || "");
    const assignee = counsellorOptions.find(
      (member) => member._id === assigneeId,
    );
    const formatted = new Intl.DateTimeFormat("en-NP", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
    const text = `Follow-up scheduled for ${formatted} · ${String(data.get("method"))} · Assigned to ${assignee?.name || "Unassigned"}`;
    update(
      {
        ...lead,
        nextFollowUp: formatted,
        nextFollowUpISO: new Date(value).toISOString(),
        followUpAssignedTo: assignee?._id || null,
        followUpAssignee: assignee?.name || "",
        updated: "Follow-up scheduled just now",
      },
      { type: "follow_up", text },
    );
    setAction(null);
    setFeedback(
      `Follow-up scheduled for ${formatted} with ${assignee?.name || "no assignee"}.`,
    );
  }
  function toggleOffice() {
    const checkedOut = lead.inOffice;
    update(
      {
        ...lead,
        inOffice: !lead.inOffice,
        updated: checkedOut ? "Just checked out" : "Just checked in",
      },
      {
        type: "visit",
        text: `Visitor ${checkedOut ? "checked out" : "checked in"}`,
      },
    );
    setFeedback(
      `${lead.name} has been ${checkedOut ? "checked out" : "checked in"}.`,
    );
  }
  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const assignedTo = canManageAssignments
      ? String(data.get("assignedTo") || "")
      : String(lead.assignedTo || "");
    const owner = counsellorOptions.find((member) => member._id === assignedTo);
    const changed: Lead = {
      ...lead,
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim(),
      email: String(data.get("email")).trim(),
      address: String(data.get("address")).trim(),
      education: String(data.get("education")).trim(),
      passedOutInstitute: String(data.get("passedOutInstitute")).trim(),
      country: String(data.get("country")).trim(),
      course: String(data.get("course")).trim(),
      university: String(data.get("university")).trim(),
      source: String(data.get("source")),
      stage: String(data.get("stage")) as Stage,
      counsellor: canManageAssignments
        ? owner?.name || "Unassigned"
        : lead.counsellor,
      assignedTo: canManageAssignments ? owner?._id || null : lead.assignedTo,
      priority: String(data.get("priority")) as Lead["priority"],
      updated: "Edited just now",
    };
    update(changed, {
      type: "note",
      text: "Student and enquiry details updated",
    });
    setEditing(false);
    setFeedback("Student details updated successfully.");
  }
  async function sendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError("");
    setFeedback("");
    setSendingEmail(true);
    const data = new FormData(event.currentTarget);
    const subject = String(data.get("subject") || "");
    const message = String(data.get("message") || "");
    try {
      const response = await fetch(
        `/api/leads/${encodeURIComponent(lead.id)}/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, message }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Email could not be sent");
      setAction(null);
      setFeedback(`Email sent successfully to ${lead.email}.`);
    } catch (error) {
      setEmailError(
        error instanceof Error ? error.message : "Email could not be sent",
      );
    } finally {
      setSendingEmail(false);
    }
  }
  function addTag(value: string) {
    const tag = value.trim();
    if (
      !tag ||
      lead.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
    )
      return;
    update(
      { ...lead, tags: [...lead.tags, tag], updated: "Tags updated just now" },
      { type: "note", text: `Tag added · ${tag}` },
    );
    setTagInput("");
    setFeedback(`Tag “${tag}” added.`);
  }
  function removeTag(tag: string) {
    update(
      {
        ...lead,
        tags: lead.tags.filter((item) => item !== tag),
        updated: "Tags updated just now",
      },
      { type: "note", text: `Tag removed · ${tag}` },
    );
    setFeedback(`Tag “${tag}” removed.`);
  }

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <aside className="profile-drawer">
        <div className="modal-head">
          <div>
            <p className="eyebrow">STUDENT #{lead.id}</p>
          </div>
          <button aria-label="Close student profile" onClick={close}>
            <X />
          </button>
        </div>
        <div className="profile-hero">
          <Avatar name={lead.name} warm />
          <div>
            <h2>{lead.name}</h2>
            <p>
              {lead.phone} · {lead.email}
            </p>
            <div className="profile-status">
              <StageSelect
                lead={lead}
                onChange={(stage) => {
                  update(
                    { ...lead, stage, updated: "Stage changed just now" },
                    { type: "stage", text: `Stage changed to ${stage}` },
                  );
                  setFeedback(`Stage changed to ${stage}.`);
                }}
              />
              {lead.inOffice && (
                <span className="office-status">In office</span>
              )}
            </div>
          </div>
        </div>
        <div className="quick-actions">
          <button
            className={action === "call" ? "selected" : ""}
            onClick={() => {
              setAction(action === "call" ? null : "call");
              setFeedback("");
              setEmailError("");
            }}
          >
            <Phone /> Log call
          </button>
          <button
            className={action === "followup" ? "selected" : ""}
            onClick={() => {
              setAction(action === "followup" ? null : "followup");
              setFeedback("");
              setEmailError("");
            }}
          >
            <CalendarClock /> Follow-up
          </button>
          <button
            className={action === "email" ? "selected" : ""}
            onClick={() => {
              setAction(action === "email" ? null : "email");
              setFeedback("");
              setEmailError("");
            }}
          >
            <Mail /> Send email
          </button>
          <button onClick={toggleOffice}>
            <UserCheck /> {lead.inOffice ? "Check out" : "Check in"}
          </button>
        </div>
        {feedback && (
          <div className="action-success">
            <CheckCircle2 size={16} />
            {feedback}
          </div>
        )}
        {action === "call" && (
          <form className="action-form" onSubmit={saveCall}>
            <div className="action-form-title">
              <Phone size={17} />
              <div>
                <strong>Log a phone call</strong>
                <small>Save the result in this student’s timeline</small>
              </div>
            </div>
            <label>
              Call outcome
              <select name="outcome">
                <option>Connected</option>
                <option>No answer</option>
                <option>Busy</option>
                <option>Call back requested</option>
                <option>Wrong number</option>
              </select>
            </label>
            <label>
              Call notes
              <textarea
                name="details"
                required
                placeholder="What was discussed?"
              />
            </label>
            <div>
              <button
                type="button"
                className="secondary"
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
              <button className="primary">Save call</button>
            </div>
          </form>
        )}
        {action === "followup" && (
          <form className="action-form" onSubmit={saveFollowUp}>
            <div className="action-form-title">
              <CalendarClock size={17} />
              <div>
                <strong>Schedule follow-up</strong>
                <small>
                  Defaults to the student owner, but can be assigned to another
                  counsellor
                </small>
              </div>
            </div>
            <label>
              Date and time
              <input
                name="date"
                type="datetime-local"
                required
                min={new Date().toISOString().slice(0, 16)}
              />
            </label>
            <label>
              Follow-up method
              <select name="method">
                <option>Phone call</option>
                <option>WhatsApp</option>
                <option>Email</option>
                <option>Office meeting</option>
              </select>
            </label>
            <label>
              Assign this follow-up to
              <select
                name="assignee"
                defaultValue={defaultFollowUpAssignee}
                required
              >
                <option value="" disabled>
                  Select counsellor
                </option>
                {counsellorOptions.map((member) => (
                  <option key={member._id} value={member._id}>
                    {member.name} · {roleLabel[member.role]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button
                type="button"
                className="secondary"
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
              <button className="primary">Schedule</button>
            </div>
          </form>
        )}
        {action === "email" && (
          <form className="action-form email-compose" onSubmit={sendEmail}>
            <div className="action-form-title">
              <Mail size={17} />
              <div>
                <strong>Send a custom email</strong>
                <small>
                  {lead.email
                    ? `To ${lead.email}`
                    : "This student does not have an email address"}
                </small>
              </div>
            </div>
            {emailError && <div className="form-error wide">{emailError}</div>}
            <label>
              Subject
              <input
                name="subject"
                required
                minLength={3}
                maxLength={150}
                placeholder="Application update, document reminder..."
              />
            </label>
            <label>
              Message
              <textarea
                name="message"
                required
                maxLength={5000}
                placeholder={`Write your message to ${lead.name}...`}
              />
            </label>
            <div>
              <button
                type="button"
                className="secondary"
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={sendingEmail || !lead.email}
              >
                {sendingEmail ? "Sending..." : "Send email"}
              </button>
            </div>
          </form>
        )}
        <div className="profile-section tag-section">
          <h3>Student tags</h3>
          <div className="tag-list">
            {lead.tags.map((tag) => (
              <span className="student-tag" key={tag}>
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove ${tag}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {lead.tags.length === 0 && <small>No tags added yet.</small>}
          </div>
          <form
            className="tag-create"
            onSubmit={(event) => {
              event.preventDefault();
              addTag(tagInput);
            }}
          >
            <input
              value={tagInput}
              maxLength={40}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="Create or add a tag..."
            />
            <button className="primary">Add tag</button>
          </form>
          {allTags
            .filter(
              (tag) =>
                !lead.tags.includes(tag) &&
                tag.toLowerCase().includes(tagInput.toLowerCase()),
            )
            .slice(0, 8).length > 0 && (
            <div className="tag-suggestions">
              <small>Existing tags</small>
              {allTags
                .filter(
                  (tag) =>
                    !lead.tags.includes(tag) &&
                    tag.toLowerCase().includes(tagInput.toLowerCase()),
                )
                .slice(0, 8)
                .map((tag) => (
                  <button key={tag} onClick={() => addTag(tag)}>
                    + {tag}
                  </button>
                ))}
            </div>
          )}
        </div>
        <div className="profile-section">
          <div className="section-heading">
            <h3>Student & enquiry details</h3>
            <button
              className="edit-details"
              onClick={() => {
                setEditing(!editing);
                setFeedback("");
              }}
            >
              <Pencil size={14} /> {editing ? "Close editor" : "Edit details"}
            </button>
          </div>
          {editing ? (
            <form className="edit-form" onSubmit={saveDetails}>
              <label>
                Student name
                <input name="name" required defaultValue={lead.name} />
              </label>
              <label>
                Phone number
                <input name="phone" required defaultValue={lead.phone} />
              </label>
              <label>
                Email address
                <input name="email" type="email" defaultValue={lead.email} />
              </label>
              <label>
                Address
                <input name="address" defaultValue={lead.address} />
              </label>
              <label>
                Education
                <input name="education" defaultValue={lead.education} />
              </label>
              <label>
                Passed-out institute
                <input
                  name="passedOutInstitute"
                  list="profile-institute-options"
                  defaultValue={lead.passedOutInstitute}
                  placeholder="College or institute name"
                />
              </label>
              <datalist id="profile-institute-options">
                {allInstitutes.map((institute) => (
                  <option key={institute} value={institute} />
                ))}
              </datalist>
              <label>
                Interested country
                <input name="country" defaultValue={lead.country} />
              </label>
              <label>
                Course / subject
                <input name="course" defaultValue={lead.course} />
              </label>
              <label>
                Preferred university
                <input name="university" defaultValue={lead.university} />
              </label>
              <label>
                Lead source
                <select name="source" defaultValue={lead.source}>
                  <option>Facebook</option>
                  <option>Phone call</option>
                  <option>Walk-in</option>
                  <option>Instagram</option>
                  <option>Referral</option>
                  <option>Website</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Pipeline stage
                <select name="stage" defaultValue={lead.stage}>
                  {Object.keys(stageStyle).map((stage) => (
                    <option key={stage}>{stage}</option>
                  ))}
                </select>
              </label>
              {canManageAssignments ? (
                <label>
                  Student owner
                  <select
                    name="assignedTo"
                    defaultValue={ownerOption?._id || ""}
                  >
                    <option value="">Unassigned</option>
                    {counsellorOptions.map((member) => (
                      <option key={member._id} value={member._id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Student owner
                  <input value={lead.counsellor} disabled />
                </label>
              )}
              <label>
                Priority
                <select name="priority" defaultValue={lead.priority}>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </label>
              <div className="edit-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                <button className="primary">Save changes</button>
              </div>
            </form>
          ) : (
            <dl>
              <div>
                <dt>Country</dt>
                <dd>{lead.country || "—"}</dd>
              </div>
              <div>
                <dt>Course</dt>
                <dd>{lead.course || "—"}</dd>
              </div>
              <div>
                <dt>University</dt>
                <dd>{lead.university || "—"}</dd>
              </div>
              <div>
                <dt>Education</dt>
                <dd>{lead.education || "—"}</dd>
              </div>
              <div>
                <dt>Passed-out institute</dt>
                <dd>{lead.passedOutInstitute || "—"}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{lead.address || "—"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{lead.source}</dd>
              </div>
              <div>
                <dt>Student owner</dt>
                <dd>{lead.counsellor}</dd>
              </div>
              <div>
                <dt>Next follow-up</dt>
                <dd>{lead.nextFollowUp}</dd>
              </div>
              <div>
                <dt>Follow-up assigned to</dt>
                <dd>{lead.followUpAssignee || "—"}</dd>
              </div>
            </dl>
          )}
        </div>
        <div className="profile-section">
          <h3>Conversation timeline</h3>
          <form
            className="note-box"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) {
                update(
                  { ...lead, updated: "Note added just now" },
                  { type: "note", text: note },
                );
                setNote("");
                setFeedback("Note saved to the timeline.");
              }
            }}
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Write today’s discussion, requirement or remark..."
            />
            <button className="primary">Save note</button>
          </form>
          <div className="timeline">
            {notes.map((item, i) => (
              <div key={`${item.occurredAt}-${i}`}>
                <span>
                  <MessageSquareText size={15} />
                </span>
                <p>
                  {item.text}
                  <small>
                    {new Intl.DateTimeFormat("en-NP", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(item.occurredAt))}{" "}
                    · {item.authorName}
                  </small>
                </p>
              </div>
            ))}
            {notes.length === 0 && (
              <div className="empty compact">No activity yet.</div>
            )}
          </div>
        </div>
        {canDelete && (
          <div className="profile-section lead-danger-zone">
            <div>
              <h3>Delete this lead</h3>
              <p>
                Permanently remove this student, notes, follow-ups and visit
                history.
              </p>
            </div>
            <button
              className="delete-lead-button"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 size={15} /> Delete lead
            </button>
          </div>
        )}
        {deleteConfirm && (
          <div className="delete-lead-overlay">
            <section>
              <Trash2 size={24} />
              <h3>Delete {lead.name}?</h3>
              <p>
                This permanently deletes the lead and all associated activity
                and visit history. This action cannot be undone.
              </p>
              <div>
                <button
                  className="secondary"
                  disabled={deleteBusy}
                  onClick={() => setDeleteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="danger solid"
                  disabled={deleteBusy}
                  onClick={async () => {
                    setDeleteBusy(true);
                    const deleted = await onDelete(lead);
                    if (!deleted) setDeleteBusy(false);
                  }}
                >
                  {deleteBusy ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
