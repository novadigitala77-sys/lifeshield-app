// src/lib/google-calendar.ts
// Integración con Google Calendar API

import { google } from 'googleapis'
import { supabaseAdmin } from './supabase'
import type { Appointment } from './supabase'

// ── OAUTH2 CLIENT ─────────────────────────────────────────────
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  )
}

// URL para autorizar (primer setup del agente)
export function getGoogleAuthUrl() {
  const oauth2 = getOAuthClient()
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  })
}

// Intercambiar code por tokens y guardar refresh token
export async function handleGoogleCallback(code: string, agentId: string) {
  const oauth2 = getOAuthClient()
  const { tokens } = await oauth2.getToken(code)
  oauth2.setCredentials(tokens)

  // Guardar refresh token en BD
  await supabaseAdmin
    .from('agents')
    .update({ google_refresh_token: tokens.refresh_token })
    .eq('id', agentId)

  return tokens
}

// Obtener cliente autenticado para un agente específico
async function getCalendarForAgent(agentId: string) {
  const { data: agent } = await supabaseAdmin
    .from('agents')
    .select('google_refresh_token, google_calendar_id, timezone')
    .eq('id', agentId)
    .single()

  if (!agent?.google_refresh_token) {
    throw new Error(`Agente ${agentId} no tiene Google Calendar conectado`)
  }

  const oauth2 = getOAuthClient()
  oauth2.setCredentials({ refresh_token: agent.google_refresh_token })

  return {
    calendar: google.calendar({ version: 'v3', auth: oauth2 }),
    calendarId: agent.google_calendar_id || 'primary',
    timezone: agent.timezone || 'America/New_York',
  }
}

// ── CREAR EVENTO ──────────────────────────────────────────────
export async function createCalendarEvent(params: {
  agentId: string
  leadName: string
  leadPhone: string
  leadEmail?: string
  appointmentId: string
  scheduledAt: string          // ISO string
  durationMinutes: number
  appointmentType: string
  zoomLink?: string
  notes?: string
}) {
  const {
    agentId, leadName, leadPhone, leadEmail,
    appointmentId, scheduledAt, durationMinutes,
    appointmentType, zoomLink, notes,
  } = params

  const { calendar, calendarId, timezone } = await getCalendarForAgent(agentId)

  const startTime = new Date(scheduledAt)
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)

  const locationOrLink =
    appointmentType === 'zoom' && zoomLink ? zoomLink :
    appointmentType === 'call' ? `Llamada al ${leadPhone}` :
    appointmentType === 'whatsapp' ? `WhatsApp: ${leadPhone}` :
    'Presencial'

  const event = {
    summary: `[LifeShield] Cita con ${leadName}`,
    description: [
      `📋 Lead: ${leadName}`,
      `📱 Teléfono: ${leadPhone}`,
      leadEmail ? `✉️ Email: ${leadEmail}` : '',
      `📌 Modalidad: ${appointmentType}`,
      zoomLink ? `🔗 Zoom: ${zoomLink}` : '',
      notes ? `📝 Notas: ${notes}` : '',
      `\n🆔 ID Cita: ${appointmentId}`,
    ].filter(Boolean).join('\n'),
    location: locationOrLink,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: timezone,
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: timezone,
    },
    attendees: leadEmail ? [{ email: leadEmail }] : [],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
    conferenceData: appointmentType === 'zoom' ? undefined : {
      createRequest: {
        requestId: appointmentId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody: event,
    conferenceDataVersion: appointmentType !== 'zoom' ? 1 : 0,
    sendUpdates: leadEmail ? 'all' : 'none',
  })

  const createdEvent = response.data
  const meetLink = createdEvent.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri

  // Actualizar cita en BD con el event ID y link de Meet
  await supabaseAdmin
    .from('appointments')
    .update({
      google_event_id: createdEvent.id,
      google_meet_link: meetLink || null,
    })
    .eq('id', appointmentId)

  console.log(`✅ Evento creado en Google Calendar: ${createdEvent.id}`)
  return createdEvent
}

// ── ACTUALIZAR EVENTO ─────────────────────────────────────────
export async function updateCalendarEvent(params: {
  agentId: string
  googleEventId: string
  newScheduledAt: string
  durationMinutes: number
}) {
  const { agentId, googleEventId, newScheduledAt, durationMinutes } = params
  const { calendar, calendarId, timezone } = await getCalendarForAgent(agentId)

  const startTime = new Date(newScheduledAt)
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)

  await calendar.events.patch({
    calendarId,
    eventId: googleEventId,
    requestBody: {
      start: { dateTime: startTime.toISOString(), timeZone: timezone },
      end: { dateTime: endTime.toISOString(), timeZone: timezone },
    },
    sendUpdates: 'all',
  })
}

// ── CANCELAR EVENTO ───────────────────────────────────────────
export async function cancelCalendarEvent(agentId: string, googleEventId: string) {
  const { calendar, calendarId } = await getCalendarForAgent(agentId)
  await calendar.events.delete({ calendarId, eventId: googleEventId, sendUpdates: 'all' })
}

// ── OBTENER SLOTS DISPONIBLES ─────────────────────────────────
export async function getAvailableSlots(params: {
  agentId: string
  date: string      // 'YYYY-MM-DD'
  durationMinutes?: number
}): Promise<string[]> {
  const { agentId, date, durationMinutes = 30 } = params

  // 1. Obtener disponibilidad del agente para ese día de semana
  const dayOfWeek = new Date(date + 'T12:00:00').getDay()

  const { data: avail } = await supabaseAdmin
    .from('availability')
    .select('start_time, end_time')
    .eq('agent_id', agentId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)
    .single()

  if (!avail) return []

  // 2. Obtener eventos del agente para ese día
  const { calendar, calendarId, timezone } = await getCalendarForAgent(agentId)

  const dayStart = new Date(`${date}T${avail.start_time}`)
  const dayEnd = new Date(`${date}T${avail.end_time}`)

  const eventsRes = await calendar.events.list({
    calendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  const busySlots = (eventsRes.data.items || []).map(e => ({
    start: new Date(e.start?.dateTime || e.start?.date || ''),
    end: new Date(e.end?.dateTime || e.end?.date || ''),
  }))

  // 3. Generar slots disponibles cada durationMinutes
  const availableSlots: string[] = []
  const current = new Date(dayStart)
  const now = new Date()

  while (current < dayEnd) {
    const slotEnd = new Date(current.getTime() + durationMinutes * 60_000)

    // No mostrar slots en el pasado
    if (current <= now) {
      current.setMinutes(current.getMinutes() + durationMinutes)
      continue
    }

    // Verificar que no se superpone con eventos existentes
    const isAvailable = !busySlots.some(
      busy => current < busy.end && slotEnd > busy.start
    )

    if (isAvailable) {
      availableSlots.push(current.toISOString())
    }

    current.setMinutes(current.getMinutes() + durationMinutes)
  }

  return availableSlots
}

// ── OBTENER SLOTS DE LOS PRÓXIMOS 14 DÍAS ────────────────────
export async function getAvailableDays(agentId: string, days = 14): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {}
  const today = new Date()

  for (let i = 1; i <= days; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]

    const slots = await getAvailableSlots({ agentId, date: dateStr })
    if (slots.length > 0) {
      result[dateStr] = slots
    }
  }

  return result
}
