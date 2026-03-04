// src/api/routes/appointments.ts
// POST /api/appointments — Crear cita (cliente o agente)
// GET  /api/appointments/slots — Ver horarios disponibles
// PATCH /api/appointments/[id] — Actualizar/cancelar cita
// POST /api/appointments/reschedule/[token] — Reprogramar por link

import type { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'
import { supabaseAdmin } from '../../lib/supabase'
import { createCalendarEvent, updateCalendarEvent, cancelCalendarEvent, getAvailableDays } from '../../lib/google-calendar'
import { sendTemplatedMessage } from '../../lib/twilio'
import { format, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

// ── VALIDACIÓN ────────────────────────────────────────────────
const CreateAppointmentSchema = z.object({
  lead_id: z.string().uuid(),
  scheduled_at: z.string().datetime(),
  appointment_type: z.enum(['call', 'zoom', 'whatsapp', 'in_person']).default('zoom'),
  duration_minutes: z.number().int().min(15).max(120).default(30),
  notes: z.string().optional(),
})

// ── CREAR CITA ────────────────────────────────────────────────
export async function createAppointment(req: NextApiRequest, res: NextApiResponse) {
  const parse = CreateAppointmentSchema.safeParse(req.body)
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() })

  const { lead_id, scheduled_at, appointment_type, duration_minutes, notes } = parse.data

  // Obtener lead
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*, agents(zoom_link, timezone)')
    .eq('id', lead_id)
    .single()

  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' })

  const agentId = lead.agent_id
  const zoomLink = (lead.agents as any)?.zoom_link || process.env.AGENT_ZOOM_LINK
  const timezone = (lead.agents as any)?.timezone || 'America/New_York'

  // Crear cita en BD
  const { data: appt, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      lead_id,
      agent_id: agentId,
      appointment_type,
      scheduled_at,
      duration_minutes,
      timezone,
      zoom_link: appointment_type === 'zoom' ? zoomLink : null,
      notes,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // Crear evento en Google Calendar
  try {
    await createCalendarEvent({
      agentId,
      leadName: `${lead.first_name} ${lead.last_name}`,
      leadPhone: lead.phone,
      leadEmail: lead.email,
      appointmentId: appt.id,
      scheduledAt: scheduled_at,
      durationMinutes: duration_minutes,
      appointmentType: appointment_type,
      zoomLink: appointment_type === 'zoom' ? zoomLink : undefined,
      notes,
    })
  } catch (err) {
    console.error('Error creando evento en Google Calendar:', err)
    // No fallar si Google Calendar falla — la cita ya está en BD
  }

  // Actualizar status del lead
  await supabaseAdmin
    .from('leads')
    .update({ status: 'appointment' })
    .eq('id', lead_id)

  // Enviar confirmación
  const channel = lead.contact_preference === 'whatsapp' ? 'whatsapp' : 'sms'
  const apptDate = toZonedTime(parseISO(scheduled_at), timezone)
  const formattedDate = format(apptDate, "EEEE d 'de' MMMM", { locale: undefined })
  const formattedTime = format(apptDate, 'h:mm a')

  const meetingLink = appt.zoom_link || appt.google_meet_link || ''

  await sendTemplatedMessage({
    to: lead.phone,
    template: 'appointment_confirmed',
    channel,
    variables: {
      first_name: lead.first_name,
      appointment_date: formattedDate,
      appointment_time: formattedTime,
      appointment_type: appointment_type,
      meeting_link: meetingLink,
      reschedule_link: `${process.env.NEXT_PUBLIC_APP_URL}/reschedule/${appt.reschedule_token}`,
    },
    leadId: lead_id,
    agentId,
  })

  // Audit log
  await supabaseAdmin.from('audit_log').insert({
    lead_id,
    agent_id: agentId,
    action: 'appointment_created',
    details: { scheduled_at, appointment_type },
  })

  return res.status(201).json({
    appointment_id: appt.id,
    scheduled_at: appt.scheduled_at,
    reschedule_link: `${process.env.NEXT_PUBLIC_APP_URL}/reschedule/${appt.reschedule_token}`,
    meeting_link: meetingLink,
  })
}

// ── OBTENER SLOTS DISPONIBLES ─────────────────────────────────
export async function getSlots(req: NextApiRequest, res: NextApiResponse) {
  const { agent_id, days = '14' } = req.query
  if (!agent_id) return res.status(400).json({ error: 'agent_id requerido' })

  try {
    const slots = await getAvailableDays(agent_id as string, Number(days))
    return res.status(200).json({ slots })
  } catch (err: any) {
    console.error('Error obteniendo slots:', err.message)
    // Fallback: slots ficticios si Google Calendar no está conectado
    return res.status(200).json({ slots: generateFallbackSlots() })
  }
}

// ── REPROGRAMAR POR TOKEN ─────────────────────────────────────
export async function rescheduleByToken(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Token requerido' })

  if (req.method === 'GET') {
    // Obtener info de la cita para mostrar al cliente
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('*, leads(first_name, phone, contact_preference, agent_id)')
      .eq('reschedule_token', token)
      .neq('status', 'cancelled')
      .single()

    if (!appt) return res.status(404).json({ error: 'Link inválido o cita ya cancelada' })

    const lead = appt.leads as any
    const slots = await getAvailableDays(lead.agent_id)

    return res.status(200).json({ appointment: appt, available_slots: slots })
  }

  if (req.method === 'POST') {
    const { new_scheduled_at } = req.body
    if (!new_scheduled_at) return res.status(400).json({ error: 'new_scheduled_at requerido' })

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('*, leads(first_name, phone, contact_preference, agent_id, agents(zoom_link, timezone))')
      .eq('reschedule_token', token)
      .single()

    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' })

    // Actualizar en BD
    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        scheduled_at: new_scheduled_at,
        status: 'rescheduled',
        rescheduled_from: appt.id,
        reminded_24h_at: null,
        reminded_2h_at: null,
      })
      .eq('id', appt.id)

    if (error) return res.status(500).json({ error: error.message })

    const lead = appt.leads as any

    // Actualizar Google Calendar
    if (appt.google_event_id) {
      try {
        await updateCalendarEvent({
          agentId: lead.agent_id,
          googleEventId: appt.google_event_id,
          newScheduledAt: new_scheduled_at,
          durationMinutes: appt.duration_minutes,
        })
      } catch (err) {
        console.error('Error actualizando Google Calendar:', err)
      }
    }

    // Notificar al cliente
    const channel = lead.contact_preference === 'whatsapp' ? 'whatsapp' : 'sms'
    const tz = lead.agents?.timezone || 'America/New_York'
    const apptDate = toZonedTime(parseISO(new_scheduled_at), tz)

    await sendTemplatedMessage({
      to: lead.phone,
      template: 'appointment_confirmed',
      channel,
      variables: {
        first_name: lead.first_name,
        appointment_date: format(apptDate, "EEEE d 'de' MMMM"),
        appointment_time: format(apptDate, 'h:mm a'),
        appointment_type: appt.appointment_type,
        meeting_link: appt.zoom_link || appt.google_meet_link || '',
        reschedule_link: `${process.env.NEXT_PUBLIC_APP_URL}/reschedule/${token}`,
      },
      leadId: appt.lead_id,
      agentId: lead.agent_id,
    })

    return res.status(200).json({ message: 'Cita reprogramada exitosamente' })
  }

  return res.status(405).json({ error: 'Método no permitido' })
}

// ── FALLBACK: Slots si Google Calendar no está conectado ──────
function generateFallbackSlots(): Record<string, string[]> {
  const slots: Record<string, string[]> = {}
  const today = new Date()

  for (let i = 1; i <= 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dow = d.getDay()

    if (dow === 0 || dow === 6) continue // Skip weekends

    const dateStr = d.toISOString().split('T')[0]
    slots[dateStr] = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'].map(t => {
      const dt = new Date(`${dateStr}T${t}:00-05:00`)
      return dt.toISOString()
    })
  }
  return slots
}
