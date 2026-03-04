// src/lib/supabase.ts
// Cliente de Supabase para uso en el servidor (API routes)

import { createClient } from '@supabase/supabase-js'

// Cliente con privilegios de admin (solo usar en server-side)
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// Cliente público (para uso en cliente o con auth de usuario)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── TIPOS ─────────────────────────────────────────────────────
export type LeadScore = 'hot' | 'warm' | 'cold'
export type LeadStatus = 'new' | 'contacted' | 'appointment' | 'proposal' | 'closed' | 'lost'
export type ContactPreference = 'call' | 'zoom' | 'whatsapp' | 'in_person'
export type UrgencyLevel = 'today' | 'this_week' | 'info_only'
export type GoalType = 'family' | 'mortgage' | 'business' | 'final_expenses'
export type BudgetRange = '25_50' | '50_100' | '100_plus'
export type MessageChannel = 'sms' | 'whatsapp' | 'email'
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled'
export type AppointmentType = 'call' | 'zoom' | 'whatsapp' | 'in_person'

export interface Lead {
  id: string
  agent_id: string
  first_name: string
  last_name: string
  phone: string
  email?: string
  state?: string
  age?: number
  smoker: boolean
  goal?: GoalType
  budget?: BudgetRange
  contact_preference: ContactPreference
  urgency: UrgencyLevel
  source?: string
  score: LeadScore
  flags: string[]
  notes?: string
  agent_notes?: string
  status: LeadStatus
  sequence_step: string
  sequence_paused: boolean
  last_contacted_at?: string
  created_at: string
  updated_at: string
}

export interface Appointment {
  id: string
  lead_id: string
  agent_id: string
  appointment_type: AppointmentType
  status: AppointmentStatus
  scheduled_at: string
  duration_minutes: number
  timezone: string
  google_event_id?: string
  google_meet_link?: string
  zoom_link?: string
  confirmed_at?: string
  reminded_24h_at?: string
  reminded_2h_at?: string
  reschedule_token: string
  notes?: string
  created_at: string
}

export interface Message {
  id: string
  lead_id: string
  channel: MessageChannel
  direction: 'outbound' | 'inbound'
  content: string
  twilio_sid?: string
  status?: string
  sequence_step?: string
  sent_at: string
}
