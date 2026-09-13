import React, { useState, useEffect, useMemo, useCallback } from "react";
import { uploadImage } from "./cloudinary";

// ============ constants ============
const CATEGORIES = ["Electronics", "Keys", "Bag / Backpack", "Clothing", "ID / Card", "Water Bottle", "Book / Notes", "Other"];
const STUDENT_ID_PATTERN = /^\d{2}-\d{4}-\d{3}$/;

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function formatStudentId(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 9);
  const p1 = digits.slice(0, 2);
  const p2 = digits.slice(2, 6);
  const p3 = digits.slice(6, 9);
  return [p1, p2, p3].filter(Boolean).join("-");
}

function readAndResizeImage(file, maxDim = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("That file isn't an image."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't load that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const timeAgo = (iso) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// ============ API DATA LAYER ============
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// --- students ---
const sbFetchStudents = () => api("/api/students");
const sbRegisterStudent = ({ name, studentId, contact }) =>
  api("/api/students", { method: "POST", body: JSON.stringify({ name, studentId, contact }) });
const sbLoginStudent = (studentId) =>
  api("/api/students", { method: "POST", body: JSON.stringify({ action: "login", studentId }) });

// --- admins ---
const sbLoginAdmin = ({ staffId, password }) =>
  api("/api/admins", { method: "POST", body: JSON.stringify({ staffId, password }) });

// --- items ---
const sbFetchItems = () => api("/api/items");
const sbCreateItem = async (entry) => {
  let imageUrl = null;
  if (entry.image && entry.image.startsWith("data:")) {
    imageUrl = await uploadImage(entry.image);
  } else if (entry.image) {
    imageUrl = entry.image;
  }
  return api("/api/items", {
    method: "POST",
    body: JSON.stringify({ ...entry, image: imageUrl }),
  });
};
const sbDeleteItem = (id) => api(`/api/items?id=${id}`, { method: "DELETE" });

// --- claims ---
const sbFetchClaims = () => api("/api/claims");
const sbCreateClaim = (claim) => api("/api/claims", { method: "POST", body: JSON.stringify(claim) });
const sbDecideClaim = (claim, decision) =>
  api("/api/claims", { method: "PUT", body: JSON.stringify({ id: claim.id, decision }) });

// --- notifications ---
const sbFetchNotifs = () => api("/api/notifications");
const sbMarkNotifRead = (id) =>
  api("/api/notifications", { method: "PUT", body: JSON.stringify({ id }) });
const sbMarkAllRead = (audience) =>
  api("/api/notifications", { method: "PUT", body: JSON.stringify({ audience }) });

// ============ root component ============
export default function CampusLostFoundSystem() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [claims, setClaims] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [tab, setTab] = useState("browse");

  const loadAll = useCallback(async () => {
    try {
      const [i, c, n] = await Promise.all([sbFetchItems(), sbFetchClaims(), sbFetchNotifs()]);
      setItems(i);
      setClaims(c);
      setNotifications(n);
    } catch (e) {
      console.error("Load error:", e.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const session = localStorage.getItem("lf:session");
      if (session) {
        try { setUser(JSON.parse(session)); } catch {}
      }
      await loadAll();
      setBooting(false);
    })();
  }, [loadAll]);

  useEffect(() => {
    if (booting) return;
    const t = setInterval(loadAll, 10000);
    return () => clearInterval(t);
  }, [booting, loadAll]);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  };

  const login = (u) => {
    setUser(u);
    localStorage.setItem("lf:session", JSON.stringify(u));
    setTab(u.role === "admin" ? "dashboard" : "browse");
  };
  const logout = () => {
    setUser(null);
    localStorage.removeItem("lf:session");
  };

  const registerStudent = async ({ name, studentId, contact }) => {
    try {
      const { profile } = await sbRegisterStudent({ name, studentId, contact });
      login(profile);
      await loadAll();
      return null;
    } catch (e) { return e.message; }
  };
  const loginStudent = async (studentId) => {
    try {
      const { profile } = await sbLoginStudent(studentId);
      login(profile);
      return null;
    } catch (e) { return e.message; }
  };
  const loginAdmin = async ({ staffId, password }) => {
    try {
      const { profile } = await sbLoginAdmin({ staffId, password });
      login(profile);
      return null;
    } catch (e) { return e.message; }
  };

  const addItem = async (entry) => {
    try {
      const item = await sbCreateItem(entry);
      setItems((prev) => [item, ...prev]);
      flash(entry.type === "lost" ? "Lost item posted to the board." : "Found item posted to the board.");
      return item;
    } catch (e) {
      flash("Couldn't post item: " + e.message);
    }
  };
  const removeItem = async (id) => {
    await sbDeleteItem(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    setClaims((prev) => prev.filter((c) => c.itemId !== id));
  };

  const markNotifRead = async (id) => {
    await sbMarkNotifRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };
  const markAllRead = async (audienceKey) => {
    await sbMarkAllRead(audienceKey);
    setNotifications((prev) => prev.map((n) => (n.audience === audienceKey ? { ...n, read: true } : n)));
  };

  const submitClaim = async (item, message) => {
    try {
      const claim = await sbCreateClaim({
        itemId: item.id,
        itemTitle: item.title,
        claimant: { id: user.id, name: user.name, studentId: user.studentId, contact: user.contact },
        message,
      });
      setClaims((prev) => [claim, ...prev]);
      flash("Claim sent to admin for verification. You'll be notified once it's reviewed.");
    } catch (e) {
      flash("Couldn't send claim: " + e.message);
    }
  };
  const decideClaim = async (claim, decision) => {
    try {
      await sbDecideClaim(claim, decision);
      await loadAll();
      flash(decision === "approved" ? "Claim approved. Item marked resolved." : "Claim rejected.");
    } catch (e) {
      flash("Failed: " + e.message);
    }
  };

  const myNotifs = useMemo(() => {
    if (!user) return [];
    const key = user.role === "admin" ? "admin" : user.id;
    return notifications
      .filter((n) => n.audience === key)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [notifications, user]);

  const unreadCount = myNotifs.filter((n) => !n.read).length;

  if (booting) {
    return (
      <div style={{ ...styles.page, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
        <GlobalStyle />
        <span style={styles.loadingText}>Loading the board…</span>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onRegister={registerStudent} onLoginStudent={loginStudent} onLoginAdmin={loginAdmin} />;
  }

  return (
    <div style={styles.page}>
      <GlobalStyle />
      <Header user={user} unreadCount={unreadCount} onToggleNotif={() => setNotifOpen((v) => !v)} onLogout={logout} />

      {notifOpen && (
        <NotificationPanel
          notifs={myNotifs}
          onClose={() => setNotifOpen(false)}
          onMarkRead={markNotifRead}
          onMarkAll={() => markAllRead(user.role === "admin" ? "admin" : user.id)}
        />
      )}

      <NavTabs role={user.role} tab={tab} setTab={setTab} pendingCount={claims.filter((c) => c.status === "pending").length} />

      {toast && <div style={styles.toast}>{toast}</div>}

      <main style={styles.main}>
        {user.role === "student" && tab === "browse" && (
          <BrowseBoard items={items} user={user} onClaim={submitClaim} claims={claims} />
        )}
        {user.role === "student" && tab === "report" && (
          <ReportForm user={user} onSubmit={addItem} onDone={() => setTab("browse")} />
        )}
        {user.role === "student" && tab === "activity" && (
          <MyActivity user={user} items={items} claims={claims} onRemove={removeItem} />
        )}

        {user.role === "admin" && tab === "dashboard" && <AdminDashboard items={items} claims={claims} />}
        {user.role === "admin" && tab === "claims" && <ClaimsQueue claims={claims} items={items} onDecide={decideClaim} />}
        {user.role === "admin" && tab === "items" && <AdminItems items={items} onRemove={removeItem} />}
        {user.role === "admin" && tab === "history" && <HistoryLog items={items} claims={claims} />}
      </main>

      <footer style={styles.footer}>
        Board data is shared across everyone using this system — post only what's needed to reunite an item with its owner.
      </footer>
    </div>
  );
}

// ============ auth screen ============
function AuthScreen({ onRegister, onLoginStudent, onLoginAdmin }) {
  const [mode, setMode] = useState("student");
  const [studentMode, setStudentMode] = useState("register");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [contact, setContact] = useState("");
  const [loginId, setLoginId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submitRegister = async () => {
    setError("");
    if (!name.trim() || !contact.trim()) return setError("Enter your name and a way to contact you.");
    if (!STUDENT_ID_PATTERN.test(studentId.trim())) return setError("Student ID should look like 24-0187-667.");
    setBusy(true);
    const err = await onRegister({ name: name.trim(), studentId: studentId.trim(), contact: contact.trim() });
    setBusy(false);
    if (err) setError(err);
  };
  const submitLogin = async () => {
    setError("");
    if (!STUDENT_ID_PATTERN.test(loginId.trim())) return setError("Student ID should look like 24-0187-667.");
    setBusy(true);
    const err = await onLoginStudent(loginId.trim());
    setBusy(false);
    if (err) setError(err);
  };
  const submitAdmin = async () => {
    setError("");
    if (!staffId.trim() || !adminPassword.trim()) return setError("Enter your staff ID and password.");
    setBusy(true);
    const err = await onLoginAdmin({ staffId: staffId.trim(), password: adminPassword.trim() });
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div style={{ ...styles.page, minHeight: "100%" }}>
      <GlobalStyle />
      <div style={styles.authWrap}>
        <div style={styles.authCard}>
          <div style={styles.kicker}>Campus System</div>
          <h1 style={styles.authTitle}>Lost &amp; Found</h1>
          <p style={styles.authSub}>Your student ID is your account. Register once, then log in with it any time.</p>

          <div style={styles.typeSwitch}>
            <button style={{ ...styles.typeBtn, ...(mode === "student" ? styles.typeBtnActiveLost : {}) }} onClick={() => { setMode("student"); setError(""); }}>Student</button>
            <button style={{ ...styles.typeBtn, ...(mode === "admin" ? styles.typeBtnActiveFound : {}) }} onClick={() => { setMode("admin"); setError(""); }}>Admin</button>
          </div>

          {mode === "student" && (
            <>
              <div style={styles.subTabs}>
                <button style={{ ...styles.subTabBtn, ...(studentMode === "register" ? styles.subTabBtnActive : {}) }} onClick={() => { setStudentMode("register"); setError(""); }}>Register</button>
                <button style={{ ...styles.subTabBtn, ...(studentMode === "login" ? styles.subTabBtnActive : {}) }} onClick={() => { setStudentMode("login"); setError(""); }}>Log in</button>
              </div>

              {studentMode === "register" ? (
                <>
                  <label style={styles.label}>Full name
                    <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jamie Cruz" />
                  </label>
                  <label style={styles.label}>Student ID
                    <input style={styles.input} value={studentId} onChange={(e) => setStudentId(formatStudentId(e.target.value))} placeholder="24-0187-667" inputMode="numeric" />
                  </label>
                  <label style={styles.label}>Contact info
                    <input style={styles.input} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone" />
                  </label>
                  {error && <div style={styles.formError}>{error}</div>}
                  <button style={styles.submitBtnWide} disabled={busy} onClick={submitRegister}>{busy ? "Registering…" : "Register & continue"}</button>
                </>
              ) : (
                <>
                  <label style={styles.label}>Student ID
                    <input style={styles.input} value={loginId} onChange={(e) => setLoginId(formatStudentId(e.target.value))} placeholder="24-0187-667" inputMode="numeric" />
                  </label>
                  {error && <div style={styles.formError}>{error}</div>}
                  <button style={styles.submitBtnWide} disabled={busy} onClick={submitLogin}>{busy ? "Logging in…" : "Log in"}</button>
                </>
              )}
            </>
          )}

          {mode === "admin" && (
            <>
              <label style={styles.label}>Staff ID
                <input
                  style={styles.input}
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  placeholder="e.g. ADMIN-001"
                  autoFocus
                />
              </label>
              <label style={styles.label}>Password
                <input
                  style={styles.input}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Password"
                  type="password"
                  onKeyDown={(e) => { if (e.key === "Enter") submitAdmin(); }}
                />
              </label>
              {error && <div style={styles.formError}>{error}</div>}
              <button style={styles.submitBtnWide} disabled={busy} onClick={submitAdmin}>
                {busy ? "Entering…" : "Enter admin dashboard"}
              </button>
            </>
          )}

          <p style={styles.authNote}>This is a lightweight identity for the board, not a secured login — don't use a real password here.</p>
        </div>
      </div>
    </div>
  );
}

// ============ header + nav ============
function Header({ user, unreadCount, onToggleNotif, onLogout }) {
  return (
    <header style={styles.header}>
      <div style={styles.headerInner}>
        <div>
          <div style={styles.kicker}>{user.role === "admin" ? "Admin Console" : "Campus Board"}</div>
          <h1 style={styles.title}>Lost &amp; Found</h1>
        </div>
        <div style={styles.headerRight}>
          <button style={styles.bellBtn} onClick={onToggleNotif} aria-label="Notifications">
            🔔{unreadCount > 0 && <span style={styles.bellBadge}>{unreadCount}</span>}
          </button>
          <div style={styles.userChip}>
            <span style={styles.userName}>{user.name}</span>
            <span style={styles.userRole}>{user.role === "admin" ? "admin" : user.studentId}</span>
          </div>
          <button style={styles.logoutBtn} onClick={onLogout}>Log out</button>
        </div>
      </div>
    </header>
  );
}

function NavTabs({ role, tab, setTab, pendingCount }) {
  const studentTabs = [
    { key: "browse", label: "Browse Board" },
    { key: "report", label: "Report Item" },
    { key: "activity", label: "My Activity" },
  ];
  const adminTabs = [
    { key: "dashboard", label: "Dashboard" },
    { key: "claims", label: `Claims${pendingCount ? ` (${pendingCount})` : ""}` },
    { key: "items", label: "All Items" },
    { key: "history", label: "History Log" },
  ];
  const tabs = role === "admin" ? adminTabs : studentTabs;
  return (
    <div style={styles.navWrap}>
      <div style={styles.navInner}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ ...styles.tabBtn, ...(tab === t.key ? styles.tabBtnActive : {}) }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NotificationPanel({ notifs, onClose, onMarkRead, onMarkAll }) {
  return (
    <div style={styles.notifOverlay} onClick={onClose}>
      <div style={styles.notifPanel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.notifHeader}>
          <h3 style={styles.notifTitle}>Notifications</h3>
          <button style={styles.linkBtn} onClick={onMarkAll}>Mark all read</button>
        </div>
        {notifs.length === 0 ? (
          <div style={styles.emptyStateSmall}>Nothing here yet.</div>
        ) : (
          <div style={styles.notifList}>
            {notifs.map((n) => (
              <div key={n.id} style={{ ...styles.notifItem, opacity: n.read ? 0.6 : 1 }} onClick={() => onMarkRead(n.id)}>
                <div style={styles.notifItemTitle}>
                  {!n.read && <span style={styles.dot} />}
                  {n.title}
                </div>
                <div style={styles.notifItemBody}>{n.body}</div>
                <div style={styles.notifItemTime}>{timeAgo(n.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
        <button style={styles.closePanelBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ============ student: browse board ============
function BrowseBoard({ items, user, onClaim, claims }) {
  const [subTab, setSubTab] = useState("found");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [claimTarget, setClaimTarget] = useState(null);

  const myClaimedItemIds = claims.filter((c) => c.claimant.id === user.id).map((c) => c.itemId);

  const filtered = items.filter((it) => {
    if (it.type !== subTab) return false;
    if (it.status === "resolved") return false;
    if (category !== "All" && it.category !== category) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return it.title.toLowerCase().includes(q) || (it.description || "").toLowerCase().includes(q) || it.location.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <div style={styles.subTabs}>
        <button style={{ ...styles.subTabBtn, ...(subTab === "found" ? styles.subTabBtnActive : {}) }} onClick={() => setSubTab("found")}>Found items</button>
        <button style={{ ...styles.subTabBtn, ...(subTab === "lost" ? styles.subTabBtnActive : {}) }} onClick={() => setSubTab("lost")}>Lost items</button>
      </div>

      <div style={styles.filterRow}>
        <input style={styles.search} placeholder="Search by item, place, or detail…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select style={styles.select} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option>All</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyState}>{subTab === "found" ? "No found items match right now." : "No lost items match right now."}</div>
      ) : (
        <div style={styles.grid}>
          {filtered.map((it) => {
            const isMine = it.postedBy.id === user.id;
            const alreadyClaimed = myClaimedItemIds.includes(it.id);
            const pendingClaimsForItem = claims.filter((c) => c.itemId === it.id && c.status === "pending").length;
            return (
              <ItemCard key={it.id} item={it} pendingClaims={pendingClaimsForItem}>
                {it.type === "found" && !isMine && (
                  <button style={{ ...styles.resolveBtn, opacity: alreadyClaimed ? 0.6 : 1 }} disabled={alreadyClaimed} onClick={() => setClaimTarget(it)}>
                    {alreadyClaimed ? "Claim sent" : "This is mine — claim it"}
                  </button>
                )}
                {isMine && <div style={styles.mineTag}>Posted by you</div>}
              </ItemCard>
            );
          })}
        </div>
      )}

      {claimTarget && (
        <ClaimModal
          item={claimTarget}
          onCancel={() => setClaimTarget(null)}
          onSubmit={(msg) => { onClaim(claimTarget, msg); setClaimTarget(null); }}
        />
      )}
    </div>
  );
}

function ClaimModal({ item, onCancel, onSubmit }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Claim "{item.title}"</h2>
          <button style={styles.closeBtn} onClick={onCancel} aria-label="Close">×</button>
        </div>
        <p style={styles.modalHint}>Describe something that proves it's yours — a mark, a sticker, what's inside. The admin reviews this before releasing the item.</p>
        <label style={styles.label}>Proof of ownership
          <textarea style={{ ...styles.input, minHeight: 80, resize: "vertical" }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. It has a dented corner and a green case with my initials." />
        </label>
        {error && <div style={styles.formError}>{error}</div>}
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.submitBtn} onClick={() => {
            if (!message.trim()) return setError("Add a short description to help the admin verify it's yours.");
            onSubmit(message.trim());
          }}>Send to admin</button>
        </div>
      </div>
    </div>
  );
}

// ============ student: report form ============
function ReportForm({ user, onSubmit, onDone }) {
  const [type, setType] = useState("lost");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [image, setImage] = useState(null);
  const [imageError, setImageError] = useState("");
  const [processingImage, setProcessingImage] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleImagePick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setImageError("");
    setProcessingImage(true);
    try {
      const dataUrl = await readAndResizeImage(file);
      setImage(dataUrl);
    } catch (err) {
      setImageError(err.message || "Couldn't process that image.");
    }
    setProcessingImage(false);
  };

  const submit = async () => {
    if (!title.trim() || !location.trim()) return setError("Item and location are required.");
    setSaving(true);
    await onSubmit({
      type, title: title.trim(), description: description.trim(), location: location.trim(),
      category, contact: user.contact, image,
      postedBy: { id: user.id, name: user.name, studentId: user.studentId },
    });
    setSaving(false);
    onDone();
  };

  return (
    <div style={styles.formCard}>
      <h2 style={styles.sectionTitle}>Report an item</h2>
      <div style={styles.typeSwitch}>
        <button style={{ ...styles.typeBtn, ...(type === "lost" ? styles.typeBtnActiveLost : {}) }} onClick={() => setType("lost")}>I lost something</button>
        <button style={{ ...styles.typeBtn, ...(type === "found" ? styles.typeBtnActiveFound : {}) }} onClick={() => setType("found")}>I found something</button>
      </div>
      <label style={styles.label}>Item
        <input style={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Blue Hydro Flask" />
      </label>
      <label style={styles.label}>Description
        <textarea style={{ ...styles.input, minHeight: 64, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Color, stickers, condition, anything identifying…" />
      </label>
      <div style={styles.formRow}>
        <label style={{ ...styles.label, flex: 1 }}>{type === "lost" ? "Last seen near" : "Found near"}
          <input style={styles.input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Library, 2nd floor" />
        </label>
        <label style={{ ...styles.label, flex: 1 }}>Category
          <select style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label style={styles.label}>Photo <span style={styles.optionalTag}>(optional)</span>
        <input style={styles.fileInput} type="file" accept="image/*" onChange={handleImagePick} />
      </label>
      {processingImage && <div style={styles.imageHint}>Processing image…</div>}
      {imageError && <div style={styles.formError}>{imageError}</div>}
      {image && (
        <div style={styles.imagePreviewWrap}>
          <img src={image} alt="Item preview" style={styles.imagePreview} />
          <button style={styles.removeImageBtn} onClick={() => setImage(null)}>Remove photo</button>
        </div>
      )}
      {error && <div style={styles.formError}>{error}</div>}
      <button style={styles.submitBtnWide} disabled={saving} onClick={submit}>{saving ? "Posting…" : "Post to board"}</button>
    </div>
  );
}

// ============ student: my activity ============
function MyActivity({ user, items, claims, onRemove }) {
  const myPosts = items.filter((it) => it.postedBy.id === user.id);
  const myClaims = claims.filter((c) => c.claimant.id === user.id);

  return (
    <div>
      <h2 style={styles.sectionTitle}>My posts</h2>
      {myPosts.length === 0 ? (
        <div style={styles.emptyState}>You haven't posted anything yet.</div>
      ) : (
        <div style={styles.grid}>
          {myPosts.map((it) => (
            <ItemCard key={it.id} item={it}>
              {it.status !== "resolved" && <button style={styles.deleteBtn} onClick={() => onRemove(it.id)}>Remove post</button>}
            </ItemCard>
          ))}
        </div>
      )}

      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>My claims</h2>
      {myClaims.length === 0 ? (
        <div style={styles.emptyState}>You haven't claimed anything yet.</div>
      ) : (
        <div style={styles.claimList}>
          {myClaims.map((c) => (
            <div key={c.id} style={styles.claimRow}>
              <div>
                <div style={styles.claimItemTitle}>{c.itemTitle}</div>
                <div style={styles.claimMsg}>"{c.message}"</div>
                <div style={styles.cardTime}>{timeAgo(c.createdAt)}</div>
              </div>
              <span style={{ ...styles.statusTag, ...statusTagStyle(c.status) }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ admin: dashboard ============
function AdminDashboard({ items, claims }) {
  const openLost = items.filter((i) => i.type === "lost" && i.status !== "resolved").length;
  const openFound = items.filter((i) => i.type === "found" && i.status !== "resolved").length;
  const pendingClaims = claims.filter((c) => c.status === "pending").length;
  const resolved = items.filter((i) => i.status === "resolved").length;

  const stats = [
    { label: "Open lost reports", value: openLost, color: COLORS.rust },
    { label: "Open found reports", value: openFound, color: COLORS.mustard },
    { label: "Claims awaiting review", value: pendingClaims, color: COLORS.navy },
    { label: "Items resolved", value: resolved, color: COLORS.sage },
  ];

  const recentClaims = [...claims].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

  return (
    <div>
      <h2 style={styles.sectionTitle}>Overview</h2>
      <div style={styles.statGrid}>
        {stats.map((s) => (
          <div key={s.label} style={styles.statCard}>
            <div style={{ ...styles.statValue, color: s.color }}>{s.value}</div>
            <div style={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      <h2 style={{ ...styles.sectionTitle, marginTop: 30 }}>Recent claim activity</h2>
      {recentClaims.length === 0 ? (
        <div style={styles.emptyState}>No claims yet.</div>
      ) : (
        <div style={styles.claimList}>
          {recentClaims.map((c) => (
            <div key={c.id} style={styles.claimRow}>
              <div>
                <div style={styles.claimItemTitle}>{c.itemTitle}</div>
                <div style={styles.claimMsg}>{c.claimant.name} · {timeAgo(c.createdAt)}</div>
              </div>
              <span style={{ ...styles.statusTag, ...statusTagStyle(c.status) }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ admin: claims queue ============
function ClaimsQueue({ claims, items, onDecide }) {
  const pending = claims.filter((c) => c.status === "pending").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return (
    <div>
      <h2 style={styles.sectionTitle}>Claims awaiting verification</h2>
      {pending.length === 0 ? (
        <div style={styles.emptyState}>No claims to review right now.</div>
      ) : (
        <div style={styles.grid}>
          {pending.map((c) => {
            const item = items.find((it) => it.id === c.itemId);
            return (
              <div key={c.id} style={styles.claimCard}>
                <div style={styles.cardTop}>
                  <span style={{ ...styles.tag, background: COLORS.mustardTint, color: "#7A5A0E" }}>Claim</span>
                  <span style={styles.cardTime}>{timeAgo(c.createdAt)}</span>
                </div>
                <h3 style={styles.cardTitle}>{c.itemTitle}</h3>
                {item && item.image && (
                  <div style={styles.claimThumbWrap}>
                    <img src={item.image} alt={c.itemTitle} style={styles.claimThumb} />
                  </div>
                )}
                {item && <p style={styles.cardDesc}>Original post: {item.description || "—"} · {item.location}</p>}
                <div style={styles.cardMeta}>
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>Claimant</span>
                    <span>{c.claimant.name}{c.claimant.studentId ? ` (${c.claimant.studentId})` : ""}</span>
                  </div>
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>Contact</span>
                    <span>{c.claimant.contact}</span>
                  </div>
                </div>
                <div style={styles.proofBox}>"{c.message}"</div>
                <div style={styles.cardActions}>
                  <button style={styles.resolveBtn} onClick={() => onDecide(c, "approved")}>Approve &amp; release</button>
                  <button style={styles.deleteBtn} onClick={() => onDecide(c, "rejected")}>Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ admin: all items ============
function AdminItems({ items, onRemove }) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((it) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      it.title.toLowerCase().includes(q) ||
      it.location.toLowerCase().includes(q) ||
      it.postedBy.name.toLowerCase().includes(q) ||
      (it.postedBy.studentId || "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <h2 style={styles.sectionTitle}>All reports</h2>
      <input style={{ ...styles.search, marginBottom: 18 }} placeholder="Search by item, location, or reporter…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {filtered.length === 0 ? (
        <div style={styles.emptyState}>No reports match.</div>
      ) : (
        <div style={styles.grid}>
          {filtered.map((it) => (
            <ItemCard key={it.id} item={it} showReporter>
              <button style={styles.deleteBtn} onClick={() => onRemove(it.id)}>Remove</button>
            </ItemCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ admin: history log ============
function HistoryLog({ items, claims }) {
  const resolvedItems = items.filter((it) => it.status === "resolved").sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt));
  const decidedClaims = claims.filter((c) => c.status !== "pending").sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt));

  return (
    <div>
      <h2 style={styles.sectionTitle}>Resolved items</h2>
      {resolvedItems.length === 0 ? (
        <div style={styles.emptyState}>Nothing resolved yet.</div>
      ) : (
        <div style={styles.grid}>
          {resolvedItems.map((it) => <ItemCard key={it.id} item={it} showReporter />)}
        </div>
      )}

      <h2 style={{ ...styles.sectionTitle, marginTop: 30 }}>Claim decisions</h2>
      {decidedClaims.length === 0 ? (
        <div style={styles.emptyState}>No decisions logged yet.</div>
      ) : (
        <div style={styles.claimList}>
          {decidedClaims.map((c) => (
            <div key={c.id} style={styles.claimRow}>
              <div>
                <div style={styles.claimItemTitle}>{c.itemTitle}</div>
                <div style={styles.claimMsg}>{c.claimant.name} · {timeAgo(c.resolvedAt)}</div>
              </div>
              <span style={{ ...styles.statusTag, ...statusTagStyle(c.status) }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ shared item card ============
function ItemCard({ item, children, pendingClaims, showReporter }) {
  const isLost = item.type === "lost";
  return (
    <div style={{ ...styles.card, ...(item.image ? styles.cardWithImage : {}), borderTop: `5px solid ${isLost ? COLORS.rust : COLORS.mustard}` }}>
      {item.image && (
        <div style={styles.cardImageWrap}>
          <img src={item.image} alt={item.title} style={styles.cardImage} />
        </div>
      )}
      <div style={styles.cardBody}>
        <div style={styles.cardTop}>
          <span style={{ ...styles.tag, background: isLost ? COLORS.rustTint : COLORS.mustardTint, color: isLost ? COLORS.rust : "#7A5A0E" }}>
            {isLost ? "Lost" : "Found"}
          </span>
          <span style={styles.cardTime}>{timeAgo(item.postedAt)}</span>
        </div>
        <h3 style={styles.cardTitle}>{item.title}</h3>
        {item.description && <p style={styles.cardDesc}>{item.description}</p>}
        <div style={styles.cardMeta}>
          <div style={styles.metaRow}><span style={styles.metaLabel}>Where</span><span>{item.location}</span></div>
          <div style={styles.metaRow}><span style={styles.metaLabel}>Category</span><span>{item.category}</span></div>
          {showReporter && (
            <div style={styles.metaRow}>
              <span style={styles.metaLabel}>Reported by</span>
              <span>{item.postedBy.name}{item.postedBy.studentId ? ` (${item.postedBy.studentId})` : ""}</span>
            </div>
          )}
          {item.status === "resolved" && item.resolvedFor && (
            <div style={styles.metaRow}><span style={styles.metaLabel}>Released to</span><span>{item.resolvedFor}</span></div>
          )}
        </div>
        {pendingClaims > 0 && <div style={styles.pendingNote}>{pendingClaims} claim{pendingClaims > 1 ? "s" : ""} pending review</div>}
        {item.status === "resolved" ? <div style={styles.resolvedNote}>Resolved · {timeAgo(item.resolvedAt)}</div> : <div style={styles.cardActions}>{children}</div>}
      </div>
    </div>
  );
}

function statusTagStyle(status) {
  if (status === "approved") return { background: "#DCEBD8", color: COLORS.sage };
  if (status === "rejected") return { background: COLORS.rustTint, color: COLORS.rust };
  return { background: COLORS.mustardTint, color: "#7A5A0E" };
}

function GlobalStyle() {
  return (
    <style>{`
      @keyframes popIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      input:focus, select:focus, textarea:focus { outline: 2px solid #D9A62E; outline-offset: 1px; }
      ::placeholder { color: #9C8F79; }
      button { cursor: pointer; }
    `}</style>
  );
}

// ============ design tokens ============
const COLORS = {
  cork: "#C9A876", corkDark: "#B08E5F", paper: "#FAF6EC",
  ink: "#241C12", inkSoft: "#5C5140", navy: "#1E2A44",
  rust: "#B0472B", rustTint: "#F5DCD3",
  mustard: "#D9A62E", mustardTint: "#F7E9C6", sage: "#6B7A5E",
};

const sansFont = "system-ui, -apple-system, sans-serif";
const serifFont = "'Iowan Old Style','Palatino Linotype',Georgia,serif";

const styles = {
  page: {
    minHeight: "100%",
    background: `repeating-radial-gradient(circle at 20px 20px, ${COLORS.corkDark}22 0, ${COLORS.corkDark}22 2px, transparent 2px, transparent 100%), ${COLORS.cork}`,
    fontFamily: serifFont, color: COLORS.ink, paddingBottom: 40,
  },
  loadingText: { fontFamily: sansFont, color: "#3E2E17" },

  authWrap: { display: "flex", justifyContent: "center", padding: "60px 20px" },
  authCard: { background: COLORS.paper, borderRadius: 14, padding: 32, maxWidth: 420, width: "100%", boxShadow: "0 16px 40px rgba(20,14,8,0.25)" },
  authTitle: { fontSize: 32, margin: "2px 0 8px", color: COLORS.navy },
  authSub: { fontFamily: sansFont, fontSize: 14, color: COLORS.inkSoft, marginBottom: 20, lineHeight: 1.5 },
  authNote: { fontFamily: sansFont, fontSize: 12, color: COLORS.inkSoft, opacity: 0.75, marginTop: 12, lineHeight: 1.5 },
  optionalTag: { fontWeight: 400, opacity: 0.7, fontSize: 12 },
  submitBtnWide: { fontFamily: sansFont, width: "100%", background: COLORS.navy, color: "#F5F1E4", border: "none", borderRadius: 8, padding: "12px 16px", fontSize: 15, fontWeight: 700, marginTop: 6 },

  header: { padding: "24px 20px 14px" },
  headerInner: { maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  kicker: { fontFamily: sansFont, fontSize: 13, letterSpacing: "0.02em", color: "#3E2E17", fontWeight: 600, opacity: 0.75, marginBottom: 2 },
  title: { fontSize: 36, margin: 0, fontWeight: 700, color: COLORS.navy, letterSpacing: "-0.01em" },
  bellBtn: { position: "relative", background: COLORS.paper, border: `1px solid rgba(36,28,18,0.2)`, borderRadius: 8, padding: "8px 12px", fontSize: 16 },
  bellBadge: { position: "absolute", top: -6, right: -6, background: COLORS.rust, color: "#fff", borderRadius: 999, fontSize: 10, fontFamily: sansFont, fontWeight: 700, padding: "1px 5px" },
  userChip: { display: "flex", flexDirection: "column", alignItems: "flex-end", fontFamily: sansFont, lineHeight: 1.2 },
  userName: { fontSize: 13.5, fontWeight: 700, color: COLORS.navy },
  userRole: { fontSize: 11, color: COLORS.inkSoft, textTransform: "capitalize" },
  logoutBtn: { fontFamily: sansFont, background: "transparent", border: `1px solid rgba(36,28,18,0.25)`, borderRadius: 8, padding: "8px 14px", fontSize: 13, color: COLORS.inkSoft },

  navWrap: { padding: "0 20px" },
  navInner: { maxWidth: 1080, margin: "0 auto", display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 },
  tabBtn: { fontFamily: sansFont, background: "rgba(250,246,236,0.55)", border: `1px solid rgba(36,28,18,0.18)`, borderRadius: 999, padding: "8px 16px", fontSize: 14, fontWeight: 600, color: COLORS.inkSoft },
  tabBtnActive: { background: COLORS.navy, color: "#F5F1E4", borderColor: COLORS.navy },

  subTabs: { display: "flex", gap: 8, marginBottom: 16 },
  subTabBtn: { fontFamily: sansFont, background: "transparent", border: `1px solid rgba(36,28,18,0.25)`, borderRadius: 8, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, color: COLORS.inkSoft },
  subTabBtnActive: { background: COLORS.paper, borderColor: COLORS.navy, color: COLORS.navy },

  toast: { maxWidth: 1080, margin: "0 auto 14px", background: "#DCEBD8", color: "#3A5535", fontFamily: sansFont, fontSize: 13.5, padding: "10px 16px", borderRadius: 8, animation: "slideIn 0.2s ease" },

  main: { maxWidth: 1080, margin: "0 auto", padding: "0 20px" },
  sectionTitle: { fontSize: 22, color: COLORS.navy, margin: "0 0 14px" },

  filterRow: { display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" },
  search: { fontFamily: sansFont, flex: "1 1 240px", padding: "10px 14px", borderRadius: 8, border: `1px solid rgba(36,28,18,0.2)`, background: COLORS.paper, fontSize: 14.5, color: COLORS.ink },
  select: { fontFamily: sansFont, padding: "10px 14px", borderRadius: 8, border: `1px solid rgba(36,28,18,0.2)`, background: COLORS.paper, fontSize: 14.5, color: COLORS.ink },

  emptyState: { fontFamily: sansFont, textAlign: "center", padding: "50px 20px", color: "#3E2E17", opacity: 0.75, fontSize: 15 },
  emptyStateSmall: { fontFamily: sansFont, textAlign: "center", padding: "30px 10px", color: "#3E2E17", opacity: 0.7, fontSize: 13.5 },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 22, animation: "popIn 0.25s ease" },

  card: { position: "relative", background: COLORS.paper, borderRadius: 8, padding: "18px 18px 16px", boxShadow: "0 8px 16px rgba(20,14,8,0.16)", overflow: "hidden" },
  cardWithImage: { padding: 0 },
  cardBody: { padding: "16px 18px 16px" },
  cardImageWrap: { width: "100%", height: 160, background: COLORS.corkDark + "22" },
  cardImage: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  claimCard: { position: "relative", background: COLORS.paper, borderRadius: 8, padding: "18px 18px 16px", boxShadow: "0 8px 16px rgba(20,14,8,0.16)", borderTop: `5px solid ${COLORS.navy}` },
  claimThumbWrap: { marginBottom: 10, borderRadius: 6, overflow: "hidden" },
  claimThumb: { width: "100%", maxHeight: 140, objectFit: "cover", display: "block" },
  fileInput: { display: "block", width: "100%", marginTop: 6, fontFamily: sansFont, fontSize: 13.5, color: COLORS.inkSoft },
  imageHint: { fontFamily: sansFont, fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 10 },
  imagePreviewWrap: { marginBottom: 14 },
  imagePreview: { width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, display: "block", marginBottom: 8 },
  removeImageBtn: { fontFamily: sansFont, background: "transparent", border: `1px solid rgba(36,28,18,0.25)`, borderRadius: 6, padding: "6px 12px", fontSize: 12.5, color: COLORS.inkSoft },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontFamily: sansFont },
  tag: { fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999 },
  cardTime: { fontSize: 12, color: COLORS.inkSoft, fontFamily: sansFont },
  cardTitle: { margin: "0 0 6px", fontSize: 18, color: COLORS.navy },
  cardDesc: { margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: COLORS.inkSoft, fontFamily: sansFont },
  cardMeta: { fontFamily: sansFont, borderTop: `1px dashed rgba(36,28,18,0.25)`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 },
  metaRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: COLORS.ink, gap: 10 },
  metaLabel: { color: COLORS.inkSoft, fontWeight: 600 },
  pendingNote: { fontFamily: sansFont, fontSize: 12, color: COLORS.rust, fontWeight: 600, marginBottom: 10 },
  cardActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  resolveBtn: { fontFamily: sansFont, flex: 1, background: COLORS.sage, color: "#fff", border: "none", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontWeight: 600 },
  deleteBtn: { fontFamily: sansFont, background: "transparent", color: COLORS.inkSoft, border: `1px solid rgba(36,28,18,0.25)`, borderRadius: 6, padding: "8px 10px", fontSize: 13 },
  resolvedNote: { fontFamily: sansFont, fontSize: 13, fontWeight: 600, color: COLORS.sage },
  mineTag: { fontFamily: sansFont, fontSize: 12.5, color: COLORS.inkSoft, fontStyle: "italic" },
  proofBox: { fontFamily: sansFont, fontSize: 13.5, fontStyle: "italic", color: COLORS.ink, background: "rgba(217,166,46,0.12)", borderRadius: 6, padding: "10px 12px", marginBottom: 12 },

  claimList: { display: "flex", flexDirection: "column", gap: 10 },
  claimRow: { background: COLORS.paper, borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: sansFont, boxShadow: "0 4px 10px rgba(20,14,8,0.1)" },
  claimItemTitle: { fontSize: 14.5, fontWeight: 700, color: COLORS.navy },
  claimMsg: { fontSize: 13, color: COLORS.inkSoft, marginTop: 2 },
  statusTag: { fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 999, textTransform: "capitalize" },

  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 },
  statCard: { background: COLORS.paper, borderRadius: 10, padding: "20px 18px", boxShadow: "0 6px 14px rgba(20,14,8,0.14)" },
  statValue: { fontSize: 32, fontWeight: 700 },
  statLabel: { fontFamily: sansFont, fontSize: 13, color: COLORS.inkSoft, marginTop: 4 },

  formCard: { background: COLORS.paper, borderRadius: 10, padding: 24, maxWidth: 520, boxShadow: "0 10px 24px rgba(20,14,8,0.16)" },
  typeSwitch: { display: "flex", gap: 8, marginBottom: 16 },
  typeBtn: { fontFamily: sansFont, flex: 1, padding: "10px 8px", borderRadius: 8, border: `1px solid rgba(36,28,18,0.2)`, background: "#fff", fontSize: 14, fontWeight: 600, color: COLORS.inkSoft },
  typeBtnActiveLost: { background: COLORS.rustTint, borderColor: COLORS.rust, color: COLORS.rust },
  typeBtnActiveFound: { background: COLORS.mustardTint, borderColor: COLORS.mustard, color: "#7A5A0E" },
  label: { display: "block", fontFamily: sansFont, fontSize: 13, fontWeight: 600, color: COLORS.inkSoft, marginBottom: 12 },
  input: { display: "block", width: "100%", marginTop: 6, padding: "9px 11px", borderRadius: 7, border: `1px solid rgba(36,28,18,0.22)`, fontSize: 14.5, fontFamily: sansFont, color: COLORS.ink, background: "#fff", boxSizing: "border-box" },
  formRow: { display: "flex", gap: 12 },
  formError: { fontFamily: sansFont, fontSize: 13, color: COLORS.rust, marginBottom: 10 },

  overlay: { position: "fixed", inset: 0, background: "rgba(20,14,8,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 },
  modal: { background: COLORS.paper, borderRadius: 12, padding: 24, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.35)", fontFamily: sansFont },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalTitle: { margin: 0, fontSize: 19, fontFamily: serifFont, color: COLORS.navy },
  modalHint: { fontSize: 13, color: COLORS.inkSoft, marginBottom: 14, lineHeight: 1.5 },
  closeBtn: { background: "none", border: "none", fontSize: 24, lineHeight: 1, color: COLORS.inkSoft },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  cancelBtn: { fontFamily: sansFont, background: "transparent", border: `1px solid rgba(36,28,18,0.25)`, borderRadius: 7, padding: "9px 16px", fontSize: 14, fontWeight: 600, color: COLORS.inkSoft },
  submitBtn: { fontFamily: sansFont, background: COLORS.navy, border: "none", borderRadius: 7, padding: "9px 18px", fontSize: 14, fontWeight: 700, color: "#F5F1E4" },

  notifOverlay: { position: "fixed", inset: 0, zIndex: 40 },
  notifPanel: { position: "absolute", top: 78, right: 20, background: COLORS.paper, borderRadius: 10, padding: 16, width: 320, maxHeight: "70vh", overflowY: "auto", boxShadow: "0 16px 34px rgba(0,0,0,0.3)", fontFamily: sansFont, animation: "slideIn 0.18s ease" },
  notifHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  notifTitle: { margin: 0, fontSize: 16, color: COLORS.navy },
  linkBtn: { background: "none", border: "none", fontSize: 12.5, color: COLORS.sage, fontWeight: 600 },
  notifList: { display: "flex", flexDirection: "column", gap: 8 },
  notifItem: { background: "#fff", borderRadius: 8, padding: "10px 12px", cursor: "pointer" },
  notifItemTitle: { fontSize: 13.5, fontWeight: 700, color: COLORS.navy, display: "flex", alignItems: "center", gap: 6 },
  notifItemBody: { fontSize: 12.5, color: COLORS.inkSoft, marginTop: 3, lineHeight: 1.4 },
  notifItemTime: { fontSize: 11, color: COLORS.inkSoft, opacity: 0.7, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: "50%", background: COLORS.rust, display: "inline-block" },
  closePanelBtn: { fontFamily: sansFont, width: "100%", marginTop: 12, background: "transparent", border: `1px solid rgba(36,28,18,0.25)`, borderRadius: 7, padding: "8px", fontSize: 13, color: COLORS.inkSoft },

  footer: { maxWidth: 1080, margin: "20px auto 0", padding: "0 20px", textAlign: "center", fontFamily: sansFont, fontSize: 12.5, color: "#3E2E17", opacity: 0.65 },
};