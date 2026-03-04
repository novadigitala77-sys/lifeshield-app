import { useState, useEffect, useRef } from "react";



// ─── MOCK DATA ──────────────────────────────────────────────────────────────
const mockLeads = [
  { id: 1, name: "Carlos Mendoza", phone: "(407) 555-0192", email: "carlos@email.com", state: "FL", age: 38, smoker: false, goal: "Familia", budget: "$50–$100", contact: "Zoom", urgency: "Esta semana", source: "Web", score: "hot", status: "Cita", date: "28 Feb", nextAction: "Cita mañana 2PM", flags: ["Presupuesto ideal", "No fumador"], history: [{ icon: "📋", title: "Lead creado", time: "28 Feb 10:02" }, { icon: "✉️", title: "Bienvenida enviada", time: "28 Feb 10:02" }, { icon: "📅", title: "Cita agendada: 1 Mar 2PM", time: "28 Feb 11:15" }, { icon: "🔔", title: "Recordatorio enviado", time: "1 Mar 12:00" }] },
  { id: 2, name: "María García", phone: "(305) 555-0847", email: "maria@email.com", state: "FL", age: 52, smoker: false, goal: "Gastos finales", budget: "$25–$50", contact: "Llamada", urgency: "Esta semana", source: "Instagram", score: "warm", status: "Contactado", date: "27 Feb", nextAction: "Follow-up 72h", flags: ["Edad 52 → Final Expenses", "Presupuesto bajo"], history: [{ icon: "📋", title: "Lead creado", time: "27 Feb 14:30" }, { icon: "✉️", title: "Bienvenida enviada", time: "27 Feb 14:30" }, { icon: "📱", title: "Recordatorio 24h enviado", time: "28 Feb 14:30" }] },
  { id: 3, name: "Roberto Jiménez", phone: "(786) 555-0234", email: "", state: "TX", age: 44, smoker: true, goal: "Negocio", budget: "$100+", contact: "WhatsApp", urgency: "Hoy", source: "Landing #2", score: "hot", status: "Propuesta", date: "1 Mar", nextAction: "Enviar propuesta", flags: ["Fumador → Productos especiales", "Presupuesto alto ✓", "Urgencia alta"], history: [{ icon: "📋", title: "Lead creado", time: "1 Mar 09:00" }, { icon: "✉️", title: "Bienvenida enviada", time: "1 Mar 09:00" }, { icon: "📅", title: "Cita agendada: 1 Mar 4PM", time: "1 Mar 09:45" }, { icon: "✅", title: "Documentos completos", time: "1 Mar 15:30" }] },
  { id: 4, name: "Ana Pérez", phone: "(954) 555-0561", email: "ana@email.com", state: "FL", age: 29, smoker: false, goal: "Hipoteca", budget: "$50–$100", contact: "Llamada", urgency: "Solo información", source: "Facebook", score: "cold", status: "Nuevo", date: "2 Mar", nextAction: "Seguimiento 24h", flags: ["Baja urgencia"], history: [{ icon: "📋", title: "Lead creado", time: "2 Mar 08:15" }, { icon: "✉️", title: "Bienvenida enviada", time: "2 Mar 08:15" }] },
  { id: 5, name: "Luis Torres", phone: "(321) 555-0723", email: "luis@email.com", state: "GA", age: 56, smoker: true, goal: "Familia", budget: "$100+", contact: "Zoom", urgency: "Esta semana", source: "Web", score: "warm", status: "Cita", date: "26 Feb", nextAction: "Post-cita follow-up", flags: ["Fumador 56 años → verificar opciones", "Presupuesto alto"], history: [{ icon: "📋", title: "Lead creado", time: "26 Feb" }, { icon: "📅", title: "Cita realizada", time: "1 Mar 3PM" }] },
  { id: 6, name: "Sandra Ruiz", phone: "(561) 555-0918", email: "sandra@email.com", state: "FL", age: 35, smoker: false, goal: "Familia", budget: "$50–$100", contact: "Zoom", urgency: "Esta semana", source: "Web", score: "hot", status: "Cerrado", date: "20 Feb", nextAction: "—", flags: [], history: [{ icon: "🎉", title: "Póliza cerrada", time: "28 Feb" }] },
];

const pipelineStages = ["Nuevo", "Contactado", "Cita", "Propuesta", "Cerrado", "Perdido"];

const scoreColors = { hot: "var(--red)", warm: "var(--amber)", cold: "var(--slate)" };
const scoreLabels = { hot: "Caliente", warm: "Tibio", cold: "Frío" };

// ─── COMPONENTS ─────────────────────────────────────────────────────────────

function ScoreBadge({ score }) {
  const cls = { hot: "badge-hot", warm: "badge-warm", cold: "badge-cold" }[score];
  const icons = { hot: "🔥", warm: "☀️", cold: "🧊" };
  return <span className={`badge ${cls}`}>{icons[score]} {scoreLabels[score]}</span>;
}

function StatusBadge({ status }) {
  const cls = { Nuevo: "badge-new", Contactado: "badge-cited", Cita: "badge-cited", Propuesta: "badge-warm", Cerrado: "badge-closed", Perdido: "badge-lost" };
  return <span className={`badge ${cls[status] || "badge-new"}`}>{status}</span>;
}

// ─── CLIENT CHAT/FORM ────────────────────────────────────────────────────────
function ClientChat({ onComplete }) {
  const [step, setStep] = useState(0);
  const [messages, setMessages] = useState([{ from: "bot", text: "Hola 👋 Soy el asistente virtual de seguros de vida. ¡En 2 minutos te preparo una cotización personalizada! ¿Me compartes tu nombre completo?" }]);
  const [input, setInput] = useState("");
  const [formData, setFormData] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [typing, setTyping] = useState(false);
  const chatRef = useRef(null);

  const questions = [
    { key: "name", ask: "¿Y tu número de teléfono para contactarte?" },
    { key: "phone", ask: "Perfecto. ¿En qué estado (USA) vives?" },
    { key: "state", ask: "¿Me dices tu rango de edad?" },
    { key: "age", ask: "¿Cuál es tu objetivo principal con el seguro de vida?", quickReplies: ["Proteger mi familia", "Cubrir hipoteca", "Proteger mi negocio", "Gastos finales"] },
  ];

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, typing]);

  const addBotMsg = (text, delay = 800) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages(m => [...m, { from: "bot", text }]);
    }, delay);
  };

  const handleSend = (val) => {
    const v = val || input;
    if (!v.trim()) return;
    const curr = questions[step];
    const newData = { ...formData, [curr.key]: v };
    setFormData(newData);
    setMessages(m => [...m, { from: "user", text: v }]);
    setInput("");

    if (step < questions.length - 1) {
      addBotMsg(questions[step + 1].ask);
      setStep(s => s + 1);
    } else {
      addBotMsg("¡Excelente! Para terminar, necesito un par de datos más para tu perfil.", 600);
      setTimeout(() => setShowForm(true), 1200);
      setStep(s => s + 1);
    }
  };

  if (showForm) return <ClientForm initialData={formData} onComplete={onComplete} />;

  return (
    <div className="client-app fade-in">
      <div className="client-card">
        <div className="client-logo">
          <h1>LifeShield Pro</h1>
          <p>Tu cotización de seguro de vida — rápido y sin complicaciones</p>
        </div>
        <div className="chat-container" ref={chatRef}>
          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.from} fade-in`}>
              <div className="bubble-inner">{m.text}</div>
              <div className="chat-time">{m.from === "bot" ? "🤖 Asistente" : "Tú"}</div>
            </div>
          ))}
          {typing && (
            <div className="chat-bubble bot">
              <div className="bubble-inner typing" style={{ color: "var(--slate)" }}>● ● ●</div>
            </div>
          )}
        </div>
        {step < questions.length && questions[step].quickReplies && (
          <div className="radio-group mb-16" style={{ marginTop: 8 }}>
            {questions[step].quickReplies.map(r => (
              <div key={r} className="radio-card" onClick={() => handleSend(r)}>{r}</div>
            ))}
          </div>
        )}
        <div className="flex gap-8">
          <input className="form-input" style={{ flex: 1 }} placeholder="Escribe tu respuesta..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()} />
          <button className="btn btn-primary" onClick={() => handleSend()}>→</button>
        </div>
      </div>
    </div>
  );
}

// ─── CLIENT FORM (rest of fields) ────────────────────────────────────────────
function ClientForm({ initialData, onComplete }) {
  const [data, setData] = useState({ smoker: "No", goal: initialData.goal || "Familia", budget: "$50–$100", contact: "Zoom", urgency: "Esta semana", ...initialData });
  const [submitted, setSubmitted] = useState(false);

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  if (submitted) return <ClientConfirmation data={data} onSchedule={onComplete} />;

  return (
    <div className="client-app fade-in">
      <div className="client-card">
        <div className="client-logo">
          <h1>LifeShield Pro</h1>
          <p>Paso final — cuéntame un poco más</p>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">¿Fumas?</label>
            <div className="radio-group">
              {["Sí", "No"].map(v => <div key={v} className={`radio-card ${data.smoker === v ? "selected" : ""}`} onClick={() => set("smoker", v)}>{v}</div>)}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Presupuesto mensual</label>
            <select className="form-input form-select" value={data.budget} onChange={e => set("budget", e.target.value)}>
              {["$25–$50", "$50–$100", "$100+"].map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Preferencia de contacto</label>
          <div className="radio-group">
            {["Llamada", "Zoom", "WhatsApp"].map(v => <div key={v} className={`radio-card ${data.contact === v ? "selected" : ""}`} onClick={() => set("contact", v)}>{v}</div>)}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">¿Cuándo quieres hablar?</label>
          <div className="radio-group">
            {["Hoy", "Esta semana", "Solo información"].map(v => <div key={v} className={`radio-card ${data.urgency === v ? "selected" : ""}`} onClick={() => set("urgency", v)}>{v}</div>)}
          </div>
        </div>
        <div className="form-group mb-20">
          <label className="form-label">Email (opcional)</label>
          <input className="form-input" placeholder="tu@email.com" value={data.email || ""} onChange={e => set("email", e.target.value)} />
        </div>
        <button className="btn btn-primary w100" style={{ justifyContent: "center", padding: "13px" }} onClick={() => setSubmitted(true)}>
          Obtener mi cotización →
        </button>
      </div>
    </div>
  );
}

// ─── CLIENT CONFIRMATION + CALENDAR ─────────────────────────────────────────
function ClientConfirmation({ data, onSchedule }) {
  const [step, setStep] = useState(0); // 0=confirm, 1=calendar, 2=done
  const [selDay, setSelDay] = useState(null);
  const [selTime, setSelTime] = useState(null);

  const days = ["D", "L", "M", "X", "J", "V", "S"];
  const calDays = Array.from({ length: 35 }, (_, i) => {
    const d = i - 4; // offset
    return d >= 1 && d <= 31 ? d : null;
  });
  const times = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM"];
  const unavailable = [1, 4, 7];

  const score = data.urgency === "Hoy" || data.budget === "$100+" ? "hot" : data.urgency === "Esta semana" ? "warm" : "cold";

  if (step === 2) {
    return (
      <div className="client-app fade-in">
        <div className="client-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h2 style={{ color: "var(--gold)", marginBottom: 8 }}>¡Cita confirmada!</h2>
          <p className="text-slate mb-16">Tu cita es el {selDay} de Marzo a las {selTime}</p>
          <div className="card card-sm" style={{ background: "rgba(61,184,122,0.08)", border: "1px solid rgba(61,184,122,0.2)", marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: "var(--green)" }}>✅ Recibirás confirmación por {data.contact}</p>
            <p style={{ fontSize: 13, color: "var(--green)", marginTop: 4 }}>🔔 Te enviaremos recordatorio 24h y 2h antes</p>
          </div>
          <button className="btn btn-ghost w100" style={{ justifyContent: "center" }} onClick={() => setStep(0)}>
            📋 Ver mi checklist de documentos
          </button>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="client-app fade-in">
        <div className="client-card">
          <div className="client-logo">
            <h1>Agenda tu cita</h1>
            <p>Elige el día y hora que mejor te convenga</p>
          </div>
          <p className="section-title">Marzo 2026</p>
          <div className="calendar-grid">
            {days.map(d => <div key={d} className="cal-day" style={{ fontSize: 10, color: "var(--slate)", cursor: "default" }}>{d}</div>)}
            {calDays.map((d, i) => (
              <div key={i} className={`cal-day ${!d ? "cal-empty" : d < 2 ? "cal-past" : selDay === d ? "cal-selected" : ""}`} onClick={() => d && d >= 2 && setSelDay(d)}>
                {d || ""}
              </div>
            ))}
          </div>
          {selDay && (
            <>
              <p className="section-title" style={{ marginTop: 16 }}>Horarios disponibles — {selDay} Mar</p>
              <div className="time-slots">
                {times.map((t, i) => (
                  <div key={t} className={`time-slot ${unavailable.includes(i) ? "unavailable" : selTime === t ? "selected" : ""}`} onClick={() => !unavailable.includes(i) && setSelTime(t)}>{t}</div>
                ))}
              </div>
            </>
          )}
          <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setStep(0)}>← Atrás</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={!selDay || !selTime} onClick={() => setStep(2)}>
              Confirmar cita →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="client-app fade-in">
      <div className="client-card">
        <div className="client-logo">
          <h1 style={{ color: "var(--green)" }}>¡Listo, {data.name?.split(" ")[0]}! 🎯</h1>
          <p>Tu perfil ha sido creado exitosamente</p>
        </div>
        <div className="card card-sm mb-16" style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)" }}>
          <div className="flex items-center gap-8 mb-8">
            <ScoreBadge score={score} />
            <span style={{ fontSize: 12, color: "var(--slate)" }}>Perfil de prioridad</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--smoke)" }}>Objetivo: <strong>{data.goal}</strong> · Presupuesto: <strong>{data.budget}/mes</strong></p>
        </div>
        <div className="card card-sm mb-20" style={{ background: "rgba(61,184,122,0.06)", border: "1px solid rgba(61,184,122,0.15)" }}>
          <p style={{ fontSize: 13, color: "var(--green)" }}>✅ Te enviaremos opciones de cotización en las próximas 2 horas</p>
        </div>
        <button className="btn btn-primary w100" style={{ justifyContent: "center", padding: "13px", marginBottom: 10 }} onClick={() => setStep(1)}>
          📅 Agendar cita ahora
        </button>
        <button className="btn btn-ghost w100" style={{ justifyContent: "center" }} onClick={onSchedule}>
          Prefiero que me contacten
        </button>
      </div>
    </div>
  );
}

// ─── AGENT LOGIN ─────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("agente@lifeshield.com");
  const [pass, setPass] = useState("••••••••");
  return (
    <div className="login-page fade-in">
      <div className="login-card">
        <h1>LifeShield Pro</h1>
        <p>Panel del Agente — Acceso seguro</p>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-input" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 28 }}>
          <label className="form-label">Contraseña</label>
          <input className="form-input" type="password" value={pass} onChange={e => setPass(e.target.value)} />
        </div>
        <button className="btn btn-primary w100" style={{ justifyContent: "center", padding: "13px", fontSize: "15px" }} onClick={onLogin}>
          Entrar al panel →
        </button>
        <p className="text-slate" style={{ textAlign: "center", marginTop: 20, fontSize: 12 }}>Demo: cualquier contraseña funciona</p>
      </div>
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ onLeadClick }) {
  const [filter, setFilter] = useState("Todos");
  const [search, setSearch] = useState("");

  const stats = [
    { label: "Leads este mes", value: "47", delta: "+12%", up: true },
    { label: "Citas agendadas", value: "23", delta: "+8%", up: true },
    { label: "Tasa de asistencia", value: "78%", delta: "+3%", up: true },
    { label: "Pólizas cerradas", value: "9", delta: "-2", up: false },
  ];

  const pipeData = [
    { label: "Nuevo", count: 8, color: "#3db87a" },
    { label: "Contactado", count: 12, color: "#e8a33b" },
    { label: "Cita", count: 14, color: "#c9a84c" },
    { label: "Propuesta", count: 7, color: "#e05252" },
    { label: "Cerrado", count: 6, color: "#5b8dee" },
  ];
  const total = pipeData.reduce((a, b) => a + b.count, 0);

  const filters = ["Todos", "Caliente", "Tibio", "Frío", "Nuevo", "Cita"];
  const filtered = mockLeads.filter(l => {
    const matchFilter = filter === "Todos" || scoreLabels[l.score] === filter || l.status === filter;
    const matchSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) || l.phone.includes(search);
    return matchFilter && matchSearch;
  });

  return (
    <div className="page fade-in">
      {/* Stats */}
      <div className="stats-grid">
        {stats.map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className={`stat-delta ${s.up ? "delta-up" : "delta-down"}`}>{s.delta} vs mes anterior</div>
          </div>
        ))}
      </div>

      {/* Pipeline visual */}
      <div className="card mb-20">
        <div className="flex items-center justify-between mb-16">
          <p className="section-title" style={{ marginBottom: 0 }}>Pipeline del mes</p>
          <span className="text-slate text-sm">{total} leads activos</span>
        </div>
        <div className="pipeline">
          {pipeData.map(p => (
            <div key={p.label} className="pipe-seg" style={{ flex: p.count, background: p.color, opacity: 0.8 }} />
          ))}
        </div>
        <div className="flex gap-12" style={{ marginTop: 8, flexWrap: "wrap" }}>
          {pipeData.map(p => (
            <div key={p.label} className="flex items-center gap-8">
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
              <span className="text-slate text-sm">{p.label} ({p.count})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Leads list */}
      <div className="card">
        <div className="leads-header">
          <div className="filters">
            {filters.map(f => (
              <button key={f} className={`filter-chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="search-bar">
            <span style={{ color: "var(--slate)" }}>🔍</span>
            <input placeholder="Buscar lead..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Fuente</th>
              <th>Fecha</th>
              <th>Próxima acción</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => (
              <tr key={l.id} onClick={() => onLeadClick(l)}>
                <td><strong style={{ color: "var(--white)" }}>{l.name}</strong></td>
                <td className="text-mono" style={{ fontSize: 12 }}>{l.phone}</td>
                <td><ScoreBadge score={l.score} /></td>
                <td><StatusBadge status={l.status} /></td>
                <td><span className="text-slate">{l.source}</span></td>
                <td className="text-mono" style={{ fontSize: 12, color: "var(--slate)" }}>{l.date}</td>
                <td><span style={{ fontSize: 12 }}>{l.nextAction}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── LEAD DETAIL ─────────────────────────────────────────────────────────────
function LeadDetail({ lead, onBack }) {
  const [status, setStatus] = useState(lead.status);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState([]);
  const [activeTab, setActiveTab] = useState("perfil");

  const scoreVal = { hot: 90, warm: 55, cold: 25 }[lead.score];
  const scoreColor = scoreColors[lead.score];

  const stageIdx = pipelineStages.indexOf(status);

  return (
    <div className="page fade-in">
      <button className="btn btn-ghost btn-sm mb-20" onClick={onBack}>← Volver al dashboard</button>

      <div className="lead-detail">
        {/* Left column */}
        <div>
          <div className="card mb-20">
            <div className="profile-header">
              <div className="avatar">{lead.name.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
              <div className="profile-info">
                <h2>{lead.name}</h2>
                <div className="profile-meta">
                  <span>📱 {lead.phone}</span>
                  {lead.email && <span>✉️ {lead.email}</span>}
                  <span>📍 {lead.state}</span>
                  <span>🎂 {lead.age} años</span>
                  <span>{lead.smoker ? "🚬 Fumador" : "✅ No fumador"}</span>
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <ScoreBadge score={lead.score} />
              </div>
            </div>

            {/* Pipeline stages */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {pipelineStages.map((s, i) => (
                <button key={s} onClick={() => setStatus(s)}
                  style={{
                    padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                    border: "1px solid", fontFamily: "DM Sans",
                    borderColor: i === stageIdx ? scoreColor : "rgba(255,255,255,0.1)",
                    background: i === stageIdx ? `${scoreColor}25` : "transparent",
                    color: i === stageIdx ? scoreColor : "var(--slate)",
                    fontWeight: i === stageIdx ? 600 : 400,
                  }}>
                  {i < stageIdx ? "✓ " : ""}{s}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs">
            {["perfil", "historial", "documentos"].map(t => (
              <button key={t} className={`tab ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                {t === "perfil" ? "📋 Perfil" : t === "historial" ? "📅 Historial" : "📎 Documentos"}
              </button>
            ))}
          </div>

          {activeTab === "perfil" && (
            <div className="card fade-in">
              <p className="section-title">Detalles del lead</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 20 }}>
                {[["Objetivo", lead.goal], ["Presupuesto", lead.budget], ["Contacto preferido", lead.contact], ["Urgencia", lead.urgency], ["Fuente", lead.source], ["Fecha ingreso", lead.date]].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-slate text-sm mb-4">{k}</div>
                    <div style={{ fontWeight: 500, color: "var(--white)" }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="divider" />
              <p className="section-title">Score de prioridad</p>
              <div className="score-meter">
                <div className="flex items-center justify-between mb-8">
                  <ScoreBadge score={lead.score} />
                  <span className="text-mono" style={{ color: scoreColor }}>{scoreVal}%</span>
                </div>
                <div className="score-bar">
                  <div className="score-fill" style={{ width: `${scoreVal}%`, background: scoreColor }} />
                </div>
              </div>
              <div className="divider" />
              <p className="section-title">Banderas y alertas</p>
              <div style={{ marginBottom: 16 }}>
                {lead.flags.map(f => <span key={f} className="flag">⚠️ {f}</span>)}
                {lead.flags.length === 0 && <span className="text-slate">Sin banderas</span>}
              </div>
              <div className="divider" />
              <p className="section-title">Guion sugerido</p>
              <div className="card card-sm" style={{ background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.15)" }}>
                <p style={{ fontSize: 13, color: "var(--smoke)", lineHeight: 1.7 }}>
                  💬 "Hola {lead.name.split(" ")[0]}, te contacto sobre tu consulta de seguro de vida para {lead.goal.toLowerCase()}. Vi que tu presupuesto es {lead.budget}/mes — ¡tengo opciones ideales para ti! ¿Tienes 10 minutos {lead.urgency === "Hoy" ? "ahorita" : "esta semana"}?"
                </p>
              </div>
              <div className="divider" />
              <p className="section-title">Agregar nota</p>
              <div className="flex gap-8">
                <input className="form-input" style={{ flex: 1 }} placeholder="Nota interna sobre este lead..." value={note} onChange={e => setNote(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={() => { if (note.trim()) { setNotes(n => [...n, { text: note, time: "Ahora" }]); setNote(""); } }}>+</button>
              </div>
              {notes.map((n, i) => (
                <div key={i} className="card card-sm" style={{ marginTop: 8, background: "rgba(30,58,95,0.3)" }}>
                  <p style={{ fontSize: 13 }}>{n.text}</p>
                  <p className="text-slate text-sm" style={{ marginTop: 4 }}>📝 {n.time}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === "historial" && (
            <div className="card fade-in">
              <p className="section-title">Historial de actividad</p>
              <div className="timeline">
                {lead.history.map((h, i) => (
                  <div key={i} className="timeline-item">
                    <div className="tl-dot">{h.icon}</div>
                    <div className="tl-content">
                      <div className="tl-title">{h.title}</div>
                      <div className="tl-time">{h.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "documentos" && (
            <div className="card fade-in">
              <p className="section-title">Checklist de documentos</p>
              {[{ icon: "🪪", label: "Identificación oficial (ID)", done: true }, { icon: "📄", label: "Prueba de dirección", done: false }, { icon: "👥", label: "Datos de beneficiarios", done: true }].map(d => (
                <div key={d.label} className={`checklist-item ${d.done ? "done" : ""}`}>
                  <div className={`check-icon ${d.done ? "done" : ""}`}>{d.done ? "✓" : "○"}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{d.icon} {d.label}</div>
                    <div className="text-slate text-sm">{d.done ? "Recibido ✅" : "Pendiente"}</div>
                  </div>
                </div>
              ))}
              <div className="upload-area" style={{ marginTop: 16 }}>
                <div className="upload-icon">📎</div>
                <p style={{ fontSize: 13, color: "var(--slate)" }}>Arrastra archivos o haz clic para subir</p>
              </div>
            </div>
          )}
        </div>

        {/* Right column — actions */}
        <div>
          <div className="card mb-20">
            <p className="section-title">Acciones rápidas</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn btn-primary" style={{ justifyContent: "center" }}>📞 Llamar ahora</button>
              <button className="btn btn-ghost" style={{ justifyContent: "center" }}>💬 WhatsApp</button>
              <button className="btn btn-ghost" style={{ justifyContent: "center" }}>📅 Enviar link de agenda</button>
              <button className="btn btn-ghost" style={{ justifyContent: "center" }}>📧 Enviar cotización</button>
              <div className="divider" />
              <button className="btn btn-ghost" style={{ justifyContent: "center" }}>✅ Marcar como Cerrado</button>
              <button className="btn btn-danger" style={{ justifyContent: "center" }}>✗ Marcar como Perdido</button>
            </div>
          </div>

          <div className="card">
            <p className="section-title">Seguimiento automático</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[{ label: "Bienvenida", sent: true, time: "Enviado" }, { label: "Follow-up 24h", sent: true, time: "Enviado" }, { label: "Follow-up 72h", sent: false, time: "Pendiente" }, { label: "Cierre 7 días", sent: false, time: "Pendiente" }].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-8">
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.sent ? "var(--green)" : "rgba(255,255,255,0.15)" }} />
                    <span style={{ fontSize: 13 }}>{s.label}</span>
                  </div>
                  <span className="text-slate text-sm">{s.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
function Reports() {
  const months = ["Ago", "Sep", "Oct", "Nov", "Dic", "Ene", "Feb", "Mar"];
  const leadsData = [22, 28, 31, 25, 35, 40, 44, 47];
  const citasData = [10, 13, 16, 11, 18, 20, 21, 23];
  const maxLeads = Math.max(...leadsData);

  const sources = [{ label: "Web", pct: 42, color: "var(--gold)" }, { label: "Instagram", pct: 28, color: "#e05252" }, { label: "Facebook", pct: 18, color: "#5b8dee" }, { label: "Landing Pages", pct: 12, color: "#3db87a" }];
  const metrics = [{ label: "Lead → Cita", value: "49%", trend: "↑ 3%" }, { label: "Tasa de asistencia", value: "78%", trend: "↑ 5%" }, { label: "Docs completados", value: "62%", trend: "↑ 8%" }, { label: "Tiempo prom. lead→cita", value: "2.4 días", trend: "↓ 0.3" }];

  return (
    <div className="page fade-in">
      <div className="stats-grid" style={{ marginBottom: 28 }}>
        {metrics.map(m => (
          <div key={m.label} className="stat-card">
            <div className="stat-label">{m.label}</div>
            <div className="stat-value">{m.value}</div>
            <div className="stat-delta delta-up">{m.trend}</div>
          </div>
        ))}
      </div>

      <div className="reports-grid">
        <div className="card">
          <p className="section-title">Leads captados por mes</p>
          <div className="bar-chart">
            {months.map((m, i) => (
              <div key={m} className="bar-col">
                <div className="bar" style={{ height: `${(leadsData[i] / maxLeads) * 100}px` }} />
                <div className="bar-label">{m}<br />{leadsData[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <p className="section-title">Citas agendadas por mes</p>
          <div className="bar-chart">
            {months.map((m, i) => (
              <div key={m} className="bar-col">
                <div className="bar" style={{ height: `${(citasData[i] / maxLeads) * 100}px`, background: "linear-gradient(to top, var(--navy-light), var(--green))" }} />
                <div className="bar-label">{m}<br />{citasData[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <p className="section-title">Leads por fuente</p>
          {sources.map(s => (
            <div key={s.label} style={{ marginBottom: 14 }}>
              <div className="flex items-center justify-between mb-4">
                <span style={{ fontSize: 13 }}>{s.label}</span>
                <span className="text-mono" style={{ fontSize: 12, color: s.color }}>{s.pct}%</span>
              </div>
              <div className="score-bar">
                <div className="score-fill" style={{ width: `${s.pct}%`, background: s.color }} />
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <p className="section-title">Distribución del pipeline</p>
          {pipelineStages.slice(0, 5).map((s, i) => {
            const vals = [8, 12, 14, 7, 6];
            const total2 = vals.reduce((a, b) => a + b, 0);
            const colors = ["var(--green)", "var(--amber)", "var(--gold)", "var(--red)", "#5b8dee"];
            return (
              <div key={s} style={{ marginBottom: 10 }}>
                <div className="flex items-center justify-between mb-4">
                  <span style={{ fontSize: 13 }}>{s}</span>
                  <span className="text-mono" style={{ fontSize: 12, color: colors[i] }}>{vals[i]} leads</span>
                </div>
                <div className="score-bar">
                  <div className="score-fill" style={{ width: `${(vals[i] / total2) * 100}%`, background: colors[i] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function Settings() {
  const [avail, setAvail] = useState({ mon: true, tue: true, wed: false, thu: true, fri: true, sat: false, sun: false });
  const days = [["mon", "Lun"], ["tue", "Mar"], ["wed", "Mié"], ["thu", "Jue"], ["fri", "Vie"], ["sat", "Sáb"], ["sun", "Dom"]];
  const [templates, setTemplates] = useState([
    { id: 1, name: "Bienvenida", text: "Hola, soy el asistente virtual. Te ayudo a cotizar tu seguro de vida. ¿Me compartes tu nombre y número?" },
    { id: 2, name: "Post-formulario", text: "Perfecto, gracias. ¿Prefieres una llamada o una reunión por Zoom?" },
    { id: 3, name: "Recordatorio 24h", text: "Tu cita es mañana a las X:XX. Responde 1 para confirmar o 2 para reprogramar." },
  ]);

  return (
    <div className="page fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card">
          <p className="section-title">Disponibilidad del calendario</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {days.map(([key, label]) => (
              <div key={key} className={`radio-card ${avail[key] ? "selected" : ""}`} style={{ minWidth: 52, fontSize: 12 }} onClick={() => setAvail(a => ({ ...a, [key]: !a[key] }))}>
                {label}
              </div>
            ))}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Hora inicio</label>
              <select className="form-input form-select">
                <option>9:00 AM</option><option>10:00 AM</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Hora fin</label>
              <select className="form-input form-select">
                <option>6:00 PM</option><option>7:00 PM</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Duración de cita</label>
            <div className="radio-group">
              {["30 min", "45 min", "60 min"].map(v => <div key={v} className={`radio-card ${v === "30 min" ? "selected" : ""}`}>{v}</div>)}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Link de Zoom (fijo)</label>
            <input className="form-input" placeholder="https://zoom.us/j/..." defaultValue="https://zoom.us/j/123456789" />
          </div>
          <button className="btn btn-primary btn-sm">Guardar disponibilidad</button>
        </div>

        <div className="card">
          <p className="section-title">Plantillas de mensajes</p>
          {templates.map(t => (
            <div key={t.id} className="card card-sm" style={{ background: "rgba(30,58,95,0.3)", marginBottom: 10 }}>
              <div className="flex items-center justify-between mb-8">
                <span className="text-gold" style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                <button className="btn btn-ghost btn-sm">✏️ Editar</button>
              </div>
              <p style={{ fontSize: 12, color: "var(--slate)", lineHeight: 1.5 }}>{t.text}</p>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm">+ Nueva plantilla</button>
        </div>

        <div className="card">
          <p className="section-title">Reglas de precalificación</p>
          {[{ rule: "Urgencia Hoy → Caliente", active: true }, { rule: "Presupuesto $100+ → Caliente", active: true }, { rule: "Fumador → Bandera amarilla", active: true }, { rule: "Edad 55+ → Final Expenses", active: true }, { rule: "Sin teléfono → Frío", active: false }].map(r => (
            <div key={r.rule} className="flex items-center justify-between" style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontSize: 13 }}>{r.rule}</span>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: r.active ? "var(--green)" : "rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", padding: "0 3px" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", marginLeft: r.active ? "auto" : 0, transition: "margin 0.2s" }} />
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <p className="section-title">Recordatorios automáticos</p>
          {[{ label: "24h antes de la cita", on: true }, { label: "2h antes de la cita", on: true }, { label: "15 min antes", on: false }, { label: "Follow-up post-cita (1h)", on: true }].map(r => (
            <div key={r.label} className="flex items-center justify-between" style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontSize: 13 }}>{r.label}</span>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: r.on ? "var(--gold)" : "rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", alignItems: "center", padding: "0 3px" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", marginLeft: r.on ? "auto" : 0, transition: "margin 0.2s" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("login"); // login | client | dashboard | lead | reports | settings
  const [navPage, setNavPage] = useState("dashboard");
  const [selectedLead, setSelectedLead] = useState(null);
  const [showClientModal, setShowClientModal] = useState(false);

  const navigate = (page) => {
    setNavPage(page);
    setSelectedLead(null);
  };

  const pageTitle = {
    dashboard: "Dashboard de Leads",
    reports: "Reportes y Métricas",
    settings: "Configuración",
  }[navPage] || "LifeShield Pro";

  if (view === "client") {
    return (
      <>
        <ClientChat onComplete={() => setView("login")} />
      </>
    );
  }

  if (view === "login") {
    return (
      <>
        <LoginPage onLogin={() => setView("agent")} />
        <div style={{ position: "fixed", bottom: 24, right: 24 }}>
          <button className="btn btn-ghost" onClick={() => setView("client")} style={{ fontSize: 12, border: "1px solid rgba(201,168,76,0.3)", color: "var(--gold)" }}>
            👁️ Ver formulario del cliente
          </button>
        </div>
      </>
    );
  }

  // Agent view
  return (
      <div className="app">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <h2>LifeShield Pro</h2>
            <span>Panel del Agente</span>
          </div>
          <nav className="sidebar-nav">
            <button className={`nav-item ${navPage === "dashboard" && !selectedLead ? "active" : ""}`} onClick={() => navigate("dashboard")}>
              <span className="nav-icon">📊</span> Dashboard
              <span className="nav-badge">3</span>
            </button>
            <button className={`nav-item ${navPage === "reports" ? "active" : ""}`} onClick={() => navigate("reports")}>
              <span className="nav-icon">📈</span> Reportes
            </button>
            <button className={`nav-item ${navPage === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}>
              <span className="nav-icon">⚙️</span> Configuración
            </button>
            <div className="divider" style={{ margin: "8px 4px" }} />
            <button className="nav-item" onClick={() => setView("client")}>
              <span className="nav-icon">👤</span> Vista Cliente
            </button>
          </nav>
          <div className="sidebar-bottom">
            <div className="nav-item" style={{ cursor: "default" }}>
              <div className="avatar" style={{ width: 30, height: 30, fontSize: 12, borderWidth: 1 }}>AG</div>
              <div>
                <div style={{ fontSize: 13, color: "var(--white)" }}>Agente Pro</div>
                <div style={{ fontSize: 10, color: "var(--slate)" }}>Admin</div>
              </div>
            </div>
            <button className="nav-item" onClick={() => setView("login")}>
              <span className="nav-icon">🚪</span> Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="main">
          <div className="topbar">
            <h1>{selectedLead ? selectedLead.name : pageTitle}</h1>
            <div className="topbar-actions">
              {navPage === "dashboard" && !selectedLead && (
                <button className="btn btn-primary btn-sm" onClick={() => setShowClientModal(true)}>+ Nuevo Lead</button>
              )}
              <div className="flex items-center gap-8" style={{ color: "var(--slate)", fontSize: 13 }}>
                <div className="notif-dot" />
                3 notificaciones
              </div>
            </div>
          </div>

          {selectedLead ? (
            <LeadDetail lead={selectedLead} onBack={() => setSelectedLead(null)} />
          ) : navPage === "dashboard" ? (
            <Dashboard onLeadClick={l => setSelectedLead(l)} />
          ) : navPage === "reports" ? (
            <Reports />
          ) : navPage === "settings" ? (
            <Settings />
          ) : null}
        </main>
      </div>

      {/* New lead modal */}
      {showClientModal && (
        <div className="modal-overlay" onClick={() => setShowClientModal(false)}>
          <div className="modal fade-in" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Agregar lead manualmente</h3>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowClientModal(false)}>✕</button>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Nombre</label><input className="form-input" placeholder="Juan Pérez" /></div>
              <div className="form-group"><label className="form-label">Teléfono</label><input className="form-input" placeholder="(305) 555-0000" /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Estado</label><input className="form-input" placeholder="FL" /></div>
              <div className="form-group"><label className="form-label">Fuente</label><select className="form-input form-select"><option>Web</option><option>Instagram</option><option>Facebook</option><option>Referido</option></select></div>
            </div>
            <div className="form-group mb-20"><label className="form-label">Presupuesto</label><select className="form-input form-select"><option>$25–$50</option><option>$50–$100</option><option>$100+</option></select></div>
            <div className="flex gap-8">
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowClientModal(false)}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowClientModal(false)}>Crear lead</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
// updateS
