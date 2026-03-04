-- ============================================================
--  LifeShield Pro — Datos iniciales (seed)
--  Ejecutar después del schema, reemplaza AGENT_ID con tu UUID
-- ============================================================

-- Reemplaza esto con el UUID del agente después de registrarte
DO $$
DECLARE v_agent_id UUID;
BEGIN
  -- Obtener primer agente (ajusta si tienes varios)
  SELECT id INTO v_agent_id FROM agents LIMIT 1;
  IF v_agent_id IS NULL THEN
    RAISE NOTICE 'No hay agentes. Registrate primero en /auth/register y luego ejecuta este seed.';
    RETURN;
  END IF;

  -- ── PLANTILLAS DE MENSAJES ──────────────────────────────────

  INSERT INTO message_templates (agent_id, name, key, channel, content) VALUES

  -- SMS
  (v_agent_id, 'Bienvenida SMS', 'welcome', 'sms',
   'Hola {{first_name}} 👋 Soy el asistente de seguros de vida. Gracias por tu interés. ¿Prefieres que te contactemos por llamada o Zoom? Responde LLAMADA o ZOOM.'),

  (v_agent_id, 'Follow-up 24h', 'followup_24h', 'sms',
   'Hola {{first_name}}, ¿quieres que te cotice un seguro de vida? Solo responde SÍ y te mando horarios disponibles 📅'),

  (v_agent_id, 'Follow-up 72h', 'followup_72h', 'sms',
   'Hola {{first_name}}, te comparto el link para agendar tu cita cuando quieras: {{schedule_link}} ⬆️'),

  (v_agent_id, 'Follow-up 7 días', 'followup_7d', 'sms',
   'Hola {{first_name}}, voy a cerrar tu solicitud por ahora. Si en algún momento quieres retomar, responde COTIZAR y te ayudamos 🙌'),

  (v_agent_id, 'Recordatorio 24h', 'reminder_24h', 'sms',
   'Recordatorio: Tu cita es MAÑANA {{appointment_date}} a las {{appointment_time}} ({{appointment_type}}). Responde 1 para CONFIRMAR o 2 para REPROGRAMAR.'),

  (v_agent_id, 'Recordatorio 2h', 'reminder_2h', 'sms',
   'Tu cita es en 2 horas — {{appointment_time}} por {{appointment_type}}. {{meeting_link}} ¡Te esperamos!'),

  (v_agent_id, 'Recordatorio 15min', 'reminder_15m', 'sms',
   '⏰ Tu cita empieza en 15 minutos. {{meeting_link}}'),

  (v_agent_id, 'Cita confirmada', 'appointment_confirmed', 'sms',
   '✅ ¡Cita confirmada! {{appointment_date}} a las {{appointment_time}} por {{appointment_type}}. {{meeting_link}} — Hasta pronto, {{first_name}}!'),

  (v_agent_id, 'Link de documentos', 'docs_request', 'sms',
   'Hola {{first_name}}, para avanzar con tu póliza necesito algunos documentos. Súbelos aquí de forma segura: {{docs_link}} (expira en 7 días)'),

  (v_agent_id, 'Documentos recibidos', 'docs_complete', 'sms',
   '✅ Documentos recibidos, {{first_name}}. Todo listo para avanzar con tu póliza. Te contactaremos pronto.'),

  -- WhatsApp (mismo contenido, canal diferente)
  (v_agent_id, 'Bienvenida WhatsApp', 'welcome', 'whatsapp',
   'Hola {{first_name}} 👋 Soy el asistente de seguros de vida de *LifeShield*. Gracias por tu interés.\n\n¿Prefieres que te contactemos por 📞 *llamada* o 💻 *Zoom*?\n\nResponde *LLAMADA* o *ZOOM*'),

  (v_agent_id, 'Recordatorio 24h WA', 'reminder_24h', 'whatsapp',
   '📅 *Recordatorio de cita*\n\nTu cita es *mañana {{appointment_date}}* a las *{{appointment_time}}*\nModalidad: {{appointment_type}}\n{{meeting_link}}\n\nResponde *1* para CONFIRMAR o *2* para REPROGRAMAR'),

  -- Email
  (v_agent_id, 'Bienvenida Email', 'welcome', 'email',
   'Hola {{first_name}},\n\nGracias por tu interés en LifeShield Pro. Hemos recibido tu solicitud de cotización de seguro de vida.\n\nUn agente se pondrá en contacto contigo pronto.\n\nMientras tanto, puedes agendar tu cita aquí: {{schedule_link}}\n\nSaludos,\nEl equipo de LifeShield Pro'),

  (v_agent_id, 'Confirmación de cita Email', 'appointment_confirmed', 'email',
   'Hola {{first_name}},\n\n✅ Tu cita está confirmada:\n\n📅 Fecha: {{appointment_date}}\n🕐 Hora: {{appointment_time}}\n📌 Modalidad: {{appointment_type}}\n{{meeting_link}}\n\nSi necesitas reprogramar: {{reschedule_link}}\n\nSaludos,\nLifeShield Pro')

  ON CONFLICT (agent_id, key, channel) DO UPDATE SET content = EXCLUDED.content;

  -- ── DISPONIBILIDAD POR DEFECTO (Lun-Vie, 9am-6pm) ──────────
  INSERT INTO availability (agent_id, day_of_week, start_time, end_time, is_active)
  VALUES
    (v_agent_id, 1, '09:00', '18:00', true),  -- Lunes
    (v_agent_id, 2, '09:00', '18:00', true),  -- Martes
    (v_agent_id, 3, '09:00', '18:00', true),  -- Miércoles
    (v_agent_id, 4, '09:00', '18:00', true),  -- Jueves
    (v_agent_id, 5, '09:00', '18:00', true),  -- Viernes
    (v_agent_id, 6, '09:00', '13:00', false), -- Sábado (desactivado)
    (v_agent_id, 0, '09:00', '13:00', false)  -- Domingo (desactivado)
  ON CONFLICT (agent_id, day_of_week) DO NOTHING;

  -- ── REGLAS DE SCORING POR DEFECTO ──────────────────────────
  INSERT INTO scoring_rules (agent_id, field, operator, value, score_impact, flag_message, priority)
  VALUES
    (v_agent_id, 'urgency', 'equals', 'today', 'hot', NULL, 10),
    (v_agent_id, 'urgency', 'equals', 'this_week', 'warm', NULL, 9),
    (v_agent_id, 'budget', 'equals', '100_plus', 'hot', NULL, 8),
    (v_agent_id, 'budget', 'equals', '50_100', 'warm', NULL, 7),
    (v_agent_id, 'smoker', 'equals', 'true', 'warm', 'Fumador → Verificar productos disponibles', 6),
    (v_agent_id, 'age', 'gte', '55', 'warm', 'Edad 55+ → Considerar Final Expenses', 5),
    (v_agent_id, 'budget', 'equals', '25_50', 'cold', 'Presupuesto bajo → Ofrecer opciones básicas', 4)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seed completado para agente %', v_agent_id;
END $$;
