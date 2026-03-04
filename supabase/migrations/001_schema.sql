-- ============================================================
--  LifeShield Pro — Esquema de base de datos (Supabase)
--  Ejecutar en: Supabase > SQL Editor > New Query
-- ============================================================

-- ── EXTENSIONES ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";  -- Para jobs automáticos

-- ── ENUM TYPES ────────────────────────────────────────────────
CREATE TYPE lead_score AS ENUM ('hot', 'warm', 'cold');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'appointment', 'proposal', 'closed', 'lost');
CREATE TYPE contact_preference AS ENUM ('call', 'zoom', 'whatsapp', 'in_person');
CREATE TYPE urgency_level AS ENUM ('today', 'this_week', 'info_only');
CREATE TYPE goal_type AS ENUM ('family', 'mortgage', 'business', 'final_expenses');
CREATE TYPE budget_range AS ENUM ('25_50', '50_100', '100_plus');
CREATE TYPE message_channel AS ENUM ('sms', 'whatsapp', 'email');
CREATE TYPE message_direction AS ENUM ('outbound', 'inbound');
CREATE TYPE appointment_type AS ENUM ('call', 'zoom', 'whatsapp', 'in_person');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled');
CREATE TYPE doc_status AS ENUM ('pending', 'uploaded', 'approved', 'rejected');
CREATE TYPE sequence_step AS ENUM ('day0', 'day1', 'day3', 'day7');

-- ── TABLA: agents (agentes / admins) ─────────────────────────
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  zoom_link TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  google_refresh_token TEXT,
  google_calendar_id TEXT DEFAULT 'primary',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABLA: leads ──────────────────────────────────────────────
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id),

  -- Datos personales
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  state TEXT,
  age INTEGER,
  smoker BOOLEAN DEFAULT false,

  -- Perfil de seguro
  goal goal_type,
  budget budget_range,
  contact_preference contact_preference DEFAULT 'call',
  urgency urgency_level DEFAULT 'this_week',

  -- Metadata
  source TEXT,                  -- 'web', 'landing_campaign_1', 'instagram', etc.
  utm_source TEXT,
  utm_campaign TEXT,
  ip_address TEXT,

  -- Precalificación
  score lead_score DEFAULT 'cold',
  flags JSONB DEFAULT '[]',     -- Array de strings con alertas
  notes TEXT,
  agent_notes TEXT,

  -- Estado pipeline
  status lead_status DEFAULT 'new',

  -- Secuencia de seguimiento
  sequence_step sequence_step DEFAULT 'day0',
  sequence_paused BOOLEAN DEFAULT false,
  last_contacted_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABLA: appointments ───────────────────────────────────────
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),

  appointment_type appointment_type DEFAULT 'zoom',
  status appointment_status DEFAULT 'scheduled',

  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  timezone TEXT DEFAULT 'America/New_York',

  -- Google Calendar
  google_event_id TEXT,
  google_meet_link TEXT,
  zoom_link TEXT,

  -- Confirmación
  confirmed_at TIMESTAMPTZ,
  reminded_24h_at TIMESTAMPTZ,
  reminded_2h_at TIMESTAMPTZ,
  reminded_15m_at TIMESTAMPTZ,

  -- Reprogramación
  reschedule_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  rescheduled_from UUID REFERENCES appointments(id),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABLA: messages (historial de SMS/WhatsApp/Email) ─────────
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),

  channel message_channel NOT NULL,
  direction message_direction DEFAULT 'outbound',
  content TEXT NOT NULL,

  -- Twilio
  twilio_sid TEXT,
  status TEXT,                  -- 'sent', 'delivered', 'failed', 'received'

  -- Email
  resend_id TEXT,

  -- Tracking
  sequence_step sequence_step,  -- Si fue parte de secuencia automática
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,

  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABLA: documents ─────────────────────────────────────────
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,

  doc_type TEXT NOT NULL,       -- 'id', 'proof_of_address', 'beneficiary_form', 'other'
  label TEXT NOT NULL,          -- Nombre visible al cliente
  status doc_status DEFAULT 'pending',
  required BOOLEAN DEFAULT true,

  -- Storage
  file_path TEXT,               -- Supabase Storage path
  file_name TEXT,
  file_size INTEGER,
  file_type TEXT,               -- mime type

  -- Token de subida sin login
  upload_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  upload_token_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',

  uploaded_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES agents(id),
  rejection_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABLA: beneficiaries ─────────────────────────────────────
CREATE TABLE beneficiaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL,   -- 'spouse', 'child', 'parent', 'other'
  percentage INTEGER NOT NULL,  -- 0-100, suma debe dar 100
  date_of_birth DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABLA: availability (disponibilidad del agente) ──────────
CREATE TABLE availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,

  day_of_week INTEGER NOT NULL, -- 0=Dom, 1=Lun, ..., 6=Sáb
  start_time TIME NOT NULL,     -- '09:00:00'
  end_time TIME NOT NULL,       -- '18:00:00'
  is_active BOOLEAN DEFAULT true,

  UNIQUE(agent_id, day_of_week)
);

-- ── TABLA: message_templates ──────────────────────────────────
CREATE TABLE message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id),

  name TEXT NOT NULL,
  key TEXT NOT NULL,            -- 'welcome', 'post_form', 'reminder_24h', etc.
  channel message_channel DEFAULT 'sms',
  content TEXT NOT NULL,

  -- Variables disponibles: {{first_name}}, {{appointment_time}}, {{reschedule_link}}, {{schedule_link}}

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agent_id, key, channel)
);

-- ── TABLA: scoring_rules ─────────────────────────────────────
CREATE TABLE scoring_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id),

  field TEXT NOT NULL,          -- 'urgency', 'budget', 'smoker', 'age'
  operator TEXT NOT NULL,       -- 'equals', 'gte', 'lte', 'contains'
  value TEXT NOT NULL,
  score_impact lead_score NOT NULL,  -- resultado si se cumple la regla
  flag_message TEXT,            -- Mensaje de alerta (opcional)
  priority INTEGER DEFAULT 0,   -- Orden de evaluación (mayor = más prioridad)

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABLA: audit_log ─────────────────────────────────────────
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id),
  agent_id UUID REFERENCES agents(id),
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ÍNDICES ───────────────────────────────────────────────────
CREATE INDEX idx_leads_agent_id ON leads(agent_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_score ON leads(score);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_appointments_lead_id ON appointments(lead_id);
CREATE INDEX idx_appointments_scheduled_at ON appointments(scheduled_at);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_messages_lead_id ON messages(lead_id);
CREATE INDEX idx_documents_lead_id ON documents(lead_id);
CREATE INDEX idx_documents_upload_token ON documents(upload_token);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

-- Agentes solo ven sus propios leads
CREATE POLICY "agents_own_leads" ON leads
  FOR ALL USING (agent_id = (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "agents_own_appointments" ON appointments
  FOR ALL USING (agent_id = (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "agents_own_messages" ON messages
  FOR ALL USING (agent_id = (SELECT id FROM agents WHERE user_id = auth.uid()));

-- Service role puede hacer todo (para API routes del servidor)
CREATE POLICY "service_role_all_leads" ON leads FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_appointments" ON appointments FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_messages" ON messages FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_documents" ON documents FOR ALL TO service_role USING (true);

-- ── FUNCIÓN: auto-update updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── FUNCIÓN: calcular score automáticamente ───────────────────
CREATE OR REPLACE FUNCTION calculate_lead_score(
  p_urgency urgency_level,
  p_budget budget_range,
  p_smoker BOOLEAN,
  p_age INTEGER
) RETURNS JSONB AS $$
DECLARE
  v_score lead_score := 'cold';
  v_flags TEXT[] := '{}';
BEGIN
  -- Score base por urgencia y presupuesto
  IF p_urgency IN ('today', 'this_week') AND p_budget IN ('50_100', '100_plus') THEN
    v_score := 'hot';
  ELSIF p_urgency = 'today' OR p_budget = '100_plus' THEN
    v_score := 'hot';
  ELSIF p_urgency = 'this_week' OR p_budget = '50_100' THEN
    v_score := 'warm';
  END IF;

  -- Banderas
  IF p_smoker THEN
    v_flags := array_append(v_flags, 'Fumador → Productos especiales');
    IF p_budget = '25_50' THEN
      v_score := 'warm'; -- Bajar un nivel si fumador + presupuesto bajo
    END IF;
  END IF;

  IF p_age >= 55 THEN
    v_flags := array_append(v_flags, 'Edad 55+ → Considerar Final Expenses');
  END IF;

  IF p_budget = '25_50' THEN
    v_flags := array_append(v_flags, 'Presupuesto bajo → Ofrecer opciones básicas');
    IF v_score = 'hot' THEN v_score := 'warm'; END IF;
  END IF;

  RETURN jsonb_build_object('score', v_score, 'flags', to_jsonb(v_flags));
END;
$$ LANGUAGE plpgsql;

-- ── DATOS INICIALES: Plantillas de mensajes ───────────────────
-- (Se insertan al crear el primer agente, ver seed.sql)

-- ── STORAGE: Bucket para documentos ──────────────────────────
-- Ejecutar en Supabase Dashboard > Storage > New Bucket
-- Nombre: 'lead-documents', Private: true

-- ── CRON JOBS (pg_cron) ───────────────────────────────────────
-- Ejecutar cada hora para enviar recordatorios pendientes
SELECT cron.schedule('send-reminders', '0 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.base_url') || '/api/cron/reminders',
    headers := '{"Authorization": "Bearer ' || current_setting('app.cron_secret') || '"}'::jsonb
  )$$
);

-- Ejecutar cada 6 horas para seguimiento automático de leads sin respuesta
SELECT cron.schedule('lead-sequences', '0 */6 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.base_url') || '/api/cron/sequences',
    headers := '{"Authorization": "Bearer ' || current_setting('app.cron_secret') || '"}'::jsonb
  )$$
);
