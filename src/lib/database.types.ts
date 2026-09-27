// Shape of db/base/01_schema.sql + db/migrations (002–004).
// Regenerate with: npx supabase gen types typescript --project-id <PROJECT_REF> > src/lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type TransferRow = {
  id: string
  medicine_id: string
  from_facility_id: string
  to_facility_id: string
  qty: number
  distance_km: number | null
  is_cross_district: boolean
  origin: Database["public"]["Enums"]["origin_type"]
  priority: number
  status: Database["public"]["Enums"]["transfer_status"]
  ai_reason: string | null
  ai_generated_at: string | null
  alert_id: string | null
  created_by: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  carrier_type: Database["public"]["Enums"]["carrier_type"] | null
  carrier_name: string | null
  carrier_contact: string | null
  dispatched_by: string | null
  dispatched_at: string | null
  received_by: string | null
  received_at: string | null
  received_qty: number | null
  created_at: string
  updated_at: string
}

type StockoutReportRow = { id: string; facility_id: string; medicine_id: string; reported_by: string | null; reported_at: string; note: string | null; stock_on_record: number; resolved_at: string | null; resolved_reason: string | null }

type IndentRow = {
  id: string
  facility_id: string
  warehouse_id: string
  medicine_id: string
  qty_requested: number
  qty_approved: number | null
  origin: Database["public"]["Enums"]["origin_type"]
  status: Database["public"]["Enums"]["indent_status"]
  ai_reason: string | null
  ai_generated_at: string | null
  note: string | null
  raised_by: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  carrier_type: Database["public"]["Enums"]["carrier_type"] | null
  carrier_name: string | null
  dispatched_by: string | null
  dispatched_at: string | null
  received_by: string | null
  received_at: string | null
  received_qty: number | null
  created_at: string
  updated_at: string
  awaiting_mo: boolean
  mo_decided_by: string | null
  mo_decided_at: string | null
}

type AlertRow = {
  id: string
  facility_id: string
  medicine_id: string | null
  type: Database["public"]["Enums"]["alert_type"]
  severity: Database["public"]["Enums"]["alert_severity"]
  status: Database["public"]["Enums"]["alert_status"]
  days_left: number | null
  message: string
  ai_summary: string | null
  ai_generated_at: string | null
  acknowledged_by: string | null
  acknowledged_at: string | null
  resolved_at: string | null
  created_at: string
  facts: Json | null
}

export type ItemType = "medicine" | "oxygen" | "consumable" | "vaccine" | "diagnostic"
export type Tier = "shc" | "phc_day" | "phc_24x7" | "chc" | "dh" | "warehouse"
export type BedType = "general" | "maternity" | "paediatric" | "icu" | "hdu" | "nicu" | "isolation" | "observation"
export type AttendanceStatus = "present_on_duty" | "absent" | "on_leave" | "on_deputation"

type ProfileRow = {
  id: string
  full_name: string
  role: Database["public"]["Enums"]["user_role"]
  facility_id: string | null
  district_id: string | null
  state_id: string | null
  phone: string | null
  preferred_language: string
  created_at: string
  is_active: boolean
  deactivated_at: string | null
  email: string | null
  phc_position: "staff" | "medical_officer"
  hpr_id: string | null
}

type MedicineRequestRow = {
  id: string
  facility_id: string
  state_id: string
  requested_by: string
  medicine_name: string
  strength: string | null
  unit: string
  category: string | null
  is_chronic: boolean
  monthly_qty: number | null
  reason: string
  status: "with_district" | "with_state" | "approved" | "rejected" | "cancelled"
  district_by: string | null
  district_at: string | null
  district_note: string | null
  state_by: string | null
  state_at: string | null
  state_note: string | null
  medicine_id: string | null
  created_at: string
}

type Nullable<T> = { [K in keyof T]: T[K] | null }

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      states: {
        Row: { id: string; name: string; code: string; created_at: string }
        Insert: { id?: string; name: string; code: string; created_at?: string }
        Update: { id?: string; name?: string; code?: string; created_at?: string }
        Relationships: []
      }
      districts: {
        Row: { id: string; state_id: string; name: string; code: string; created_at: string }
        Insert: { id?: string; state_id: string; name: string; code: string; created_at?: string }
        Update: { id?: string; state_id?: string; name?: string; code?: string; created_at?: string }
        Relationships: []
      }
      facilities: {
        Row: {
          id: string
          district_id: string
          type: Database["public"]["Enums"]["facility_type"]
          name: string
          code: string
          lat: number
          lng: number
          address: string | null
          total_beds: number
          resupply_days: number
          supplying_warehouse: string | null
          is_active: boolean
          created_at: string
          opened_on: string | null
          phc_24x7: boolean
          hfr_id: string | null
          hfr_extensions: Json
        }
        Insert: {
          id?: string
          opened_on?: string | null
          district_id: string
          type: Database["public"]["Enums"]["facility_type"]
          name: string
          code: string
          lat: number
          lng: number
          address?: string | null
          total_beds?: number
          resupply_days?: number
          supplying_warehouse?: string | null
          is_active?: boolean
          created_at?: string
          phc_24x7?: boolean
          hfr_id?: string | null
          hfr_extensions?: Json
        }
        Update: Partial<Database["public"]["Tables"]["facilities"]["Insert"]>
        Relationships: []
      }
      profiles: {
        Row: ProfileRow
        Insert: {
          id: string
          full_name: string
          role: Database["public"]["Enums"]["user_role"]
          facility_id?: string | null
          district_id?: string | null
          state_id?: string | null
          phone?: string | null
          preferred_language?: string
          created_at?: string
          is_active?: boolean
          deactivated_at?: string | null
          email?: string | null
          phc_position?: "staff" | "medical_officer"
        }
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>
        Relationships: []
      }
      medicines: {
        Row: {
          id: string
          name: string
          generic_name: string | null
          strength: string | null
          unit: string
          category: string
          is_essential: boolean
          created_at: string
          is_chronic: boolean
          status: "active" | "discontinued" | "withdrawn"
          status_date: string | null
          status_reason: string | null
          stocked_at: Database["public"]["Enums"]["facility_type"][]
          /** null = national list; otherwise that state's own list */
          state_id: string | null
          item_type: ItemType
          phc_24x7_only: boolean
          program: string | null
          gtin: string | null
        }
        Insert: {
          id?: string
          name: string
          generic_name?: string | null
          strength?: string | null
          unit: string
          category: string
          is_essential?: boolean
          created_at?: string
          is_chronic?: boolean
          status?: "active" | "discontinued" | "withdrawn"
          status_date?: string | null
          status_reason?: string | null
          stocked_at?: Database["public"]["Enums"]["facility_type"][]
          state_id?: string | null
          item_type?: ItemType
          phc_24x7_only?: boolean
          program?: string | null
          gtin?: string | null
        }
        Update: Partial<Database["public"]["Tables"]["medicines"]["Insert"]>
        Relationships: []
      }
      stock: {
        Row: { facility_id: string; medicine_id: string; quantity: number; updated_at: string }
        Insert: { facility_id: string; medicine_id: string; quantity?: number; updated_at?: string }
        Update: { facility_id?: string; medicine_id?: string; quantity?: number; updated_at?: string }
        Relationships: []
      }
      stock_log: {
        Row: {
          id: number
          facility_id: string
          medicine_id: string
          log_date: string
          qty_used: number
          qty_received: number
          qty_out: number
          source: Database["public"]["Enums"]["log_source"]
          ref_id: string | null
          note: string | null
          created_by: string | null
          created_at: string
          batch_no: string | null
          expiry_date: string | null
        }
        Insert: {
          facility_id: string
          medicine_id: string
          log_date?: string
          qty_used?: number
          qty_received?: number
          qty_out?: number
          batch_no?: string | null
          expiry_date?: string | null
          source?: Database["public"]["Enums"]["log_source"]
          ref_id?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["stock_log"]["Insert"]>
        Relationships: []
      }
      daily_reports: {
        Row: {
          facility_id: string
          report_date: string
          footfall: number
          occupied_beds: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          facility_id: string
          report_date?: string
          footfall?: number
          occupied_beds?: number
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["daily_reports"]["Insert"]>
        Relationships: []
      }
      staff: {
        Row: {
          id: string
          facility_id: string
          name: string
          role: Database["public"]["Enums"]["staff_role"]
          phone: string | null
          is_active: boolean
          created_at: string
          hpr_id: string | null
        }
        Insert: {
          id?: string
          facility_id: string
          name: string
          role: Database["public"]["Enums"]["staff_role"]
          hpr_id?: string | null
          phone?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["staff"]["Insert"]>
        Relationships: []
      }
      attendance: {
        Row: { staff_id: string; att_date: string; present: boolean; marked_by: string | null; status: AttendanceStatus | null }
        Insert: { staff_id: string; att_date?: string; present: boolean; marked_by?: string | null; status?: AttendanceStatus | null }
        Update: { staff_id?: string; att_date?: string; present?: boolean; marked_by?: string | null; status?: AttendanceStatus | null }
        Relationships: []
      }
      forecasts: {
        Row: {
          facility_id: string
          medicine_id: string
          generated_at: string
          method: string
          predicted_daily_use: number
          lower_daily: number | null
          upper_daily: number | null
          forecast_7d: number | null
          forecast_30d: number | null
          days_left: number | null
          stockout_date: string | null
          mape: number | null
          series: Json | null
          footfall_weight: number | null
          seasonality_source: string | null
          surge: boolean
        }
        Insert: {
          facility_id: string
          medicine_id: string
          generated_at?: string
          method: string
          predicted_daily_use: number
          lower_daily?: number | null
          upper_daily?: number | null
          forecast_7d?: number | null
          forecast_30d?: number | null
          days_left?: number | null
          stockout_date?: string | null
          mape?: number | null
          series?: Json | null
          footfall_weight?: number | null
          seasonality_source?: string | null
          surge?: boolean
        }
        Update: Partial<Database["public"]["Tables"]["forecasts"]["Insert"]>
        Relationships: []
      }
      alerts: {
        Row: AlertRow
        Insert: {
          id?: string
          facility_id: string
          medicine_id?: string | null
          type: Database["public"]["Enums"]["alert_type"]
          severity: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["alert_status"]
          days_left?: number | null
          message: string
          ai_summary?: string | null
          ai_generated_at?: string | null
          acknowledged_by?: string | null
          acknowledged_at?: string | null
          resolved_at?: string | null
          created_at?: string
          facts?: Json | null
        }
        Update: Partial<Database["public"]["Tables"]["alerts"]["Insert"]>
        Relationships: []
      }
      transfers: {
        Row: TransferRow
        Insert: Partial<TransferRow> & {
          medicine_id: string
          from_facility_id: string
          to_facility_id: string
          qty: number
        }
        Update: Partial<TransferRow>
        Relationships: []
      }
      indents: {
        Row: IndentRow
        Insert: Partial<IndentRow> & {
          facility_id: string
          warehouse_id: string
          medicine_id: string
          qty_requested: number
        }
        Update: Partial<IndentRow>
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          body: string | null
          ref_table: string | null
          ref_id: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          body?: string | null
          ref_table?: string | null
          ref_id?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          read_at?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>
        Relationships: []
      }
      ai_briefs: {
        Row: {
          id: string
          scope_type: string
          scope_id: string
          content: string
          facts: Json | null
          generated_at: string
        }
        Insert: {
          id?: string
          scope_type: string
          scope_id: string
          content: string
          facts?: Json | null
          generated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["ai_briefs"]["Insert"]>
        Relationships: []
      }
      outbreaks: {
        Row: {
          id: string
          district_id: string
          category: string
          medicine_ids: string[]
          facility_ids: string[]
          status: "open" | "resolved"
          message: string
          facts: Json | null
          ai_summary: string | null
          ai_generated_at: string | null
          detected_at: string
          updated_at: string
          resolved_at: string | null
        }
        Insert: Partial<Database["public"]["Tables"]["outbreaks"]["Row"]> & { district_id: string; category: string; message: string }
        Update: Partial<Database["public"]["Tables"]["outbreaks"]["Row"]>
        Relationships: []
      }
      stock_batches: {
        Row: {
          id: string
          facility_id: string
          medicine_id: string
          batch_no: string
          expiry_date: string
          qty: number
          status: "active" | "written_off"
          received_on: string
          created_at: string
        }
        Insert: Partial<Database["public"]["Tables"]["stock_batches"]["Row"]> & {
          facility_id: string
          medicine_id: string
          batch_no: string
          expiry_date: string
        }
        Update: Partial<Database["public"]["Tables"]["stock_batches"]["Row"]>
        Relationships: []
      }
      batch_movements: {
        Row: { id: number; stock_log_id: number; batch_id: string; qty: number; created_at: string }
        Insert: { stock_log_id: number; batch_id: string; qty: number; created_at?: string }
        Update: Partial<Database["public"]["Tables"]["batch_movements"]["Insert"]>
        Relationships: []
      }
      audit_log: {
        Row: {
          id: number
          at: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          action: string
          entity_type: string
          entity_id: string | null
          entity_name: string | null
          state_id: string | null
          before: Json | null
          after: Json | null
          note: string | null
        }
        Insert: Partial<Database["public"]["Tables"]["audit_log"]["Row"]> & { action: string; entity_type: string }
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Row"]>
        Relationships: []
      }
      tier_bed_types: {
        Row: { tier: Tier; bed_type: BedType }
        Insert: { tier: Tier; bed_type: BedType }
        Update: Partial<{ tier: Tier; bed_type: BedType }>
        Relationships: []
      }
      facility_beds: {
        Row: { facility_id: string; bed_type: BedType; total: number; updated_at: string }
        Insert: { facility_id: string; bed_type: BedType; total: number; updated_at?: string }
        Update: Partial<{ facility_id: string; bed_type: BedType; total: number; updated_at: string }>
        Relationships: []
      }
      daily_bed_occupancy: {
        Row: { facility_id: string; report_date: string; bed_type: BedType; occupied: number; created_by: string | null }
        Insert: { facility_id: string; report_date?: string; bed_type: BedType; occupied: number; created_by?: string | null }
        Update: Partial<{ facility_id: string; report_date: string; bed_type: BedType; occupied: number; created_by: string | null }>
        Relationships: []
      }
      jan_aushadhi_kendras: {
        Row: { id: string; district_id: string; name: string; address: string | null; lat: number; lng: number; created_at: string }
        Insert: { id?: string; district_id: string; name: string; address?: string | null; lat: number; lng: number; created_at?: string }
        Update: Partial<{ district_id: string; name: string; address: string | null; lat: number; lng: number }>
        Relationships: []
      }
      stockout_reports: {
        Row: StockoutReportRow
        Insert: Partial<StockoutReportRow> & { facility_id: string; medicine_id: string }
        Update: Partial<StockoutReportRow>
        Relationships: []
      }
      medicine_requests: {
        Row: MedicineRequestRow
        Insert: Partial<MedicineRequestRow>
        Update: Partial<MedicineRequestRow>
        Relationships: []
      }
      admin_handovers: {
        Row: {
          id: string
          scope_type: "state" | "national"
          scope_id: string | null
          from_user: string
          to_user: string
          to_name: string | null
          to_email: string | null
          old_admin_action: "demote" | "deactivate"
          demote_role: Database["public"]["Enums"]["user_role"] | null
          demote_facility: string | null
          demote_district: string | null
          demote_state: string | null
          status: "pending" | "accepted" | "declined" | "cancelled"
          created_at: string
          decided_at: string | null
        }
        Insert: Partial<Database["public"]["Tables"]["admin_handovers"]["Row"]>
        Update: Partial<Database["public"]["Tables"]["admin_handovers"]["Row"]>
        Relationships: []
      }
      facility_bed_changes: {
        Row: {
          id: string
          facility_id: string
          total_beds: number
          effective_from: string
          applied_at: string | null
          changed_by: string | null
          created_at: string
        }
        Insert: Partial<Database["public"]["Tables"]["facility_bed_changes"]["Row"]> & {
          facility_id: string
          total_beds: number
          effective_from: string
        }
        Update: Partial<Database["public"]["Tables"]["facility_bed_changes"]["Row"]>
        Relationships: []
      }
      seasonal_profiles: {
        Row: { level: "district" | "state" | "national"; scope_id: string; medicine_id: string; ratio: number; n: number; computed_on: string }
        Insert: { level: "district" | "state" | "national"; scope_id: string; medicine_id: string; ratio: number; n: number; computed_on?: string }
        Update: Partial<Database["public"]["Tables"]["seasonal_profiles"]["Insert"]>
        Relationships: []
      }
      app_settings: {
        Row: { key: string; value: Json }
        Insert: { key: string; value: Json }
        Update: { key?: string; value?: Json }
        Relationships: []
      }
    }
    Views: {
      v_stock_status: {
        Row: Nullable<{
          facility_id: string
          facility_name: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          facility_code: string
          lat: number
          lng: number
          district_id: string
          district_name: string
          state_id: string
          medicine_id: string
          medicine_name: string
          unit: string
          category: string
          quantity: number
          updated_at: string
          predicted_daily_use: number
          lower_daily: number
          upper_daily: number
          days_left: number
          stockout_date: string
          mape: number
          forecast_at: string
          resupply_days: number
          status: string
          medicine_status: string
          is_chronic: boolean
          method: string
          seasonality_source: string
          footfall_weight: number
          surge: boolean
          item_type: ItemType
          program: string
          tier: Tier
        }>
        Relationships: []
      }
      v_facility_summary: {
        Row: Nullable<{
          facility_id: string
          name: string
          type: Database["public"]["Enums"]["facility_type"]
          code: string
          lat: number
          lng: number
          total_beds: number
          resupply_days: number
          district_id: string
          district_name: string
          state_id: string
          critical_count: number
          low_count: number
          ok_count: number
          overstock_count: number
          min_days_left: number
          open_alerts: number
          occupied_beds: number
          last_footfall: number
          attendance_rate_7d: number
          overall_status: string
          open_surges: number
          tier: Tier
          phc_24x7: boolean
          hfr_id: string
          hfr_extensions: Json
          supplying_warehouse: string
          critical_beds_total: number
          critical_beds_occupied: number
        }>
        Relationships: []
      }
      v_district_summary: {
        Row: Nullable<{
          district_id: string
          name: string
          state_id: string
          facilities: number
          facilities_critical: number
          critical_items: number
          low_items: number
          overstock_items: number
          open_alerts: number
          transfers_pending: number
          indents_pending: number
          attendance_rate_7d: number
        }>
        Relationships: []
      }
      v_transfers: {
        Row: Nullable<
          TransferRow & {
            medicine_name: string
            unit: string
            from_name: string
            from_type: Database["public"]["Enums"]["facility_type"]
            from_district_id: string
            from_lat: number
            from_lng: number
            to_name: string
            to_type: Database["public"]["Enums"]["facility_type"]
            to_district_id: string
            to_lat: number
            to_lng: number
            approved_by_name: string
          }
        >
        Relationships: []
      }
      v_medicine_requests: {
        Row: Nullable<
          MedicineRequestRow & {
            facility_name: string
            district_id: string
            district_name: string
            state_name: string
            requested_by_name: string
            requested_by_position: "staff" | "medical_officer"
            district_by_name: string
            state_by_name: string
            linked_medicine_name: string
          }
        >
        Relationships: []
      }
      v_indents: {
        Row: Nullable<
          IndentRow & {
            medicine_name: string
            unit: string
            facility_name: string
            district_id: string
            warehouse_name: string
            raised_by_name: string
            approved_by_name: string
            mo_decided_by_name: string
          }
        >
        Relationships: []
      }
    }
    Functions: {
      me: { Args: never; Returns: ProfileRow }
      is_medical_officer_of: { Args: { p_facility: string }; Returns: boolean }
      mo_decide_indent: { Args: { p_id: string; p_approve: boolean; p_reason?: string }; Returns: IndentRow }
      admin_set_phc_position: { Args: { p_id: string; p_position: "staff" | "medical_officer" }; Returns: ProfileRow }
      my_role: { Args: never; Returns: Database["public"]["Enums"]["user_role"] }
      can_view_facility: { Args: { fid: string }; Returns: boolean }
      can_write_facility: { Args: { fid: string }; Returns: boolean }
      facility_district: { Args: { fid: string }; Returns: string }
      facility_state: { Args: { fid: string }; Returns: string }
      haversine_km: {
        Args: { lat1: number; lng1: number; lat2: number; lng2: number }
        Returns: number
      }
      approve_transfer: {
        Args: {
          p_id: string
          p_carrier_type: Database["public"]["Enums"]["carrier_type"]
          p_carrier_name?: string
          p_carrier_contact?: string
        }
        Returns: TransferRow
      }
      reject_transfer: { Args: { p_id: string; p_reason: string }; Returns: TransferRow }
      dispatch_transfer: { Args: { p_id: string }; Returns: TransferRow }
      receive_transfer: { Args: { p_id: string; p_received_qty?: number }; Returns: TransferRow }
      create_manual_transfer: {
        Args: { p_medicine: string; p_from: string; p_to: string; p_qty: number; p_reason?: string }
        Returns: TransferRow
      }
      raise_indent: {
        Args: { p_medicine: string; p_qty: number; p_note?: string }
        Returns: IndentRow
      }
      approve_indent: { Args: { p_id: string; p_qty_approved?: number }; Returns: IndentRow }
      reject_indent: { Args: { p_id: string; p_reason: string }; Returns: IndentRow }
      dispatch_indent: {
        Args: {
          p_id: string
          p_carrier_type?: Database["public"]["Enums"]["carrier_type"]
          p_carrier_name?: string
        }
        Returns: IndentRow
      }
      receive_indent: { Args: { p_id: string; p_received_qty?: number }; Returns: IndentRow }
      acknowledge_alert: { Args: { p_id: string }; Returns: AlertRow }
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: undefined }
      set_my_language: { Args: { p_lang: string }; Returns: undefined }
      is_national: { Args: never; Returns: boolean }
      can_view_district: { Args: { did: string }; Returns: boolean }
      is_admin_of_state: { Args: { p_state: string }; Returns: boolean }
      admin_can_manage: {
        Args: { p_role: string; p_facility: string | null; p_district: string | null; p_state: string | null }
        Returns: boolean
      }
      admin_save_facility: {
        Args: {
          p_id: string | null
          p_district: string
          p_type: Database["public"]["Enums"]["facility_type"]
          p_name: string
          p_code: string
          p_lat: number
          p_lng: number
          p_address?: string
          p_total_beds?: number
          p_resupply_days?: number
          p_supplying_warehouse?: string
          p_opened_on?: string
          p_phc_24x7?: boolean
          p_hfr_id?: string
          p_hfr_extensions?: Json
        }
        Returns: Database["public"]["Tables"]["facilities"]["Row"]
      }
      admin_set_facility_active: {
        Args: { p_id: string; p_active: boolean; p_reason?: string }
        Returns: Database["public"]["Tables"]["facilities"]["Row"]
      }
      admin_change_beds: {
        Args: { p_id: string; p_total_beds: number; p_effective?: string }
        Returns: Database["public"]["Tables"]["facility_bed_changes"]["Row"]
      }
      admin_import_facilities: { Args: { p_rows: Json }; Returns: number }
      admin_save_medicine: {
        Args: {
          p_id: string | null
          p_name: string
          p_generic: string
          p_strength: string
          p_unit: string
          p_category: string
          p_is_chronic?: boolean
          p_stocked_at?: Database["public"]["Enums"]["facility_type"][]
          p_state?: string
          p_item_type?: ItemType
          p_phc_24x7_only?: boolean
          p_program?: string
          p_gtin?: string
        }
        Returns: Database["public"]["Tables"]["medicines"]["Row"]
      }
      admin_set_facility_beds: { Args: { p_id: string; p_beds: Json }; Returns: Database["public"]["Tables"]["facilities"]["Row"] }
      admin_set_registry_ids: { Args: { p_person: string; p_hpr_id: string }; Returns: ProfileRow }
      report_stockout: { Args: { p_facility: string; p_medicine: string; p_note?: string | null }; Returns: StockoutReportRow }
      withdraw_stockout: { Args: { p_id: string }; Returns: StockoutReportRow }
      item_allowed: { Args: { p_facility: string; p_item: string }; Returns: boolean }
      engine_critical_beds: {
        Args: { p_district?: string; p_days?: number }
        Returns: { facility_id: string; occupied: number[]; reported: boolean[] }[]
      }
      facility_has_medical_officer: { Args: { p_facility: string }; Returns: boolean }
      request_new_medicine: {
        Args: {
          p_name: string
          p_strength: string
          p_unit: string
          p_category: string
          p_reason: string
          p_monthly_qty?: number
          p_is_chronic?: boolean
        }
        Returns: MedicineRequestRow
      }
      cancel_medicine_request: { Args: { p_id: string }; Returns: MedicineRequestRow }
      district_decide_medicine_request: { Args: { p_id: string; p_support: boolean; p_note?: string }; Returns: MedicineRequestRow }
      state_decide_medicine_request: {
        Args: {
          p_id: string
          p_approve: boolean
          p_note?: string
          p_existing?: string
          p_name?: string
          p_unit?: string
          p_category?: string
        }
        Returns: MedicineRequestRow
      }
      admin_set_medicine_status: {
        Args: { p_id: string; p_status: string; p_date?: string; p_reason?: string }
        Returns: Database["public"]["Tables"]["medicines"]["Row"]
      }
      admin_add_batch: {
        Args: { p_facility: string; p_medicine: string; p_batch_no: string; p_expiry: string; p_qty: number }
        Returns: Database["public"]["Tables"]["stock_batches"]["Row"]
      }
      admin_write_off_batch: {
        Args: { p_batch: string; p_reason: string }
        Returns: Database["public"]["Tables"]["stock_batches"]["Row"]
      }
      admin_update_person: {
        Args: {
          p_id: string
          p_full_name: string
          p_phone: string | null
          p_role: Database["public"]["Enums"]["user_role"]
          p_facility?: string
          p_district?: string
          p_state?: string
        }
        Returns: ProfileRow
      }
      admin_set_person_active: { Args: { p_id: string; p_active: boolean; p_reason?: string }; Returns: ProfileRow }
      admin_create_profile: {
        Args: {
          p_actor: string
          p_user: string
          p_email: string
          p_full_name: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_facility?: string
          p_district?: string
          p_state?: string
        }
        Returns: ProfileRow
      }
      request_admin_handover: {
        Args: {
          p_to_user: string
          p_old_action: string
          p_demote_role?: Database["public"]["Enums"]["user_role"]
          p_demote_facility?: string
          p_demote_district?: string
          p_demote_state?: string
        }
        Returns: Database["public"]["Tables"]["admin_handovers"]["Row"]
      }
      accept_admin_handover: {
        Args: { p_id: string; p_full_name?: string }
        Returns: Database["public"]["Tables"]["admin_handovers"]["Row"]
      }
      decide_admin_handover: {
        Args: { p_id: string; p_decision: string }
        Returns: Database["public"]["Tables"]["admin_handovers"]["Row"]
      }
      admin_set_state_admin: {
        Args: {
          p_state: string
          p_user: string
          p_old_admin?: string
          p_old_action?: string
          p_demote_role?: Database["public"]["Enums"]["user_role"]
          p_demote_facility?: string
          p_demote_district?: string
        }
        Returns: ProfileRow
      }
      log_audit: {
        Args: {
          p_action: string
          p_entity_type: string
          p_entity_id: string | null
          p_entity_name: string | null
          p_state: string | null
          p_before: Json | null
          p_after: Json | null
          p_note?: string
          p_actor?: string
        }
        Returns: undefined
      }
      write_off_expired: { Args: never; Returns: number }
      apply_due_bed_changes: { Args: never; Returns: number }
      engine_series2: {
        Args: { p_district?: string; p_days?: number }
        Returns: {
          facility_id: string
          medicine_id: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          district_id: string
          resupply_days: number
          stock: number
          start_date: string
          used: number[]
          received: number[]
          outflow: number[]
          wasted: number[]
          reported: boolean[]
        }[]
      }
      engine_series3: {
        Args: { p_district?: string; p_days?: number }
        Returns: {
          facility_id: string
          medicine_id: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          district_id: string
          resupply_days: number
          stock: number
          start_date: string
          idx: number[]
          used: number[]
          received: number[]
          outflow: number[]
          wasted: number[]
          reported_idx: number[]
        }[]
      }
      engine_footfall: {
        Args: { p_district?: string; p_days?: number }
        Returns: {
          facility_id: string
          district_id: string
          total_beds: number
          start_date: string
          footfall: number[]
          occupied: number[]
          reported: boolean[]
        }[]
      }
      engine_series: {
        Args: { p_district?: string; p_days?: number }
        Returns: {
          facility_id: string
          medicine_id: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          district_id: string
          resupply_days: number
          stock: number
          start_date: string
          used: number[]
          received: number[]
          outflow: number[]
          reported: boolean[]
        }[]
      }
    }
    Enums: {
      facility_type: "phc" | "chc" | "warehouse" | "shc" | "dh"
      user_role: "phc_staff" | "warehouse_manager" | "district_officer" | "state_admin" | "national_admin"
      staff_role:
        | "medical_officer"
        | "nurse"
        | "pharmacist"
        | "lab_technician"
        | "health_worker"
        | "other"
      log_source: "manual" | "voice" | "transfer" | "indent" | "adjustment" | "seed" | "wastage"
      alert_type: "stockout_risk" | "overstock" | "staff_shortage" | "bed_pressure" | "demand_surge" | "expiry_risk"
      alert_severity: "critical" | "warning" | "info"
      alert_status: "open" | "acknowledged" | "resolved"
      transfer_status: "proposed" | "approved" | "rejected" | "dispatched" | "received" | "cancelled"
      indent_status: "submitted" | "approved" | "rejected" | "dispatched" | "received" | "cancelled"
      carrier_type: "warehouse_vehicle" | "facility_staff" | "courier" | "other"
      origin_type: "ai" | "manual"
      notification_channel: "in_app" | "email" | "whatsapp" | "sms"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]
