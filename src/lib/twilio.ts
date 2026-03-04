// src/lib/twilio.ts
// Servicio de mensajería SMS y WhatsApp via Twilio

import twilio from 'twilio'
import { supabaseAdmin } from './supabase'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

// ── TIPOS ─────────────────────────────────────────────────────
interface SendMessageParams {
  to: string                 // Número del destinatario: '+13051234567'
  template: string           // Key del template: 'welcome', 'reminder_24h', etc.
  channel: 'sms' | 'whatsapp'
  variables: Record<string, string>  // Variables para reemplazar en el template
  leadId: string
  agentId: string
  sequenceStep?: string
}

interface RawMessageParams {
  to: string
  body: string
  channel: 'sms' | 'whatsapp'
  leadId: string
  agentId: string
}

// ── FUNCIÓN PRINCIPAL: Enviar desde template ──────────────────
export async function sendTemplatedMessage(params: SendMessageParams) {
  const { to, template, channel, variables, leadId, agentId, sequenceStep } = params

  // 1. Obtener template de la BD
  const { data: tmpl, error } = await supabaseAdmin
    .from('message_templates')
    .select('content')
    .eq('agent_id', agentId)
    .eq('key', template)
    .eq('channel', channel)
    .eq('is_active', true)
    .single()

  if (error || !tmpl) {
    console.error(`Template '${template}' no encontrado para canal ${channel}`)
    return null
  }

  // 2. Reemplazar variables en el template
  let body = tmpl.content
  for (const [key, value] of Object.entries(variables)) {
    body = body.replace(new RegExp(`{{${key}}}`, 'g'), value)
  }

  // 3. Enviar mensaje
  return sendRawMessage({ to, body, channel, leadId, agentId })
}

// ── ENVÍO DIRECTO ─────────────────────────────────────────────
export async function sendRawMessage(params: RawMessageParams) {
  const { to, body, channel, leadId, agentId } = params

  // Formatear número para WhatsApp
  const toFormatted = channel === 'whatsapp' ? `whatsapp:${to}` : to
  const from = channel === 'whatsapp'
    ? process.env.TWILIO_WHATSAPP_NUMBER!
    : process.env.TWILIO_PHONE_NUMBER!

  let twilioSid: string | undefined
  let status = 'sent'

  try {
    const message = await client.messages.create({
      from,
      to: toFormatted,
      body,
    })
    twilioSid = message.sid
    status = message.status
    console.log(`✅ Mensaje enviado por ${channel} a ${to}: ${twilioSid}`)
  } catch (err: any) {
    console.error(`❌ Error enviando mensaje por ${channel}:`, err.message)
    status = 'failed'
  }

  // 4. Guardar en BD
  await supabaseAdmin.from('messages').insert({
    lead_id: leadId,
    agent_id: agentId,
    channel,
    direction: 'outbound',
    content: body,
    twilio_sid: twilioSid,
    status,
  })

  return { twilioSid, status }
}

// ── RECIBIR MENSAJES INBOUND (Webhook de Twilio) ──────────────
// Configurar en Twilio Console > Phone Number > Messaging Webhook
// URL: https://tu-dominio.com/api/twilio/webhook

export async function processInboundMessage(params: {
  From: string
  Body: string
  MessageSid: string
  To: string
}) {
  const { From, Body, MessageSid } = params

  // Limpiar número
  const phone = From.replace('whatsapp:', '').replace(/\s/g, '')
  const channel: 'sms' | 'whatsapp' = From.startsWith('whatsapp:') ? 'whatsapp' : 'sms'
  const bodyClean = Body.trim().toUpperCase()

  // Buscar lead por teléfono
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, agent_id, first_name, sequence_paused, status')
    .eq('phone', phone)
    .single()

  if (!lead) {
    console.log(`Mensaje de número desconocido: ${phone}`)
    return
  }

  // Guardar mensaje inbound
  await supabaseAdmin.from('messages').insert({
    lead_id: lead.id,
    agent_id: lead.agent_id,
    channel,
    direction: 'inbound',
    content: Body,
    twilio_sid: MessageSid,
    status: 'received',
  })

  // Detener secuencia automática
  await supabaseAdmin
    .from('leads')
    .update({
      sequence_paused: true,
      last_contacted_at: new Date().toISOString(),
    })
    .eq('id', lead.id)

  // Respuestas automáticas
  if (['1', 'CONFIRMAR', 'CONFIRM', 'YES', 'SÍ', 'SI'].includes(bodyClean)) {
    // Confirmar cita pendiente
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('lead_id', lead.id)
      .eq('status', 'scheduled')
      .order('scheduled_at')
      .limit(1)
      .single()

    if (appt) {
      await supabaseAdmin.from('appointments').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', appt.id)
      await sendTemplatedMessage({
        to: phone, template: 'appointment_confirmed', channel,
        variables: {
          first_name: lead.first_name,
          appointment_date: new Date(appt.scheduled_at).toLocaleDateString('es-US', { weekday: 'long', month: 'long', day: 'numeric' }),
          appointment_time: new Date(appt.scheduled_at).toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit' }),
          appointment_type: appt.appointment_type,
          meeting_link: appt.zoom_link || appt.google_meet_link || '',
        },
        leadId: lead.id, agentId: lead.agent_id,
      })
    }
  } else if (['2', 'REPROGRAMAR', 'RESCHEDULE'].includes(bodyClean)) {
    // Enviar link de reprogramación
    const { data: appt } = await supabaseAdmin
      .from('appointments').select('reschedule_token').eq('lead_id', lead.id).eq('status', 'scheduled').single()

    if (appt) {
      await sendRawMessage({
        to: phone, channel, leadId: lead.id, agentId: lead.agent_id,
        body: `Para reprogramar tu cita entra aquí: ${process.env.NEXT_PUBLIC_APP_URL}/reschedule/${appt.reschedule_token}`,
      })
    }
  } else if (['COTIZAR', 'QUOTE', 'HOLA', 'INFO'].includes(bodyClean)) {
    // Reactivar secuencia
    await supabaseAdmin.from('leads').update({ sequence_paused: false, sequence_step: 'day0' }).eq('id', lead.id)
    const scheduleLink = `${process.env.NEXT_PUBLIC_APP_URL}/schedule/${lead.id}`
    await sendRawMessage({
      to: phone, channel, leadId: lead.id, agentId: lead.agent_id,
      body: `¡Hola ${lead.first_name}! Bienvenido de vuelta 👋 Elige tu horario aquí: ${scheduleLink}`,
    })
  }
}

// ── VALIDAR WEBHOOK TWILIO ────────────────────────────────────
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    params
  )
}
