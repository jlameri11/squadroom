export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      academies: {
        Row: {
          block_rsvp_when_overdue: boolean
          club_mode: boolean
          contact_email: string | null
          created_at: string
          created_by: string | null
          directory_visibility: Database["public"]["Enums"]["directory_visibility"]
          dm_policy: Database["public"]["Enums"]["dm_policy"]
          fee_reminders: boolean
          id: string
          logo_url: string | null
          miniroos_scores: boolean
          name: string
          overdue_grace_days: number
          plan: string
          playfootball_fees_disclosed_at: string | null
          playfootball_fees_disclosed_season: string | null
          primary_colour: string
          public_player_names: Database["public"]["Enums"]["public_names_mode"]
          secondary_colour: string | null
          setup_completed_at: string | null
          setup_started_at: string
          sibling_discount_bps: number[]
          slug: string
          timezone: string
          two_step_required: boolean
          type: Database["public"]["Enums"]["org_type"]
          updated_at: string
        }
        Insert: {
          block_rsvp_when_overdue?: boolean
          club_mode?: boolean
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          directory_visibility?: Database["public"]["Enums"]["directory_visibility"]
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          fee_reminders?: boolean
          id?: string
          logo_url?: string | null
          miniroos_scores?: boolean
          name: string
          overdue_grace_days?: number
          plan?: string
          playfootball_fees_disclosed_at?: string | null
          playfootball_fees_disclosed_season?: string | null
          primary_colour?: string
          public_player_names?: Database["public"]["Enums"]["public_names_mode"]
          secondary_colour?: string | null
          setup_completed_at?: string | null
          setup_started_at?: string
          sibling_discount_bps?: number[]
          slug: string
          timezone?: string
          two_step_required?: boolean
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
        }
        Update: {
          block_rsvp_when_overdue?: boolean
          club_mode?: boolean
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          directory_visibility?: Database["public"]["Enums"]["directory_visibility"]
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          fee_reminders?: boolean
          id?: string
          logo_url?: string | null
          miniroos_scores?: boolean
          name?: string
          overdue_grace_days?: number
          plan?: string
          playfootball_fees_disclosed_at?: string | null
          playfootball_fees_disclosed_season?: string | null
          primary_colour?: string
          public_player_names?: Database["public"]["Enums"]["public_names_mode"]
          secondary_colour?: string | null
          setup_completed_at?: string | null
          setup_started_at?: string
          sibling_discount_bps?: number[]
          slug?: string
          timezone?: string
          two_step_required?: boolean
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_billing: {
        Row: {
          academy_id: string
          becs_enabled: boolean
          charges_enabled: boolean
          connected_at: string | null
          country: string
          currency: string
          details_submitted: boolean
          payouts_enabled: boolean
          requirements: Json | null
          stripe_account_id: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          becs_enabled?: boolean
          charges_enabled?: boolean
          connected_at?: string | null
          country?: string
          currency?: string
          details_submitted?: boolean
          payouts_enabled?: boolean
          requirements?: Json | null
          stripe_account_id?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          becs_enabled?: boolean
          charges_enabled?: boolean
          connected_at?: string | null
          country?: string
          currency?: string
          details_submitted?: boolean
          payouts_enabled?: boolean
          requirements?: Json | null
          stripe_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_billing_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: true
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_features: {
        Row: {
          academy_id: string
          changed_at: string
          changed_by: string | null
          enabled: boolean
          feature: string
        }
        Insert: {
          academy_id: string
          changed_at?: string
          changed_by?: string | null
          enabled: boolean
          feature: string
        }
        Update: {
          academy_id?: string
          changed_at?: string
          changed_by?: string | null
          enabled?: boolean
          feature?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_features_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_features_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_invites: {
        Row: {
          academy_name_hint: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          note: string | null
          redeemed_academy: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          revoked_at: string | null
          token: string
        }
        Insert: {
          academy_name_hint?: string | null
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          note?: string | null
          redeemed_academy?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          revoked_at?: string | null
          token?: string
        }
        Update: {
          academy_name_hint?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          note?: string | null
          redeemed_academy?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_invites_redeemed_academy_fkey"
            columns: ["redeemed_academy"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_invites_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_members: {
        Row: {
          academy_id: string
          id: string
          invited_by: string | null
          joined_at: string
          profile_id: string
          removed_at: string | null
          role: Database["public"]["Enums"]["academy_role"]
          roles: Database["public"]["Enums"]["academy_role"][]
          status: Database["public"]["Enums"]["member_status"]
        }
        Insert: {
          academy_id: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          profile_id: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["academy_role"]
          roles?: Database["public"]["Enums"]["academy_role"][]
          status?: Database["public"]["Enums"]["member_status"]
        }
        Update: {
          academy_id?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          profile_id?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["academy_role"]
          roles?: Database["public"]["Enums"]["academy_role"][]
          status?: Database["public"]["Enums"]["member_status"]
        }
        Relationships: [
          {
            foreignKeyName: "academy_members_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_sponsors: {
        Row: {
          academy_id: string
          active: boolean
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slots: string[]
          sort: number
          tagline: string | null
          url: string | null
        }
        Insert: {
          academy_id: string
          active?: boolean
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slots?: string[]
          sort?: number
          tagline?: string | null
          url?: string | null
        }
        Update: {
          academy_id?: string
          active?: boolean
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slots?: string[]
          sort?: number
          tagline?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_sponsors_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      account_emails: {
        Row: {
          created_at: string
          email: string
          news_opt_in_at: string | null
          profile_id: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          news_opt_in_at?: string | null
          profile_id: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          news_opt_in_at?: string | null
          profile_id?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_emails_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_log: {
        Row: {
          academy_id: string
          action: string
          actor_id: string | null
          at: string
          detail: Json
          id: number
          subject_id: string | null
          subject_kind: string | null
          subject_name: string | null
        }
        Insert: {
          academy_id: string
          action: string
          actor_id?: string | null
          at?: string
          detail?: Json
          id?: number
          subject_id?: string | null
          subject_kind?: string | null
          subject_name?: string | null
        }
        Update: {
          academy_id?: string
          action?: string
          actor_id?: string | null
          at?: string
          detail?: Json
          id?: number
          subject_id?: string | null
          subject_kind?: string | null
          subject_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feeds: {
        Row: {
          created_at: string
          last_read_at: string | null
          profile_id: string
          read_count: number
          token: string
        }
        Insert: {
          created_at?: string
          last_read_at?: string | null
          profile_id: string
          read_count?: number
          token?: string
        }
        Update: {
          created_at?: string
          last_read_at?: string | null
          profile_id?: string
          read_count?: number
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feeds_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_members: {
        Row: {
          academy_id: string
          channel_id: string
          id: string
          joined_at: string
          last_read_at: string
          muted: boolean
          profile_id: string
          role: Database["public"]["Enums"]["channel_member_role"]
        }
        Insert: {
          academy_id: string
          channel_id: string
          id?: string
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          profile_id: string
          role?: Database["public"]["Enums"]["channel_member_role"]
        }
        Update: {
          academy_id?: string
          channel_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          profile_id?: string
          role?: Database["public"]["Enums"]["channel_member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "channel_members_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_members_channel_fkey"
            columns: ["channel_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "channel_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          academy_id: string
          age_group: string | null
          archived_at: string | null
          competition_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          dm_key: string | null
          icon_url: string | null
          id: string
          name: string | null
          posting_mode: Database["public"]["Enums"]["posting_mode"]
          restrictions: Json
          status: Database["public"]["Enums"]["channel_status"]
          stream_id: string | null
          team_id: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at: string
        }
        Insert: {
          academy_id: string
          age_group?: string | null
          archived_at?: string | null
          competition_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dm_key?: string | null
          icon_url?: string | null
          id?: string
          name?: string | null
          posting_mode?: Database["public"]["Enums"]["posting_mode"]
          restrictions?: Json
          status?: Database["public"]["Enums"]["channel_status"]
          stream_id?: string | null
          team_id?: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Update: {
          academy_id?: string
          age_group?: string | null
          archived_at?: string | null
          competition_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dm_key?: string | null
          icon_url?: string | null
          id?: string
          name?: string | null
          posting_mode?: Database["public"]["Enums"]["posting_mode"]
          restrictions?: Json
          status?: Database["public"]["Enums"]["channel_status"]
          stream_id?: string | null
          team_id?: string | null
          type?: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_stream_fkey"
            columns: ["stream_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "channels_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      club_message_recipients: {
        Row: {
          academy_id: string
          message_id: string
          notified_at: string | null
          profile_id: string
          seen_at: string | null
        }
        Insert: {
          academy_id: string
          message_id: string
          notified_at?: string | null
          profile_id: string
          seen_at?: string | null
        }
        Update: {
          academy_id?: string
          message_id?: string
          notified_at?: string | null
          profile_id?: string
          seen_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_message_recipients_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_message_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "club_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_message_recipients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      club_messages: {
        Row: {
          academy_id: string
          attachments: Json
          audience: Json
          body: string
          created_at: string
          id: string
          pinned: boolean
          recipient_count: number
          relevant_until: string | null
          sender_id: string | null
          sent_at: string | null
          status: string
          urgent: boolean
        }
        Insert: {
          academy_id: string
          attachments?: Json
          audience?: Json
          body: string
          created_at?: string
          id?: string
          pinned?: boolean
          recipient_count?: number
          relevant_until?: string | null
          sender_id?: string | null
          sent_at?: string | null
          status?: string
          urgent?: boolean
        }
        Update: {
          academy_id?: string
          attachments?: Json
          audience?: Json
          body?: string
          created_at?: string
          id?: string
          pinned?: boolean
          recipient_count?: number
          relevant_until?: string | null
          sender_id?: string | null
          sent_at?: string | null
          status?: string
          urgent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "club_messages_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      club_roles: {
        Row: {
          academy_id: string
          age_group: string | null
          created_at: string
          granted_by: string | null
          id: string
          profile_id: string
          role: Database["public"]["Enums"]["club_role"]
          scope_kind: string
          stream_id: string | null
          team_id: string | null
        }
        Insert: {
          academy_id: string
          age_group?: string | null
          created_at?: string
          granted_by?: string | null
          id?: string
          profile_id: string
          role: Database["public"]["Enums"]["club_role"]
          scope_kind?: string
          stream_id?: string | null
          team_id?: string | null
        }
        Update: {
          academy_id?: string
          age_group?: string | null
          created_at?: string
          granted_by?: string | null
          id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["club_role"]
          scope_kind?: string
          stream_id?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_roles_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_roles_stream_fkey"
            columns: ["stream_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "club_roles_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      competition_announcements: {
        Row: {
          body: string
          club_count: number
          competition_id: string
          id: string
          sent_at: string
          sent_by: string
          urgent: boolean
        }
        Insert: {
          body: string
          club_count?: number
          competition_id: string
          id?: string
          sent_at?: string
          sent_by: string
          urgent?: boolean
        }
        Update: {
          body?: string
          club_count?: number
          competition_id?: string
          id?: string
          sent_at?: string
          sent_by?: string
          urgent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "competition_announcements_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_announcements_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_clubs: {
        Row: {
          academy_id: string
          competition_id: string
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          status: string
        }
        Insert: {
          academy_id: string
          competition_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          status?: string
        }
        Update: {
          academy_id?: string
          competition_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_clubs_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_clubs_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_clubs_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_discipline_rules: {
        Row: {
          competition_id: string
          games_per_red: number
          games_per_yellow_suspension: number
          updated_at: string
          yellows_per_suspension: number
        }
        Insert: {
          competition_id: string
          games_per_red?: number
          games_per_yellow_suspension?: number
          updated_at?: string
          yellows_per_suspension?: number
        }
        Update: {
          competition_id?: string
          games_per_red?: number
          games_per_yellow_suspension?: number
          updated_at?: string
          yellows_per_suspension?: number
        }
        Relationships: [
          {
            foreignKeyName: "competition_discipline_rules_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: true
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_divisions: {
        Row: {
          age_group: string | null
          allow_playing_up: boolean
          born_after: string | null
          born_before: string | null
          borrow_cap: number | null
          competition_id: string
          division: string
          finals_min_games: number | null
          forfeit_score: number
          grading_note: string | null
          id: string
          ladder_enabled: boolean
          match_length_mins: number | null
          pitch_size: string | null
          points_draw: number
          points_loss: number
          points_win: number
          rank: number | null
          scores_public: boolean
          sheet_lock_mins: number
          squad_size_max: number | null
          tie_break: string
          updated_at: string
        }
        Insert: {
          age_group?: string | null
          allow_playing_up?: boolean
          born_after?: string | null
          born_before?: string | null
          borrow_cap?: number | null
          competition_id: string
          division: string
          finals_min_games?: number | null
          forfeit_score?: number
          grading_note?: string | null
          id?: string
          ladder_enabled?: boolean
          match_length_mins?: number | null
          pitch_size?: string | null
          points_draw?: number
          points_loss?: number
          points_win?: number
          rank?: number | null
          scores_public?: boolean
          sheet_lock_mins?: number
          squad_size_max?: number | null
          tie_break?: string
          updated_at?: string
        }
        Update: {
          age_group?: string | null
          allow_playing_up?: boolean
          born_after?: string | null
          born_before?: string | null
          borrow_cap?: number | null
          competition_id?: string
          division?: string
          finals_min_games?: number | null
          forfeit_score?: number
          grading_note?: string | null
          id?: string
          ladder_enabled?: boolean
          match_length_mins?: number | null
          pitch_size?: string | null
          points_draw?: number
          points_loss?: number
          points_win?: number
          rank?: number | null
          scores_public?: boolean
          sheet_lock_mins?: number
          squad_size_max?: number | null
          tie_break?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_divisions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_entries: {
        Row: {
          academy_id: string | null
          competition_id: string
          created_at: string
          display_name: string
          division: string
          group_label: string | null
          id: string
          nominated_at: string | null
          nomination_note: string | null
          proposed_division: string | null
          seed: number | null
          squad_locked_at: string | null
          team_id: string | null
        }
        Insert: {
          academy_id?: string | null
          competition_id: string
          created_at?: string
          display_name: string
          division: string
          group_label?: string | null
          id?: string
          nominated_at?: string | null
          nomination_note?: string | null
          proposed_division?: string | null
          seed?: number | null
          squad_locked_at?: string | null
          team_id?: string | null
        }
        Update: {
          academy_id?: string | null
          competition_id?: string
          created_at?: string
          display_name?: string
          division?: string
          group_label?: string | null
          id?: string
          nominated_at?: string | null
          nomination_note?: string | null
          proposed_division?: string | null
          seed?: number | null
          squad_locked_at?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_entries_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entries_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      competition_entry_requests: {
        Row: {
          club_name: string
          competition_id: string
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          division: string | null
          entry_id: string | null
          id: string
          invite_id: string | null
          ip_hash: string | null
          note: string | null
          status: string
          team_name: string
        }
        Insert: {
          club_name: string
          competition_id: string
          contact_email?: string | null
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          division?: string | null
          entry_id?: string | null
          id?: string
          invite_id?: string | null
          ip_hash?: string | null
          note?: string | null
          status?: string
          team_name: string
        }
        Update: {
          club_name?: string
          competition_id?: string
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          division?: string | null
          entry_id?: string | null
          id?: string
          invite_id?: string | null
          ip_hash?: string | null
          note?: string | null
          status?: string
          team_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_entry_requests_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entry_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entry_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entry_requests_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "competition_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_fees: {
        Row: {
          competition_id: string
          division: string
          fee_cents: number
          instructions: string | null
          updated_at: string
        }
        Insert: {
          competition_id: string
          division?: string
          fee_cents: number
          instructions?: string | null
          updated_at?: string
        }
        Update: {
          competition_id?: string
          division?: string
          fee_cents?: number
          instructions?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_fees_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_invites: {
        Row: {
          club_name: string
          competition_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          entry_id: string | null
          expires_at: string
          id: string
          invited_by: string
          redeemed_academy: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          status: string
          token: string
        }
        Insert: {
          club_name: string
          competition_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          entry_id?: string | null
          expires_at?: string
          id?: string
          invited_by: string
          redeemed_academy?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          status?: string
          token?: string
        }
        Update: {
          club_name?: string
          competition_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          entry_id?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          redeemed_academy?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_invites_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_invites_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_invites_redeemed_academy_fkey"
            columns: ["redeemed_academy"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_invites_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_levies: {
        Row: {
          competition_id: string
          division: string
          instructions: string | null
          levy_cents: number
          updated_at: string
        }
        Insert: {
          competition_id: string
          division?: string
          instructions?: string | null
          levy_cents: number
          updated_at?: string
        }
        Update: {
          competition_id?: string
          division?: string
          instructions?: string | null
          levy_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_levies_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_referee_fees: {
        Row: {
          competition_id: string
          fee_cents: number
          role: Database["public"]["Enums"]["referee_role"]
          updated_at: string
        }
        Insert: {
          competition_id: string
          fee_cents: number
          role: Database["public"]["Enums"]["referee_role"]
          updated_at?: string
        }
        Update: {
          competition_id?: string
          fee_cents?: number
          role?: Database["public"]["Enums"]["referee_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_referee_fees_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          club_allocate_hours: number
          created_at: string
          created_by: string | null
          ends_on: string | null
          entries_open: boolean
          flowing_until: string | null
          flowing_window_days: number
          id: string
          late_decline_hours: number
          mode: Database["public"]["Enums"]["competition_mode"]
          name: string
          notes: string | null
          organiser: string | null
          organiser_id: string
          public_slug: string | null
          published_at: string | null
          season: string | null
          self_appoint: boolean
          self_appoint_grades: string[] | null
          starts_on: string | null
          status: Database["public"]["Enums"]["team_status"]
          type: Database["public"]["Enums"]["competition_type"]
          updated_at: string
          visibility: string
        }
        Insert: {
          club_allocate_hours?: number
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          entries_open?: boolean
          flowing_until?: string | null
          flowing_window_days?: number
          id?: string
          late_decline_hours?: number
          mode?: Database["public"]["Enums"]["competition_mode"]
          name: string
          notes?: string | null
          organiser?: string | null
          organiser_id: string
          public_slug?: string | null
          published_at?: string | null
          season?: string | null
          self_appoint?: boolean
          self_appoint_grades?: string[] | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["team_status"]
          type?: Database["public"]["Enums"]["competition_type"]
          updated_at?: string
          visibility?: string
        }
        Update: {
          club_allocate_hours?: number
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          entries_open?: boolean
          flowing_until?: string | null
          flowing_window_days?: number
          id?: string
          late_decline_hours?: number
          mode?: Database["public"]["Enums"]["competition_mode"]
          name?: string
          notes?: string | null
          organiser?: string | null
          organiser_id?: string
          public_slug?: string | null
          published_at?: string | null
          season?: string | null
          self_appoint?: boolean
          self_appoint_grades?: string[] | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["team_status"]
          type?: Database["public"]["Enums"]["competition_type"]
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitions_academy_id_fkey"
            columns: ["organiser_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conduct_reports: {
        Row: {
          academy_id: string
          category: Database["public"]["Enums"]["conduct_category"]
          created_at: string
          description: string
          id: string
          involves_child: boolean
          occurred_on: string | null
          outcome: string | null
          referred_to: string | null
          reported_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["conduct_status"]
          subject_name: string | null
          subject_profile_id: string | null
        }
        Insert: {
          academy_id: string
          category: Database["public"]["Enums"]["conduct_category"]
          created_at?: string
          description: string
          id?: string
          involves_child?: boolean
          occurred_on?: string | null
          outcome?: string | null
          referred_to?: string | null
          reported_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["conduct_status"]
          subject_name?: string | null
          subject_profile_id?: string | null
        }
        Update: {
          academy_id?: string
          category?: Database["public"]["Enums"]["conduct_category"]
          created_at?: string
          description?: string
          id?: string
          involves_child?: boolean
          occurred_on?: string | null
          outcome?: string | null
          referred_to?: string | null
          reported_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["conduct_status"]
          subject_name?: string | null
          subject_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conduct_reports_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conduct_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conduct_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conduct_reports_subject_profile_id_fkey"
            columns: ["subject_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_acceptances: {
        Row: {
          academy_id: string
          accepted: boolean
          accepted_at: string
          document_id: string
          id: string
          player_id: string | null
          profile_id: string
        }
        Insert: {
          academy_id: string
          accepted: boolean
          accepted_at?: string
          document_id: string
          id?: string
          player_id?: string | null
          profile_id: string
        }
        Update: {
          academy_id?: string
          accepted?: boolean
          accepted_at?: string
          document_id?: string
          id?: string
          player_id?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_acceptances_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_acceptances_document_fkey"
            columns: ["document_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "consent_documents"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "consent_acceptances_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "consent_acceptances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_documents: {
        Row: {
          academy_id: string
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["consent_kind"]
          published_at: string | null
          required: boolean
          retired_at: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          academy_id: string
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["consent_kind"]
          published_at?: string | null
          required?: boolean
          retired_at?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          academy_id?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["consent_kind"]
          published_at?: string | null
          required?: boolean
          retired_at?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "consent_documents_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_message_archive: {
        Row: {
          academy_id: string
          attachments: Json
          body: string | null
          channel_id: string
          created_at: string
          deleted_at: string
          deleted_by: string | null
          id: string
          message_id: string
          purge_after: string
          sender_id: string | null
        }
        Insert: {
          academy_id: string
          attachments?: Json
          body?: string | null
          channel_id: string
          created_at: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          message_id: string
          purge_after?: string
          sender_id?: string | null
        }
        Update: {
          academy_id?: string
          attachments?: Json
          body?: string | null
          channel_id?: string
          created_at?: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          message_id?: string
          purge_after?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deleted_message_archive_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_confirmations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          profile_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          profile_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          profile_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_confirmations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_fees: {
        Row: {
          academy_id: string
          amount_cents: number
          club_academy_id: string | null
          competition_id: string
          created_at: string
          entry_id: string
          id: string
          method: string | null
          note: string | null
          paid_at: string | null
          status: Database["public"]["Enums"]["entry_fee_status"]
          stripe_payment_intent: string | null
          stripe_session_id: string | null
        }
        Insert: {
          academy_id: string
          amount_cents: number
          club_academy_id?: string | null
          competition_id: string
          created_at?: string
          entry_id: string
          id?: string
          method?: string | null
          note?: string | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["entry_fee_status"]
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          academy_id?: string
          amount_cents?: number
          club_academy_id?: string | null
          competition_id?: string
          created_at?: string
          entry_id?: string
          id?: string
          method?: string | null
          note?: string | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["entry_fee_status"]
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entry_fees_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_fees_club_academy_id_fkey"
            columns: ["club_academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_fees_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_fees_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_squads: {
        Row: {
          academy_id: string
          added_by: string | null
          age_exempt: boolean
          age_exempt_by: string | null
          competition_id: string
          created_at: string
          entry_id: string
          id: string
          number: number | null
          player_id: string
        }
        Insert: {
          academy_id: string
          added_by?: string | null
          age_exempt?: boolean
          age_exempt_by?: string | null
          competition_id: string
          created_at?: string
          entry_id: string
          id?: string
          number?: number | null
          player_id: string
        }
        Update: {
          academy_id?: string
          added_by?: string | null
          age_exempt?: boolean
          age_exempt_by?: string | null
          competition_id?: string
          created_at?: string
          entry_id?: string
          id?: string
          number?: number | null
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_squads_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_squads_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_squads_age_exempt_by_fkey"
            columns: ["age_exempt_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_squads_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_squads_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_squads_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_attendance: {
        Row: {
          academy_id: string
          event_id: string
          id: string
          marked_at: string
          marked_by: string | null
          note: string | null
          player_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
        }
        Insert: {
          academy_id: string
          event_id: string
          id?: string
          marked_at?: string
          marked_by?: string | null
          note?: string | null
          player_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Update: {
          academy_id?: string
          event_id?: string
          id?: string
          marked_at?: string
          marked_by?: string | null
          note?: string | null
          player_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendance_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendance_event_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_attendance_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendance_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_checklist_ticks: {
        Row: {
          academy_id: string
          event_id: string
          item: string
          ticked_at: string
          ticked_by: string | null
        }
        Insert: {
          academy_id: string
          event_id: string
          item: string
          ticked_at?: string
          ticked_by?: string | null
        }
        Update: {
          academy_id?: string
          event_id?: string
          item?: string
          ticked_at?: string
          ticked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_checklist_ticks_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_checklist_ticks_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_checklist_ticks_ticked_by_fkey"
            columns: ["ticked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_duties: {
        Row: {
          academy_id: string
          created_at: string
          event_id: string
          id: string
          player_id: string
          requested_swap_at: string | null
          swap_note: string | null
          team_id: string
          title: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          event_id: string
          id?: string
          player_id: string
          requested_swap_at?: string | null
          swap_note?: string | null
          team_id: string
          title: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          event_id?: string
          id?: string
          player_id?: string
          requested_swap_at?: string | null
          swap_note?: string | null
          team_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_duties_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_duties_event_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_duties_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_duties_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_job_helpers: {
        Row: {
          academy_id: string
          added_by: string | null
          created_at: string
          job_id: string
          profile_id: string
        }
        Insert: {
          academy_id: string
          added_by?: string | null
          created_at?: string
          job_id: string
          profile_id: string
        }
        Update: {
          academy_id?: string
          added_by?: string | null
          created_at?: string
          job_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_job_helpers_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_job_helpers_job_id_academy_id_fkey"
            columns: ["job_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "event_jobs"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_job_helpers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_jobs: {
        Row: {
          academy_id: string
          created_at: string
          created_by: string | null
          end_time: string | null
          event_id: string
          id: string
          note: string | null
          position: number
          spots: number
          start_time: string | null
          title: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          event_id: string
          id?: string
          note?: string | null
          position?: number
          spots?: number
          start_time?: string | null
          title: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          event_id?: string
          id?: string
          note?: string | null
          position?: number
          spots?: number
          start_time?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_jobs_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_jobs_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_lineup_players: {
        Row: {
          academy_id: string
          id: string
          lineup_id: string
          player_id: string
          position: string | null
          role: Database["public"]["Enums"]["lineup_role"]
          sort_order: number
        }
        Insert: {
          academy_id: string
          id?: string
          lineup_id: string
          player_id: string
          position?: string | null
          role?: Database["public"]["Enums"]["lineup_role"]
          sort_order?: number
        }
        Update: {
          academy_id?: string
          id?: string
          lineup_id?: string
          player_id?: string
          position?: string | null
          role?: Database["public"]["Enums"]["lineup_role"]
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_lineup_players_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_lineup_players_lineup_fk"
            columns: ["lineup_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "event_lineups"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_lineup_players_player_fk"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_lineups: {
        Row: {
          academy_id: string
          created_at: string
          created_by: string | null
          event_id: string
          formation: string | null
          id: string
          note: string | null
          published_at: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          created_by?: string | null
          event_id: string
          formation?: string | null
          id?: string
          note?: string | null
          published_at?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          formation?: string | null
          id?: string
          note?: string | null
          published_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_lineups_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_lineups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_lineups_event_fk"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_photos: {
        Row: {
          academy_id: string
          added_by: string | null
          created_at: string
          event_id: string
          height: number | null
          hidden_at: string | null
          hidden_by: string | null
          id: string
          storage_path: string
          thumb_path: string | null
          width: number | null
        }
        Insert: {
          academy_id: string
          added_by?: string | null
          created_at?: string
          event_id: string
          height?: number | null
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          storage_path: string
          thumb_path?: string | null
          width?: number | null
        }
        Update: {
          academy_id?: string
          added_by?: string | null
          created_at?: string
          event_id?: string
          height?: number | null
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          storage_path?: string
          thumb_path?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_photos_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_photos_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_photos_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_photos_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_player_stats: {
        Row: {
          academy_id: string
          assists: number
          entered_by: string | null
          event_id: string
          goals: number
          minutes: number | null
          note: string | null
          player_id: string
          potm: boolean
          updated_at: string
        }
        Insert: {
          academy_id: string
          assists?: number
          entered_by?: string | null
          event_id: string
          goals?: number
          minutes?: number | null
          note?: string | null
          player_id: string
          potm?: boolean
          updated_at?: string
        }
        Update: {
          academy_id?: string
          assists?: number
          entered_by?: string | null
          event_id?: string
          goals?: number
          minutes?: number | null
          note?: string | null
          player_id?: string
          potm?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_player_stats_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_player_stats_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_player_stats_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_player_stats_player_id_academy_id_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_pulse: {
        Row: {
          academy_id: string
          created_at: string
          event_id: string
          mood: number
          note: string | null
          profile_id: string
          updated_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          event_id: string
          mood: number
          note?: string | null
          profile_id: string
          updated_at?: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          event_id?: string
          mood?: number
          note?: string | null
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_pulse_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_pulse_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_pulse_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          academy_id: string
          created_at: string
          event_id: string
          id: string
          note: string | null
          player_id: string | null
          profile_id: string
          status: Database["public"]["Enums"]["rsvp_status"]
          updated_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          event_id: string
          id?: string
          note?: string | null
          player_id?: string | null
          profile_id: string
          status: Database["public"]["Enums"]["rsvp_status"]
          updated_at?: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          event_id?: string
          id?: string
          note?: string | null
          player_id?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["rsvp_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_event_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_rsvps_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_rsvps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_scans: {
        Row: {
          academy_id: string
          created_at: string
          error: string | null
          found: number
          id: string
          model: string | null
          processed_at: string | null
          profile_id: string
          purge_after: string
          raw: Json | null
          share: boolean
          status: string
          storage_path: string | null
          team_id: string | null
        }
        Insert: {
          academy_id: string
          created_at?: string
          error?: string | null
          found?: number
          id?: string
          model?: string | null
          processed_at?: string | null
          profile_id: string
          purge_after?: string
          raw?: Json | null
          share?: boolean
          status?: string
          storage_path?: string | null
          team_id?: string | null
        }
        Update: {
          academy_id?: string
          created_at?: string
          error?: string | null
          found?: number
          id?: string
          model?: string | null
          processed_at?: string | null
          profile_id?: string
          purge_after?: string
          raw?: Json | null
          share?: boolean
          status?: string
          storage_path?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_scans_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_scans_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_scans_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_series: {
        Row: {
          academy_id: string
          address: string | null
          arrive_mins: number | null
          at_time: string
          created_at: string
          created_by: string | null
          days: number[]
          duration_mins: number
          ends_on: string
          id: string
          kit_colour: string | null
          notes: string | null
          pitch_id: string | null
          program_id: string | null
          starts_on: string
          team_id: string | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
          updated_at: string
          venue: string | null
          venue_id: string | null
        }
        Insert: {
          academy_id: string
          address?: string | null
          arrive_mins?: number | null
          at_time: string
          created_at?: string
          created_by?: string | null
          days: number[]
          duration_mins?: number
          ends_on: string
          id?: string
          kit_colour?: string | null
          notes?: string | null
          pitch_id?: string | null
          program_id?: string | null
          starts_on: string
          team_id?: string | null
          title: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
          venue?: string | null
          venue_id?: string | null
        }
        Update: {
          academy_id?: string
          address?: string | null
          arrive_mins?: number | null
          at_time?: string
          created_at?: string
          created_by?: string | null
          days?: number[]
          duration_mins?: number
          ends_on?: string
          id?: string
          kit_colour?: string | null
          notes?: string | null
          pitch_id?: string | null
          program_id?: string | null
          starts_on?: string
          team_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
          venue?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_series_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_series_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticker: {
        Row: {
          academy_id: string
          assist_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          kind: string
          message_id: string | null
          minute: number | null
          note: string | null
          player_id: string | null
          undone_at: string | null
        }
        Insert: {
          academy_id: string
          assist_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          kind: string
          message_id?: string | null
          minute?: number | null
          note?: string | null
          player_id?: string | null
          undone_at?: string | null
        }
        Update: {
          academy_id?: string
          assist_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          kind?: string
          message_id?: string | null
          minute?: number | null
          note?: string | null
          player_id?: string | null
          undone_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_ticker_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ticker_assist_id_academy_id_fkey"
            columns: ["assist_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_ticker_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ticker_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "event_ticker_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ticker_player_id_academy_id_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      event_videos: {
        Row: {
          academy_id: string
          added_by: string | null
          created_at: string
          event_id: string
          id: string
          kind: string
          storage_path: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          academy_id: string
          added_by?: string | null
          created_at?: string
          event_id: string
          id?: string
          kind: string
          storage_path?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          academy_id?: string
          added_by?: string | null
          created_at?: string
          event_id?: string
          id?: string
          kind?: string
          storage_path?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_videos_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_videos_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_videos_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      events: {
        Row: {
          academy_id: string
          address: string | null
          arrive_at: string | null
          cancellation_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          competition_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          external_ref: string | null
          fixture_id: string | null
          ground_day: boolean
          id: string
          kit_colour: string | null
          notes: string | null
          opponent: string | null
          our_score: number | null
          pitch_id: string | null
          potm_vote_open: boolean
          private_to: string | null
          program_id: string | null
          result_note: string | null
          round: string | null
          score_entered_at: string | null
          score_entered_by: string | null
          series_id: string | null
          source: string
          source_scan_id: string | null
          starts_at: string
          team_id: string | null
          their_score: number | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
          updated_at: string
          venue: string | null
          venue_id: string | null
          was_home: boolean | null
        }
        Insert: {
          academy_id: string
          address?: string | null
          arrive_at?: string | null
          cancellation_note?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          competition_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          external_ref?: string | null
          fixture_id?: string | null
          ground_day?: boolean
          id?: string
          kit_colour?: string | null
          notes?: string | null
          opponent?: string | null
          our_score?: number | null
          pitch_id?: string | null
          potm_vote_open?: boolean
          private_to?: string | null
          program_id?: string | null
          result_note?: string | null
          round?: string | null
          score_entered_at?: string | null
          score_entered_by?: string | null
          series_id?: string | null
          source?: string
          source_scan_id?: string | null
          starts_at: string
          team_id?: string | null
          their_score?: number | null
          title: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
          venue?: string | null
          venue_id?: string | null
          was_home?: boolean | null
        }
        Update: {
          academy_id?: string
          address?: string | null
          arrive_at?: string | null
          cancellation_note?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          competition_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          external_ref?: string | null
          fixture_id?: string | null
          ground_day?: boolean
          id?: string
          kit_colour?: string | null
          notes?: string | null
          opponent?: string | null
          our_score?: number | null
          pitch_id?: string | null
          potm_vote_open?: boolean
          private_to?: string | null
          program_id?: string | null
          result_note?: string | null
          round?: string | null
          score_entered_at?: string | null
          score_entered_by?: string | null
          series_id?: string | null
          source?: string
          source_scan_id?: string | null
          starts_at?: string
          team_id?: string | null
          their_score?: number | null
          title?: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
          venue?: string | null
          venue_id?: string | null
          was_home?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "events_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_competition_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_private_to_fkey"
            columns: ["private_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_scan_fkey"
            columns: ["source_scan_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "event_scans"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "events_score_entered_by_fkey"
            columns: ["score_entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_series_fkey"
            columns: ["series_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "events_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_change_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          request_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          request_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_change_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_change_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "fixture_change_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_change_requests: {
        Row: {
          answer_note: string | null
          answered_at: string | null
          answered_by: string | null
          by_entry_id: string
          competition_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          fixture_id: string
          id: string
          other_entry_id: string | null
          proposed_by: string | null
          proposed_field: string | null
          proposed_starts_at: string | null
          proposed_venue: string | null
          reason: string
          status: Database["public"]["Enums"]["change_request_status"]
        }
        Insert: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          by_entry_id: string
          competition_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fixture_id: string
          id?: string
          other_entry_id?: string | null
          proposed_by?: string | null
          proposed_field?: string | null
          proposed_starts_at?: string | null
          proposed_venue?: string | null
          reason: string
          status?: Database["public"]["Enums"]["change_request_status"]
        }
        Update: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          by_entry_id?: string
          competition_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fixture_id?: string
          id?: string
          other_entry_id?: string | null
          proposed_by?: string | null
          proposed_field?: string | null
          proposed_starts_at?: string | null
          proposed_venue?: string | null
          reason?: string
          status?: Database["public"]["Enums"]["change_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "fixture_change_requests_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_change_requests_by_entry_id_fkey"
            columns: ["by_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_change_requests_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_change_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_change_requests_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_change_requests_other_entry_id_fkey"
            columns: ["other_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_change_requests_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_entry_id: string | null
          away_score: number | null
          away_source: string | null
          cancel_reason: string | null
          checkin_key: string
          competition_id: string
          created_at: string
          division: string
          duration_mins: number | null
          ended_at: string | null
          ended_by: string | null
          external_ref: string | null
          field_label: string | null
          group_label: string | null
          home_entry_id: string | null
          home_score: number | null
          home_source: string | null
          id: string
          notes: string | null
          pinned: boolean
          pitch_id: string | null
          referee_verified_at: string | null
          referee_verified_by: string | null
          round: string | null
          score_disputed: boolean
          score_entered_at: string | null
          score_entered_by: string | null
          stage: string
          starts_at: string | null
          status: Database["public"]["Enums"]["fixture_status"]
          updated_at: string
          venue_id: string | null
          venue_label: string | null
        }
        Insert: {
          away_entry_id?: string | null
          away_score?: number | null
          away_source?: string | null
          cancel_reason?: string | null
          checkin_key?: string
          competition_id: string
          created_at?: string
          division: string
          duration_mins?: number | null
          ended_at?: string | null
          ended_by?: string | null
          external_ref?: string | null
          field_label?: string | null
          group_label?: string | null
          home_entry_id?: string | null
          home_score?: number | null
          home_source?: string | null
          id?: string
          notes?: string | null
          pinned?: boolean
          pitch_id?: string | null
          referee_verified_at?: string | null
          referee_verified_by?: string | null
          round?: string | null
          score_disputed?: boolean
          score_entered_at?: string | null
          score_entered_by?: string | null
          stage?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["fixture_status"]
          updated_at?: string
          venue_id?: string | null
          venue_label?: string | null
        }
        Update: {
          away_entry_id?: string | null
          away_score?: number | null
          away_source?: string | null
          cancel_reason?: string | null
          checkin_key?: string
          competition_id?: string
          created_at?: string
          division?: string
          duration_mins?: number | null
          ended_at?: string | null
          ended_by?: string | null
          external_ref?: string | null
          field_label?: string | null
          group_label?: string | null
          home_entry_id?: string | null
          home_score?: number | null
          home_source?: string | null
          id?: string
          notes?: string | null
          pinned?: boolean
          pitch_id?: string | null
          referee_verified_at?: string | null
          referee_verified_by?: string | null
          round?: string | null
          score_disputed?: boolean
          score_entered_at?: string | null
          score_entered_by?: string | null
          stage?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["fixture_status"]
          updated_at?: string
          venue_id?: string | null
          venue_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixtures_away_entry_id_fkey"
            columns: ["away_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_home_entry_id_fkey"
            columns: ["home_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_referee_verified_by_fkey"
            columns: ["referee_verified_by"]
            isOneToOne: false
            referencedRelation: "referees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_score_entered_by_fkey"
            columns: ["score_entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      forfeit_requests: {
        Row: {
          club_decided_at: string | null
          club_decided_by: string | null
          club_note: string | null
          competition_id: string
          created_at: string
          entry_id: string
          fixture_id: string
          id: string
          league_decided_at: string | null
          league_decided_by: string | null
          league_note: string | null
          reason: string
          requested_by: string
          status: string
        }
        Insert: {
          club_decided_at?: string | null
          club_decided_by?: string | null
          club_note?: string | null
          competition_id: string
          created_at?: string
          entry_id: string
          fixture_id: string
          id?: string
          league_decided_at?: string | null
          league_decided_by?: string | null
          league_note?: string | null
          reason: string
          requested_by: string
          status?: string
        }
        Update: {
          club_decided_at?: string | null
          club_decided_by?: string | null
          club_note?: string | null
          competition_id?: string
          created_at?: string
          entry_id?: string
          fixture_id?: string
          id?: string
          league_decided_at?: string | null
          league_decided_by?: string | null
          league_note?: string | null
          reason?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "forfeit_requests_club_decided_by_fkey"
            columns: ["club_decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forfeit_requests_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forfeit_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forfeit_requests_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forfeit_requests_league_decided_by_fkey"
            columns: ["league_decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forfeit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          academy_id: string
          created_at: string
          created_by: string
          created_players: number
          file_name: string | null
          id: string
          kind: string
          matched_players: number
          removed_players: number | null
          rows_sent: number
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          academy_id: string
          created_at?: string
          created_by: string
          created_players?: number
          file_name?: string | null
          id?: string
          kind?: string
          matched_players?: number
          removed_players?: number | null
          rows_sent?: number
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          academy_id?: string
          created_at?: string
          created_by?: string
          created_players?: number
          file_name?: string | null
          id?: string
          kind?: string
          matched_players?: number
          removed_players?: number | null
          rows_sent?: number
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_games: {
        Row: {
          academy_id: string
          away: string
          away_score: number | null
          division: string | null
          external_ref: string | null
          home: string
          home_score: number | null
          id: string
          imported_at: string
          imported_by: string | null
          local_date: string
          round: string | null
          season: string
        }
        Insert: {
          academy_id: string
          away: string
          away_score?: number | null
          division?: string | null
          external_ref?: string | null
          home: string
          home_score?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          local_date: string
          round?: string | null
          season: string
        }
        Update: {
          academy_id?: string
          away?: string
          away_score?: number | null
          division?: string | null
          external_ref?: string | null
          home?: string
          home_score?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          local_date?: string
          round?: string | null
          season?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_games_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imported_games_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_teams: {
        Row: {
          academy_id: string
          invite_id: string
          team_id: string
        }
        Insert: {
          academy_id: string
          invite_id: string
          team_id: string
        }
        Update: {
          academy_id?: string
          invite_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_teams_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_teams_invite_fkey"
            columns: ["invite_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "invite_teams_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      invites: {
        Row: {
          academy_id: string
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          full_name: string | null
          id: string
          invited_by: string
          phone: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["academy_role"]
          status: Database["public"]["Enums"]["invite_status"]
          token: string
        }
        Insert: {
          academy_id: string
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by: string
          phone: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["academy_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Update: {
          academy_id?: string
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by?: string
          phone?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["academy_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      join_attempts: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
          link_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          ip_hash: string
          link_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          ip_hash?: string
          link_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "join_attempts_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "join_links"
            referencedColumns: ["id"]
          },
        ]
      }
      join_link_redemptions: {
        Row: {
          academy_id: string
          created_at: string
          id: string
          link_id: string
          profile_id: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          id?: string
          link_id: string
          profile_id: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          id?: string
          link_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "join_link_redemptions_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_link_redemptions_link_fkey"
            columns: ["link_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "join_links"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "join_link_redemptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      join_links: {
        Row: {
          academy_id: string
          code: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          label: string | null
          max_uses: number | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["academy_role"]
          team_id: string | null
          token: string
          use_count: number
        }
        Insert: {
          academy_id: string
          code?: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["academy_role"]
          team_id?: string | null
          token?: string
          use_count?: number
        }
        Update: {
          academy_id?: string
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["academy_role"]
          team_id?: string | null
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "join_links_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_links_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      join_requests: {
        Row: {
          academy_id: string
          children: Json
          children_names: string[]
          claimed_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          dob: string | null
          email: string | null
          expires_at: string
          full_name: string
          id: string
          join_link_id: string | null
          message: string | null
          news_opt_in_at: string | null
          phone: string | null
          profile_id: string | null
          secret_hash: string
          status: Database["public"]["Enums"]["join_request_status"]
          team_id: string | null
        }
        Insert: {
          academy_id: string
          children?: Json
          children_names?: string[]
          claimed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          dob?: string | null
          email?: string | null
          expires_at?: string
          full_name: string
          id?: string
          join_link_id?: string | null
          message?: string | null
          news_opt_in_at?: string | null
          phone?: string | null
          profile_id?: string | null
          secret_hash: string
          status?: Database["public"]["Enums"]["join_request_status"]
          team_id?: string | null
        }
        Update: {
          academy_id?: string
          children?: Json
          children_names?: string[]
          claimed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          dob?: string | null
          email?: string | null
          expires_at?: string
          full_name?: string
          id?: string
          join_link_id?: string | null
          message?: string | null
          news_opt_in_at?: string | null
          phone?: string | null
          profile_id?: string | null
          secret_hash?: string
          status?: Database["public"]["Enums"]["join_request_status"]
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "join_requests_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_link_fkey"
            columns: ["join_link_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "join_links"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "join_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      ladder_adjustments: {
        Row: {
          competition_id: string
          division: string
          entry_id: string
          id: string
          made_at: string
          made_by: string | null
          points: number
          reason: string
        }
        Insert: {
          competition_id: string
          division: string
          entry_id: string
          id?: string
          made_at?: string
          made_by?: string | null
          points: number
          reason: string
        }
        Update: {
          competition_id?: string
          division?: string
          entry_id?: string
          id?: string
          made_at?: string
          made_by?: string | null
          points?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "ladder_adjustments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_adjustments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_adjustments_made_by_fkey"
            columns: ["made_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_roles: {
        Row: {
          academy_id: string
          created_at: string
          granted_by: string | null
          id: string
          profile_id: string
          role: Database["public"]["Enums"]["league_role"]
        }
        Insert: {
          academy_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          profile_id: string
          role: Database["public"]["Enums"]["league_role"]
        }
        Update: {
          academy_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["league_role"]
        }
        Relationships: [
          {
            foreignKeyName: "league_roles_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      levy_payments: {
        Row: {
          amount_cents: number
          club_academy_id: string
          competition_id: string
          created_at: string
          id: string
          method: string
          note: string | null
          paid_on: string
          recorded_by: string | null
        }
        Insert: {
          amount_cents: number
          club_academy_id: string
          competition_id: string
          created_at?: string
          id?: string
          method: string
          note?: string | null
          paid_on?: string
          recorded_by?: string | null
        }
        Update: {
          amount_cents?: number
          club_academy_id?: string
          competition_id?: string
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          paid_on?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "levy_payments_club_academy_id_fkey"
            columns: ["club_academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "levy_payments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "levy_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      link_previews: {
        Row: {
          description: string | null
          fetched_at: string
          image_url: string | null
          ok: boolean
          site_name: string | null
          title: string | null
          url: string
        }
        Insert: {
          description?: string | null
          fetched_at?: string
          image_url?: string | null
          ok?: boolean
          site_name?: string | null
          title?: string | null
          url: string
        }
        Update: {
          description?: string | null
          fetched_at?: string
          image_url?: string | null
          ok?: boolean
          site_name?: string | null
          title?: string | null
          url?: string
        }
        Relationships: []
      }
      match_corrections: {
        Row: {
          competition_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          detail: string
          entry_id: string | null
          fixture_id: string
          id: string
          kind: string
          proposed_away: number | null
          proposed_home: number | null
          requested_by: string
          status: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          detail: string
          entry_id?: string | null
          fixture_id: string
          id?: string
          kind: string
          proposed_away?: number | null
          proposed_home?: number | null
          requested_by: string
          status?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          detail?: string
          entry_id?: string | null
          fixture_id?: string
          id?: string
          kind?: string
          proposed_away?: number | null
          proposed_home?: number | null
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_corrections_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_corrections_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_corrections_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_corrections_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_corrections_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_events: {
        Row: {
          competition_id: string
          created_at: string
          created_by: string | null
          entry_id: string
          fixture_id: string
          id: string
          kind: Database["public"]["Enums"]["match_event_kind"]
          minute: number | null
          note: string | null
          player_id: string | null
          sanction_code: string | null
        }
        Insert: {
          competition_id: string
          created_at?: string
          created_by?: string | null
          entry_id: string
          fixture_id: string
          id?: string
          kind: Database["public"]["Enums"]["match_event_kind"]
          minute?: number | null
          note?: string | null
          player_id?: string | null
          sanction_code?: string | null
        }
        Update: {
          competition_id?: string
          created_at?: string
          created_by?: string | null
          entry_id?: string
          fixture_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["match_event_kind"]
          minute?: number | null
          note?: string | null
          player_id?: string | null
          sanction_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_events_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      match_sheet_log: {
        Row: {
          action: string
          actor: string | null
          at: string
          competition_id: string
          detail: Json
          entry_id: string | null
          fixture_id: string
          id: number
        }
        Insert: {
          action: string
          actor?: string | null
          at?: string
          competition_id: string
          detail?: Json
          entry_id?: string | null
          fixture_id: string
          id?: number
        }
        Update: {
          action?: string
          actor?: string | null
          at?: string
          competition_id?: string
          detail?: Json
          entry_id?: string | null
          fixture_id?: string
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_sheet_log_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_sheet_log_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_sheet_log_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      match_sheet_players: {
        Row: {
          number: number | null
          player_id: string
          sheet_id: string
          starting: boolean
        }
        Insert: {
          number?: number | null
          player_id: string
          sheet_id: string
          starting?: boolean
        }
        Update: {
          number?: number | null
          player_id?: string
          sheet_id?: string
          starting?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "match_sheet_players_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "match_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      match_sheets: {
        Row: {
          captain_player_id: string | null
          competition_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          entry_id: string
          fixture_id: string
          id: string
          keeper_player_id: string | null
          our_score: number | null
          status: Database["public"]["Enums"]["sheet_status"]
          submitted_at: string
          submitted_by: string | null
          their_score: number | null
        }
        Insert: {
          captain_player_id?: string | null
          competition_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          entry_id: string
          fixture_id: string
          id?: string
          keeper_player_id?: string | null
          our_score?: number | null
          status?: Database["public"]["Enums"]["sheet_status"]
          submitted_at?: string
          submitted_by?: string | null
          their_score?: number | null
        }
        Update: {
          captain_player_id?: string | null
          competition_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          entry_id?: string
          fixture_id?: string
          id?: string
          keeper_player_id?: string | null
          our_score?: number | null
          status?: Database["public"]["Enums"]["sheet_status"]
          submitted_at?: string
          submitted_by?: string | null
          their_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_sheets_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_sheets_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_sheets_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_sheets_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_sheets_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          academy_id: string
          created_at: string
          emoji: string
          id: string
          message_id: string
          profile_id: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          profile_id: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_fkey"
            columns: ["message_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "message_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reports: {
        Row: {
          academy_id: string
          channel_id: string
          created_at: string
          id: string
          message_id: string
          note: string | null
          outcome: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reported_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          academy_id: string
          channel_id: string
          created_at?: string
          id?: string
          message_id: string
          note?: string | null
          outcome?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reported_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          academy_id?: string
          channel_id?: string
          created_at?: string
          id?: string
          message_id?: string
          note?: string | null
          outcome?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reported_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "message_reports_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reports_channel_fkey"
            columns: ["channel_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "message_reports_message_fkey"
            columns: ["message_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "message_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_translations: {
        Row: {
          body: string
          channel_id: string
          created_at: string
          lang: string
          message_id: string
          model: string | null
        }
        Insert: {
          body: string
          channel_id: string
          created_at?: string
          lang: string
          message_id: string
          model?: string | null
        }
        Update: {
          body?: string
          channel_id?: string
          created_at?: string
          lang?: string
          message_id?: string
          model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_translations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          academy_id: string
          approved_at: string | null
          approved_by: string | null
          attachments: Json
          audience: string
          body: string | null
          channel_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event_id: string | null
          id: string
          is_announcement: boolean
          mention_everyone: boolean
          mentions: string[]
          pinned_at: string | null
          pinned_by: string | null
          poll_id: string | null
          relevant_until: string | null
          reply_to_id: string | null
          scheduled_for: string | null
          sender_id: string | null
          status: Database["public"]["Enums"]["message_status"]
        }
        Insert: {
          academy_id: string
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          audience?: string
          body?: string | null
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          event_id?: string | null
          id?: string
          is_announcement?: boolean
          mention_everyone?: boolean
          mentions?: string[]
          pinned_at?: string | null
          pinned_by?: string | null
          poll_id?: string | null
          relevant_until?: string | null
          reply_to_id?: string | null
          scheduled_for?: string | null
          sender_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
        }
        Update: {
          academy_id?: string
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          audience?: string
          body?: string | null
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          event_id?: string | null
          id?: string
          is_announcement?: boolean
          mention_everyone?: boolean
          mentions?: string[]
          pinned_at?: string | null
          pinned_by?: string | null
          poll_id?: string | null
          relevant_until?: string | null
          reply_to_id?: string | null
          scheduled_for?: string | null
          sender_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_channel_fkey"
            columns: ["channel_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "messages_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_event_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "messages_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_poll_fkey"
            columns: ["poll_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      news_consents: {
        Row: {
          at: string
          email: string | null
          id: number
          opted_in: boolean
          profile_id: string
        }
        Insert: {
          at?: string
          email?: string | null
          id?: never
          opted_in: boolean
          profile_id: string
        }
        Update: {
          at?: string
          email?: string | null
          id?: never
          opted_in?: boolean
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_consents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_emails: {
        Row: {
          message_id: string
          profile_id: string
          provider_id: string | null
          sent_at: string
        }
        Insert: {
          message_id: string
          profile_id: string
          provider_id?: string | null
          sent_at?: string
        }
        Update: {
          message_id?: string
          profile_id?: string
          provider_id?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_emails_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_emails_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_reads: {
        Row: {
          channel_id: string
          last_read_at: string
          profile_id: string
        }
        Insert: {
          channel_id: string
          last_read_at?: string
          profile_id: string
        }
        Update: {
          channel_id?: string
          last_read_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_reads_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          academy_id: string
          attempts: number
          body: string | null
          created_at: string
          dedupe_key: string | null
          escalate_sms: boolean
          id: string
          kind: string
          last_error: string | null
          payload: Json
          profile_id: string
          scheduled_for: string
          sent_at: string | null
          sms_attempts: number
          sms_sent_at: string | null
          title: string
          url: string | null
        }
        Insert: {
          academy_id: string
          attempts?: number
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          escalate_sms?: boolean
          id?: string
          kind: string
          last_error?: string | null
          payload?: Json
          profile_id: string
          scheduled_for?: string
          sent_at?: string | null
          sms_attempts?: number
          sms_sent_at?: string | null
          title: string
          url?: string | null
        }
        Update: {
          academy_id?: string
          attempts?: number
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          escalate_sms?: boolean
          id?: string
          kind?: string
          last_error?: string | null
          payload?: Json
          profile_id?: string
          scheduled_for?: string
          sent_at?: string | null
          sms_attempts?: number
          sms_sent_at?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_queue_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          academy_id: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          expires_at: string
          id: string
          kind: string
          player_id: string
          registration_id: string | null
          squad_program_id: string
          status: Database["public"]["Enums"]["offer_status"]
          trial_registration_id: string | null
        }
        Insert: {
          academy_id: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          expires_at: string
          id?: string
          kind?: string
          player_id: string
          registration_id?: string | null
          squad_program_id: string
          status?: Database["public"]["Enums"]["offer_status"]
          trial_registration_id?: string | null
        }
        Update: {
          academy_id?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          expires_at?: string
          id?: string
          kind?: string
          player_id?: string
          registration_id?: string | null
          squad_program_id?: string
          status?: Database["public"]["Enums"]["offer_status"]
          trial_registration_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offers_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "offers_squad_program_fkey"
            columns: ["squad_program_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "offers_trial_registration_fkey"
            columns: ["trial_registration_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "program_registrations"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      payment_promises: {
        Row: {
          academy_id: string
          by_date: string
          created_at: string
          id: string
          player_id: string | null
          profile_id: string
          request_id: string
          updated_at: string
        }
        Insert: {
          academy_id: string
          by_date: string
          created_at?: string
          id?: string
          player_id?: string | null
          profile_id: string
          request_id: string
          updated_at?: string
        }
        Update: {
          academy_id?: string
          by_date?: string
          created_at?: string
          id?: string
          player_id?: string | null
          profile_id?: string
          request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_promises_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_promises_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "payment_promises_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_promises_request_fkey"
            columns: ["request_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          academy_id: string
          amount_cents: number
          archived_at: string | null
          closes_at: string | null
          competition_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          due_on: string | null
          id: string
          instalment_every_days: number
          instalments: number
          per_player: boolean
          program_id: string | null
          team_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          academy_id: string
          amount_cents: number
          archived_at?: string | null
          closes_at?: string | null
          competition_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          due_on?: string | null
          id?: string
          instalment_every_days?: number
          instalments?: number
          per_player?: boolean
          program_id?: string | null
          team_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          academy_id?: string
          amount_cents?: number
          archived_at?: string | null
          closes_at?: string | null
          competition_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          due_on?: string | null
          id?: string
          instalment_every_days?: number
          instalments?: number
          per_player?: boolean
          program_id?: string | null
          team_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_program_fk"
            columns: ["program_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "payment_requests_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      payments: {
        Row: {
          academy_id: string
          amount_cents: number
          created_at: string
          currency: string
          id: string
          instalment_seq: number
          paid_at: string | null
          player_id: string | null
          profile_id: string
          refunded_at: string | null
          request_id: string
          status: string
          stripe_payment_intent: string | null
          stripe_session_id: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          instalment_seq?: number
          paid_at?: string | null
          player_id?: string | null
          profile_id: string
          refunded_at?: string | null
          request_id: string
          status?: string
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          instalment_seq?: number
          paid_at?: string | null
          player_id?: string | null
          profile_id?: string
          refunded_at?: string | null
          request_id?: string
          status?: string
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "payments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_request_fkey"
            columns: ["request_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      pitch_availability: {
        Row: {
          academy_id: string
          closes: string
          id: string
          opens: string
          pitch_id: string
          weekday: number
        }
        Insert: {
          academy_id: string
          closes: string
          id?: string
          opens: string
          pitch_id: string
          weekday: number
        }
        Update: {
          academy_id?: string
          closes?: string
          id?: string
          opens?: string
          pitch_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "pitch_availability_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_availability_pitch_id_academy_id_fkey"
            columns: ["pitch_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "pitches"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      pitch_size_rules: {
        Row: {
          academy_id: string
          age_group: string
          size: string
        }
        Insert: {
          academy_id: string
          age_group: string
          size: string
        }
        Update: {
          academy_id?: string
          age_group?: string
          size?: string
        }
        Relationships: [
          {
            foreignKeyName: "pitch_size_rules_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      pitches: {
        Row: {
          academy_id: string
          created_at: string
          h: number
          id: string
          name: string
          parent_id: string | null
          size: string
          sort: number
          venue_id: string
          w: number
          x: number
          y: number
        }
        Insert: {
          academy_id: string
          created_at?: string
          h?: number
          id?: string
          name: string
          parent_id?: string | null
          size?: string
          sort?: number
          venue_id: string
          w?: number
          x?: number
          y?: number
        }
        Update: {
          academy_id?: string
          created_at?: string
          h?: number
          id?: string
          name?: string
          parent_id?: string | null
          size?: string
          sort?: number
          venue_id?: string
          w?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "pitches_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitches_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitches_venue_id_academy_id_fkey"
            columns: ["venue_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          note: string | null
          profile_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          profile_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_status: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          resolved_at: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          resolved_at?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          resolved_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_status_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_clips: {
        Row: {
          academy_id: string
          added_by: string | null
          created_at: string
          event_id: string | null
          id: string
          note: string | null
          player_id: string
          shared_with_family: boolean
          title: string
          url: string
        }
        Insert: {
          academy_id: string
          added_by?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          note?: string | null
          player_id: string
          shared_with_family?: boolean
          title: string
          url: string
        }
        Update: {
          academy_id?: string
          added_by?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          note?: string | null
          player_id?: string
          shared_with_family?: boolean
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_clips_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_clips_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_clips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_clips_player_id_academy_id_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      player_concussions: {
        Row: {
          academy_id: string
          clearance_note: string | null
          clearance_path: string | null
          clearance_uploaded_at: string | null
          clearance_uploaded_by: string | null
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          decision_note: string | null
          id: string
          note: string | null
          occurred_on: string
          player_id: string
          recorded_by: string | null
          status: Database["public"]["Enums"]["concussion_status"]
        }
        Insert: {
          academy_id: string
          clearance_note?: string | null
          clearance_path?: string | null
          clearance_uploaded_at?: string | null
          clearance_uploaded_by?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          decision_note?: string | null
          id?: string
          note?: string | null
          occurred_on: string
          player_id: string
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["concussion_status"]
        }
        Update: {
          academy_id?: string
          clearance_note?: string | null
          clearance_path?: string | null
          clearance_uploaded_at?: string | null
          clearance_uploaded_by?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          decision_note?: string | null
          id?: string
          note?: string | null
          occurred_on?: string
          player_id?: string
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["concussion_status"]
        }
        Relationships: [
          {
            foreignKeyName: "player_concussions_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_concussions_clearance_uploaded_by_fkey"
            columns: ["clearance_uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_concussions_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_concussions_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "player_concussions_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_guardians: {
        Row: {
          academy_id: string
          created_at: string
          id: string
          is_primary: boolean
          player_id: string
          profile_id: string
          relationship: string | null
        }
        Insert: {
          academy_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          player_id: string
          profile_id: string
          relationship?: string | null
        }
        Update: {
          academy_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          player_id?: string
          profile_id?: string
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_guardians_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_guardians_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "player_guardians_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_logins: {
        Row: {
          academy_id: string
          claimed_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          email: string
          invited_by: string
          player_id: string
          profile_id: string | null
          status: string
        }
        Insert: {
          academy_id: string
          claimed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email: string
          invited_by: string
          player_id: string
          profile_id?: string | null
          status?: string
        }
        Update: {
          academy_id?: string
          claimed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email?: string
          invited_by?: string
          player_id?: string
          profile_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_logins_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_logins_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_logins_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_logins_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_logins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_medical: {
        Row: {
          academy_id: string
          allergies: string | null
          ambulance_cover: string | null
          coach_note: string | null
          conditions: string | null
          created_at: string
          dietary: string | null
          doctor_name: string | null
          doctor_phone: string | null
          emergency_name: string | null
          emergency_phone: string | null
          emergency_relation: string | null
          first_aid_consent: boolean
          medicare_number: string | null
          medications: string | null
          player_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          academy_id: string
          allergies?: string | null
          ambulance_cover?: string | null
          coach_note?: string | null
          conditions?: string | null
          created_at?: string
          dietary?: string | null
          doctor_name?: string | null
          doctor_phone?: string | null
          emergency_name?: string | null
          emergency_phone?: string | null
          emergency_relation?: string | null
          first_aid_consent?: boolean
          medicare_number?: string | null
          medications?: string | null
          player_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          academy_id?: string
          allergies?: string | null
          ambulance_cover?: string | null
          coach_note?: string | null
          conditions?: string | null
          created_at?: string
          dietary?: string | null
          doctor_name?: string | null
          doctor_phone?: string | null
          emergency_name?: string | null
          emergency_phone?: string | null
          emergency_relation?: string | null
          first_aid_consent?: boolean
          medicare_number?: string | null
          medications?: string | null
          player_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_medical_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_medical_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "player_medical_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_reports: {
        Row: {
          academy_id: string
          author_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          player_id: string
          published_at: string | null
          ratings: Json
          shared_with_family: boolean
          term: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind?: string
          player_id: string
          published_at?: string | null
          ratings?: Json
          shared_with_family?: boolean
          term?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          player_id?: string
          published_at?: string | null
          ratings?: Json
          shared_with_family?: boolean
          term?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_reports_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_reports_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_reports_player_id_academy_id_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      players: {
        Row: {
          academy_id: string
          created_at: string
          dob: string | null
          ff_number: string | null
          fifa_id: string | null
          full_name: string
          gender: Database["public"]["Enums"]["player_gender"] | null
          id: string
          import_batch_id: string | null
          notes: string | null
          official_status: Database["public"]["Enums"]["official_rego_status"]
          official_status_at: string | null
          official_status_by: string | null
          photo_url: string | null
          preferred_name: string | null
          profile_id: string | null
          public_name_hidden: boolean
          school: string | null
          shirt_size: Database["public"]["Enums"]["kit_size"] | null
          shorts_size: Database["public"]["Enums"]["kit_size"] | null
          socks_size: Database["public"]["Enums"]["sock_size"] | null
          team_id: string | null
          team_since: string | null
          team_told_at: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          dob?: string | null
          ff_number?: string | null
          fifa_id?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["player_gender"] | null
          id?: string
          import_batch_id?: string | null
          notes?: string | null
          official_status?: Database["public"]["Enums"]["official_rego_status"]
          official_status_at?: string | null
          official_status_by?: string | null
          photo_url?: string | null
          preferred_name?: string | null
          profile_id?: string | null
          public_name_hidden?: boolean
          school?: string | null
          shirt_size?: Database["public"]["Enums"]["kit_size"] | null
          shorts_size?: Database["public"]["Enums"]["kit_size"] | null
          socks_size?: Database["public"]["Enums"]["sock_size"] | null
          team_id?: string | null
          team_since?: string | null
          team_told_at?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          dob?: string | null
          ff_number?: string | null
          fifa_id?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["player_gender"] | null
          id?: string
          import_batch_id?: string | null
          notes?: string | null
          official_status?: Database["public"]["Enums"]["official_rego_status"]
          official_status_at?: string | null
          official_status_by?: string | null
          photo_url?: string | null
          preferred_name?: string | null
          profile_id?: string | null
          public_name_hidden?: boolean
          school?: string | null
          shirt_size?: Database["public"]["Enums"]["kit_size"] | null
          shorts_size?: Database["public"]["Enums"]["kit_size"] | null
          socks_size?: Database["public"]["Enums"]["sock_size"] | null
          team_id?: string | null
          team_since?: string | null
          team_told_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_official_status_by_fkey"
            columns: ["official_status_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          academy_id: string
          created_at: string
          id: string
          note: string | null
          option_ids: string[]
          player_id: string | null
          poll_id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          id?: string
          note?: string | null
          option_ids: string[]
          player_id?: string | null
          poll_id: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          id?: string
          note?: string | null
          option_ids?: string[]
          player_id?: string | null
          poll_id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "poll_votes_poll_fkey"
            columns: ["poll_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "poll_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          academy_id: string
          anonymous: boolean
          channel_id: string
          closed_at: string | null
          closes_at: string | null
          created_at: string
          created_by: string
          id: string
          linked_event_id: string | null
          message_id: string | null
          multi: boolean
          options: Json
          question: string
          type: Database["public"]["Enums"]["poll_type"]
          updated_at: string
        }
        Insert: {
          academy_id: string
          anonymous?: boolean
          channel_id: string
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          linked_event_id?: string | null
          message_id?: string | null
          multi?: boolean
          options?: Json
          question: string
          type?: Database["public"]["Enums"]["poll_type"]
          updated_at?: string
        }
        Update: {
          academy_id?: string
          anonymous?: boolean
          channel_id?: string
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          linked_event_id?: string | null
          message_id?: string | null
          multi?: boolean
          options?: Json
          question?: string
          type?: Database["public"]["Enums"]["poll_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "polls_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polls_channel_fkey"
            columns: ["channel_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "polls_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polls_event_fkey"
            columns: ["linked_event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "polls_message_fkey"
            columns: ["message_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      potm_votes: {
        Row: {
          academy_id: string
          created_at: string
          event_id: string
          player_id: string
          voter_id: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          event_id: string
          player_id: string
          voter_id: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          event_id?: string
          player_id?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "potm_votes_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "potm_votes_event_id_academy_id_fkey"
            columns: ["event_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "potm_votes_player_id_academy_id_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "potm_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          appearance: string
          avatar_url: string | null
          chat_language: string | null
          colour_mode: string
          created_at: string
          erased_at: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          appearance?: string
          avatar_url?: string | null
          chat_language?: string | null
          colour_mode?: string
          created_at?: string
          erased_at?: string | null
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          appearance?: string
          avatar_url?: string | null
          chat_language?: string | null
          colour_mode?: string
          created_at?: string
          erased_at?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      program_registrations: {
        Row: {
          academy_id: string
          answers: Json
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          note: string | null
          player_id: string
          program_id: string
          status: Database["public"]["Enums"]["registration_status"]
          submitted_by: string
          updated_at: string
          waitlist_position: number | null
        }
        Insert: {
          academy_id: string
          answers?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          note?: string | null
          player_id: string
          program_id: string
          status?: Database["public"]["Enums"]["registration_status"]
          submitted_by: string
          updated_at?: string
          waitlist_position?: number | null
        }
        Update: {
          academy_id?: string
          answers?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          note?: string | null
          player_id?: string
          program_id?: string
          status?: Database["public"]["Enums"]["registration_status"]
          submitted_by?: string
          updated_at?: string
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "program_registrations_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_registrations_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_registrations_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "program_registrations_program_fkey"
            columns: ["program_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "program_registrations_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          academy_id: string
          born_from_year: number | null
          born_to_year: number | null
          capacity: number | null
          closes_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_on: string | null
          gender: Database["public"]["Enums"]["player_gender"] | null
          id: string
          kind: Database["public"]["Enums"]["program_kind"]
          name: string
          opens_at: string | null
          payment_request_id: string | null
          payment_required: boolean
          questions: Json
          refund_bps_after: number
          requires_official_rego: boolean
          season: string | null
          starts_on: string | null
          status: Database["public"]["Enums"]["program_status"]
          team_id: string | null
          updated_at: string
          waitlist_enabled: boolean
          withdraw_until: string | null
        }
        Insert: {
          academy_id: string
          born_from_year?: number | null
          born_to_year?: number | null
          capacity?: number | null
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_on?: string | null
          gender?: Database["public"]["Enums"]["player_gender"] | null
          id?: string
          kind?: Database["public"]["Enums"]["program_kind"]
          name: string
          opens_at?: string | null
          payment_request_id?: string | null
          payment_required?: boolean
          questions?: Json
          refund_bps_after?: number
          requires_official_rego?: boolean
          season?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["program_status"]
          team_id?: string | null
          updated_at?: string
          waitlist_enabled?: boolean
          withdraw_until?: string | null
        }
        Update: {
          academy_id?: string
          born_from_year?: number | null
          born_to_year?: number | null
          capacity?: number | null
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_on?: string | null
          gender?: Database["public"]["Enums"]["player_gender"] | null
          id?: string
          kind?: Database["public"]["Enums"]["program_kind"]
          name?: string
          opens_at?: string | null
          payment_request_id?: string | null
          payment_required?: boolean
          questions?: Json
          refund_bps_after?: number
          requires_official_rego?: boolean
          season?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["program_status"]
          team_id?: string | null
          updated_at?: string
          waitlist_enabled?: boolean
          withdraw_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programs_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_payment_request_fkey"
            columns: ["payment_request_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "programs_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string | null
          created_at: string
          device_label: string | null
          endpoint: string
          failed_at: string | null
          failure_count: number
          id: string
          last_used_at: string | null
          p256dh: string | null
          platform: string
          profile_id: string
        }
        Insert: {
          auth?: string | null
          created_at?: string
          device_label?: string | null
          endpoint: string
          failed_at?: string | null
          failure_count?: number
          id?: string
          last_used_at?: string | null
          p256dh?: string | null
          platform?: string
          profile_id: string
        }
        Update: {
          auth?: string | null
          created_at?: string
          device_label?: string | null
          endpoint?: string
          failed_at?: string | null
          failure_count?: number
          id?: string
          last_used_at?: string | null
          p256dh?: string | null
          platform?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referee_appointments: {
        Row: {
          academy_id: string
          batch_id: string | null
          checked_in_at: string | null
          competition_id: string
          created_at: string
          fee_cents: number | null
          fixture_id: string
          id: string
          offered_at: string
          offered_by: string | null
          referee_id: string
          report: Json | null
          reported_at: string | null
          responded_at: string | null
          response_note: string | null
          role: Database["public"]["Enums"]["referee_role"]
          status: Database["public"]["Enums"]["appointment_status"]
          withdrawn_note: string | null
        }
        Insert: {
          academy_id: string
          batch_id?: string | null
          checked_in_at?: string | null
          competition_id: string
          created_at?: string
          fee_cents?: number | null
          fixture_id: string
          id?: string
          offered_at?: string
          offered_by?: string | null
          referee_id: string
          report?: Json | null
          reported_at?: string | null
          responded_at?: string | null
          response_note?: string | null
          role?: Database["public"]["Enums"]["referee_role"]
          status?: Database["public"]["Enums"]["appointment_status"]
          withdrawn_note?: string | null
        }
        Update: {
          academy_id?: string
          batch_id?: string | null
          checked_in_at?: string | null
          competition_id?: string
          created_at?: string
          fee_cents?: number | null
          fixture_id?: string
          id?: string
          offered_at?: string
          offered_by?: string | null
          referee_id?: string
          report?: Json | null
          reported_at?: string | null
          responded_at?: string | null
          response_note?: string | null
          role?: Database["public"]["Enums"]["referee_role"]
          status?: Database["public"]["Enums"]["appointment_status"]
          withdrawn_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referee_appointments_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_appointments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_appointments_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_appointments_offered_by_fkey"
            columns: ["offered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_appointments_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: false
            referencedRelation: "referees"
            referencedColumns: ["id"]
          },
        ]
      }
      referee_blockouts: {
        Row: {
          academy_id: string
          created_at: string
          ends_at: string
          id: string
          reason: string | null
          referee_id: string
          starts_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          ends_at: string
          id?: string
          reason?: string | null
          referee_id: string
          starts_at: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          reason?: string | null
          referee_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referee_blockouts_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_blockouts_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: false
            referencedRelation: "referees"
            referencedColumns: ["id"]
          },
        ]
      }
      referee_payment_items: {
        Row: {
          academy_id: string
          amount_cents: number
          appointment_id: string
          created_at: string
          id: string
          paid_at: string | null
          referee_id: string
          run_id: string
          status: Database["public"]["Enums"]["payment_item_status"]
        }
        Insert: {
          academy_id: string
          amount_cents: number
          appointment_id: string
          created_at?: string
          id?: string
          paid_at?: string | null
          referee_id: string
          run_id: string
          status?: Database["public"]["Enums"]["payment_item_status"]
        }
        Update: {
          academy_id?: string
          amount_cents?: number
          appointment_id?: string
          created_at?: string
          id?: string
          paid_at?: string | null
          referee_id?: string
          run_id?: string
          status?: Database["public"]["Enums"]["payment_item_status"]
        }
        Relationships: [
          {
            foreignKeyName: "referee_payment_items_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_payment_items_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "referee_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_payment_items_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: false
            referencedRelation: "referees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_payment_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "referee_payment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      referee_payment_runs: {
        Row: {
          academy_id: string
          competition_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          paid_at: string | null
          paid_method: string | null
          period_from: string
          period_to: string
          status: Database["public"]["Enums"]["payment_run_status"]
          total_cents: number
        }
        Insert: {
          academy_id: string
          competition_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          paid_at?: string | null
          paid_method?: string | null
          period_from: string
          period_to: string
          status?: Database["public"]["Enums"]["payment_run_status"]
          total_cents?: number
        }
        Update: {
          academy_id?: string
          competition_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          paid_at?: string | null
          paid_method?: string | null
          period_from?: string
          period_to?: string
          status?: Database["public"]["Enums"]["payment_run_status"]
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "referee_payment_runs_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_payment_runs_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referee_payment_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referees: {
        Row: {
          academy_id: string
          allocated_by_club: string | null
          bank_details: string | null
          claim_token: string
          claimed_at: string | null
          created_at: string
          created_by: string | null
          full_name: string
          grade: string | null
          id: string
          payee_name: string | null
          phone: string | null
          profile_id: string | null
          status: string
          under_18: boolean
        }
        Insert: {
          academy_id: string
          allocated_by_club?: string | null
          bank_details?: string | null
          claim_token?: string
          claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          full_name: string
          grade?: string | null
          id?: string
          payee_name?: string | null
          phone?: string | null
          profile_id?: string | null
          status?: string
          under_18?: boolean
        }
        Update: {
          academy_id?: string
          allocated_by_club?: string | null
          bank_details?: string | null
          claim_token?: string
          claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          full_name?: string
          grade?: string | null
          id?: string
          payee_name?: string | null
          phone?: string | null
          profile_id?: string | null
          status?: string
          under_18?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "referees_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referees_allocated_by_club_fkey"
            columns: ["allocated_by_club"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          academy_id: string
          amount_cents: number
          id: string
          issued_at: string | null
          issued_by: string | null
          note: string | null
          payment_id: string
          player_id: string
          reason: string | null
          registration_id: string
          requested_at: string
          requested_by: string | null
          status: Database["public"]["Enums"]["refund_status"]
          stripe_refund_id: string | null
        }
        Insert: {
          academy_id: string
          amount_cents: number
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          note?: string | null
          payment_id: string
          player_id: string
          reason?: string | null
          registration_id: string
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          stripe_refund_id?: string | null
        }
        Update: {
          academy_id?: string
          amount_cents?: number
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          note?: string | null
          payment_id?: string
          player_id?: string
          reason?: string | null
          registration_id?: string
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_fkey"
            columns: ["payment_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "refunds_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "refunds_registration_fkey"
            columns: ["registration_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "program_registrations"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_attempts: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
          program_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          ip_hash: string
          program_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          ip_hash?: string
          program_id?: string | null
        }
        Relationships: []
      }
      registration_requests: {
        Row: {
          academy_id: string
          answers: Json
          child_dob: string
          child_gender: string | null
          child_name: string
          claimed_at: string | null
          consents: Json
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          expires_at: string
          ffa_number: string | null
          fifa_id: string | null
          for_self: boolean
          guardian_email: string | null
          guardian_name: string
          guardian_phone: string | null
          id: string
          official_confirmed_at: string | null
          official_confirmed_by: string | null
          player_id: string | null
          profile_id: string | null
          program_id: string
          registration_id: string | null
          secret_hash: string
          status: string
        }
        Insert: {
          academy_id: string
          answers?: Json
          child_dob: string
          child_gender?: string | null
          child_name: string
          claimed_at?: string | null
          consents?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          expires_at?: string
          ffa_number?: string | null
          fifa_id?: string | null
          for_self?: boolean
          guardian_email?: string | null
          guardian_name: string
          guardian_phone?: string | null
          id?: string
          official_confirmed_at?: string | null
          official_confirmed_by?: string | null
          player_id?: string | null
          profile_id?: string | null
          program_id: string
          registration_id?: string | null
          secret_hash: string
          status?: string
        }
        Update: {
          academy_id?: string
          answers?: Json
          child_dob?: string
          child_gender?: string | null
          child_name?: string
          claimed_at?: string | null
          consents?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          expires_at?: string
          ffa_number?: string | null
          fifa_id?: string | null
          for_self?: boolean
          guardian_email?: string | null
          guardian_name?: string
          guardian_phone?: string | null
          id?: string
          official_confirmed_at?: string | null
          official_confirmed_by?: string | null
          player_id?: string | null
          profile_id?: string | null
          program_id?: string
          registration_id?: string | null
          secret_hash?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_requests_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_requests_official_confirmed_by_fkey"
            columns: ["official_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_requests_program_fk"
            columns: ["program_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      respect_marks: {
        Row: {
          about_entry_id: string
          by_entry_id: string | null
          coaches: number
          competition_id: string
          created_at: string
          fixture_id: string
          id: string
          marker_id: string
          marker_role: string
          note: string | null
          players: number
          spectators: number
          updated_at: string
        }
        Insert: {
          about_entry_id: string
          by_entry_id?: string | null
          coaches: number
          competition_id: string
          created_at?: string
          fixture_id: string
          id?: string
          marker_id: string
          marker_role: string
          note?: string | null
          players: number
          spectators: number
          updated_at?: string
        }
        Update: {
          about_entry_id?: string
          by_entry_id?: string | null
          coaches?: number
          competition_id?: string
          created_at?: string
          fixture_id?: string
          id?: string
          marker_id?: string
          marker_role?: string
          note?: string | null
          players?: number
          spectators?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "respect_marks_about_entry_id_fkey"
            columns: ["about_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respect_marks_by_entry_id_fkey"
            columns: ["by_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respect_marks_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respect_marks_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respect_marks_marker_id_fkey"
            columns: ["marker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      safeguarding_officers: {
        Row: {
          academy_id: string
          appointed_at: string
          appointed_by: string | null
          profile_id: string
        }
        Insert: {
          academy_id: string
          appointed_at?: string
          appointed_by?: string | null
          profile_id: string
        }
        Update: {
          academy_id?: string
          appointed_at?: string
          appointed_by?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safeguarding_officers_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safeguarding_officers_appointed_by_fkey"
            columns: ["appointed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safeguarding_officers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_impressions: {
        Row: {
          day: string
          sponsor_id: string
          views: number
        }
        Insert: {
          day: string
          sponsor_id: string
          views?: number
        }
        Update: {
          day?: string
          sponsor_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_impressions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "academy_sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_numbers: {
        Row: {
          academy_id: string
          assigned_by: string | null
          created_at: string
          id: string
          number: number
          player_id: string
          season: string
        }
        Insert: {
          academy_id: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          number: number
          player_id: string
          season: string
        }
        Update: {
          academy_id?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          number?: number
          player_id?: string
          season?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_numbers_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_numbers_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_numbers_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      staff_clearances: {
        Row: {
          academy_id: string
          created_at: string
          expires_on: string
          id: string
          kind: Database["public"]["Enums"]["clearance_kind"]
          note: string | null
          number: string
          outcome: Database["public"]["Enums"]["clearance_outcome"]
          profile_id: string
          updated_at: string
          verified_at: string
          verified_by: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          expires_on: string
          id?: string
          kind?: Database["public"]["Enums"]["clearance_kind"]
          note?: string | null
          number: string
          outcome: Database["public"]["Enums"]["clearance_outcome"]
          profile_id: string
          updated_at?: string
          verified_at?: string
          verified_by: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          expires_on?: string
          id?: string
          kind?: Database["public"]["Enums"]["clearance_kind"]
          note?: string | null
          number?: string
          outcome?: Database["public"]["Enums"]["clearance_outcome"]
          profile_id?: string
          updated_at?: string
          verified_at?: string
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_clearances_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_clearances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_clearances_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      streams: {
        Row: {
          academy_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          academy_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          academy_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "streams_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      support_replies: {
        Row: {
          body: string
          created_at: string
          from_staff: boolean
          id: string
          profile_id: string | null
          request_id: string
        }
        Insert: {
          body: string
          created_at?: string
          from_staff?: boolean
          id?: string
          profile_id?: string | null
          request_id: string
        }
        Update: {
          body?: string
          created_at?: string
          from_staff?: boolean
          id?: string
          profile_id?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_replies_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_replies_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          academy_id: string | null
          body: string
          created_at: string
          id: string
          profile_id: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          academy_id?: string | null
          body: string
          created_at?: string
          id?: string
          profile_id: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          academy_id?: string | null
          body?: string
          created_at?: string
          id?: string
          profile_id?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_requests_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suspensions: {
        Row: {
          academy_id: string
          appeal_note: string | null
          appealed_at: string | null
          competition_id: string
          decided_at: string | null
          decided_by: string | null
          entry_id: string | null
          from_event_id: string | null
          from_fixture_id: string | null
          games: number
          id: string
          issued_at: string
          issued_by: string | null
          note: string | null
          player_id: string
          reason: string
          sanction_code: string | null
          served: number
          status: Database["public"]["Enums"]["suspension_status"]
        }
        Insert: {
          academy_id: string
          appeal_note?: string | null
          appealed_at?: string | null
          competition_id: string
          decided_at?: string | null
          decided_by?: string | null
          entry_id?: string | null
          from_event_id?: string | null
          from_fixture_id?: string | null
          games: number
          id?: string
          issued_at?: string
          issued_by?: string | null
          note?: string | null
          player_id: string
          reason: string
          sanction_code?: string | null
          served?: number
          status?: Database["public"]["Enums"]["suspension_status"]
        }
        Update: {
          academy_id?: string
          appeal_note?: string | null
          appealed_at?: string | null
          competition_id?: string
          decided_at?: string | null
          decided_by?: string | null
          entry_id?: string | null
          from_event_id?: string | null
          from_fixture_id?: string | null
          games?: number
          id?: string
          issued_at?: string
          issued_by?: string | null
          note?: string | null
          player_id?: string
          reason?: string
          sanction_code?: string | null
          served?: number
          status?: Database["public"]["Enums"]["suspension_status"]
        }
        Relationships: [
          {
            foreignKeyName: "suspensions_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_from_event_id_fkey"
            columns: ["from_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_from_fixture_id_fkey"
            columns: ["from_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      team_duties: {
        Row: {
          academy_id: string
          created_at: string
          id: string
          position: number
          team_id: string
          title: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          id?: string
          position?: number
          team_id: string
          title: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          id?: string
          position?: number
          team_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_duties_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_duties_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      team_members: {
        Row: {
          academy_id: string
          created_at: string
          id: string
          profile_id: string
          role: Database["public"]["Enums"]["academy_role"]
          team_id: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          id?: string
          profile_id: string
          role?: Database["public"]["Enums"]["academy_role"]
          team_id: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["academy_role"]
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      teams: {
        Row: {
          academy_id: string
          age_group: string
          capacity: number | null
          created_at: string
          created_by: string | null
          ended_at: string | null
          external_ref: string | null
          gender: Database["public"]["Enums"]["team_gender"] | null
          home_venue_id: string | null
          id: string
          kit_away: string | null
          kit_home: string | null
          label: string | null
          name: string
          rolled_from: string | null
          season: string
          skip_import: boolean
          status: Database["public"]["Enums"]["team_status"]
          stream_id: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          age_group: string
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          external_ref?: string | null
          gender?: Database["public"]["Enums"]["team_gender"] | null
          home_venue_id?: string | null
          id?: string
          kit_away?: string | null
          kit_home?: string | null
          label?: string | null
          name: string
          rolled_from?: string | null
          season?: string
          skip_import?: boolean
          status?: Database["public"]["Enums"]["team_status"]
          stream_id?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          age_group?: string
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          external_ref?: string | null
          gender?: Database["public"]["Enums"]["team_gender"] | null
          home_venue_id?: string | null
          id?: string
          kit_away?: string | null
          kit_home?: string | null
          label?: string | null
          name?: string
          rolled_from?: string | null
          season?: string
          skip_import?: boolean
          status?: Database["public"]["Enums"]["team_status"]
          stream_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_home_venue_fkey"
            columns: ["home_venue_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "teams_rolled_from_fkey"
            columns: ["rolled_from"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_stream_fkey"
            columns: ["stream_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      translation_takes: {
        Row: {
          academy_id: string
          created_at: string
          id: string
          n: number
          profile_id: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          id?: string
          n: number
          profile_id: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          id?: string
          n?: number
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "translation_takes_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "translation_takes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_placements: {
        Row: {
          academy_id: string
          decided_at: string
          decided_by: string | null
          id: string
          player_id: string
          program_id: string
          published_at: string | null
          team_id: string | null
        }
        Insert: {
          academy_id: string
          decided_at?: string
          decided_by?: string | null
          id?: string
          player_id: string
          program_id: string
          published_at?: string | null
          team_id?: string | null
        }
        Update: {
          academy_id?: string
          decided_at?: string
          decided_by?: string | null
          id?: string
          player_id?: string
          program_id?: string
          published_at?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trial_placements_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_placements_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_placements_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "trial_placements_program_fkey"
            columns: ["program_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "trial_placements_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      trial_ratings: {
        Row: {
          academy_id: string
          coach_id: string
          created_at: string
          id: string
          note: string | null
          player_id: string
          program_id: string
          rating: number
          updated_at: string
        }
        Insert: {
          academy_id: string
          coach_id: string
          created_at?: string
          id?: string
          note?: string | null
          player_id: string
          program_id: string
          rating: number
          updated_at?: string
        }
        Update: {
          academy_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          note?: string | null
          player_id?: string
          program_id?: string
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_ratings_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_ratings_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_ratings_player_fkey"
            columns: ["player_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id", "academy_id"]
          },
          {
            foreignKeyName: "trial_ratings_program_fkey"
            columns: ["program_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      trusted_devices: {
        Row: {
          created_at: string
          device_hash: string
          id: string
          label: string | null
          last_used_at: string
          profile_id: string
          trusted_until: string
        }
        Insert: {
          created_at?: string
          device_hash: string
          id?: string
          label?: string | null
          last_used_at?: string
          profile_id: string
          trusted_until: string
        }
        Update: {
          created_at?: string
          device_hash?: string
          id?: string
          label?: string | null
          last_used_at?: string
          profile_id?: string
          trusted_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "trusted_devices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      two_step_codes: {
        Row: {
          attempts: number
          channel: string
          code_hash: string | null
          created_at: string
          demo_code: string | null
          destination: string
          expires_at: string
          profile_id: string
          salt: string | null
          sends: number
          sent_to: string
          window_started_at: string
        }
        Insert: {
          attempts?: number
          channel: string
          code_hash?: string | null
          created_at?: string
          demo_code?: string | null
          destination: string
          expires_at: string
          profile_id: string
          salt?: string | null
          sends?: number
          sent_to: string
          window_started_at?: string
        }
        Update: {
          attempts?: number
          channel?: string
          code_hash?: string | null
          created_at?: string
          demo_code?: string | null
          destination?: string
          expires_at?: string
          profile_id?: string
          salt?: string | null
          sends?: number
          sent_to?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "two_step_codes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      two_step_passes: {
        Row: {
          passed_at: string
          profile_id: string
          session_id: string
          trusted_until: string
        }
        Insert: {
          passed_at?: string
          profile_id: string
          session_id: string
          trusted_until: string
        }
        Update: {
          passed_at?: string
          profile_id?: string
          session_id?: string
          trusted_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "two_step_passes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          compact_lists: boolean
          created_at: string
          digest_minutes: number
          home_order: string
          home_sections: Json | null
          notify_announcements: boolean
          notify_messages: boolean
          notify_reminder_24h: boolean
          notify_reminder_2h: boolean
          notify_rsvp_changes: boolean
          profile_id: string
          quiet_hours_enabled: boolean
          quiet_hours_end: string
          quiet_hours_start: string
          text_scale: string
          theme: string
          updated_at: string
        }
        Insert: {
          compact_lists?: boolean
          created_at?: string
          digest_minutes?: number
          home_order?: string
          home_sections?: Json | null
          notify_announcements?: boolean
          notify_messages?: boolean
          notify_reminder_24h?: boolean
          notify_reminder_2h?: boolean
          notify_rsvp_changes?: boolean
          profile_id: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          text_scale?: string
          theme?: string
          updated_at?: string
        }
        Update: {
          compact_lists?: boolean
          created_at?: string
          digest_minutes?: number
          home_order?: string
          home_sections?: Json | null
          notify_announcements?: boolean
          notify_messages?: boolean
          notify_reminder_24h?: boolean
          notify_reminder_2h?: boolean
          notify_rsvp_changes?: boolean
          profile_id?: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          text_scale?: string
          theme?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          academy_id: string
          address: string | null
          amenities: Json
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          address?: string | null
          amenities?: Json
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          address?: string | null
          amenities?: Json
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_redemptions: {
        Row: {
          academy_id: string
          amount_cents: number
          created_at: string
          id: string
          player_id: string | null
          profile_id: string
          request_id: string
          voucher_id: string
        }
        Insert: {
          academy_id: string
          amount_cents: number
          created_at?: string
          id?: string
          player_id?: string | null
          profile_id: string
          request_id: string
          voucher_id: string
        }
        Update: {
          academy_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          player_id?: string | null
          profile_id?: string
          request_id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_redemptions_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          academy_id: string
          active: boolean
          amount_cents: number | null
          code: string
          created_at: string
          created_by: string | null
          expires_on: string | null
          id: string
          kind: string
          label: string
          max_uses: number | null
          percent_bps: number | null
          program_id: string | null
          used_count: number
        }
        Insert: {
          academy_id: string
          active?: boolean
          amount_cents?: number | null
          code: string
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          id?: string
          kind?: string
          label: string
          max_uses?: number | null
          percent_bps?: number | null
          program_id?: string | null
          used_count?: number
        }
        Update: {
          academy_id?: string
          active?: boolean
          amount_cents?: number | null
          code?: string
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          id?: string
          kind?: string
          label?: string
          max_uses?: number | null
          percent_bps?: number | null
          program_id?: string | null
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abandon_round: {
        Args: {
          p_cancel?: boolean
          p_competition: string
          p_division: string
          p_note?: string
          p_reason: string
          p_round: string
        }
        Returns: number
      }
      academy_invite_tree: {
        Args: { p_academy: string }
        Returns: {
          depth: number
          full_name: string
          invited_by: string
          inviter_name: string
          path: string[]
          profile_id: string
          role: Database["public"]["Enums"]["academy_role"]
          status: Database["public"]["Enums"]["member_status"]
        }[]
      }
      academy_results: { Args: { p_academy: string }; Returns: Json }
      accept_offer: { Args: { p_offer: string }; Returns: Json }
      add_fixture_change_note: {
        Args: { p_body: string; p_request: string }
        Returns: string
      }
      add_match_photos: {
        Args: { p_event: string; p_photos: Json }
        Returns: Json
      }
      add_match_video: {
        Args: {
          p_event: string
          p_kind: string
          p_path?: string
          p_title?: string
          p_url?: string
        }
        Returns: Json
      }
      add_member_role: {
        Args: {
          p_academy: string
          p_profile: string
          p_role: Database["public"]["Enums"]["academy_role"]
        }
        Returns: Database["public"]["Enums"]["academy_role"][]
      }
      add_pitch: { Args: { p_name?: string; p_venue: string }; Returns: string }
      add_player_clip: {
        Args: {
          p_event?: string
          p_note?: string
          p_player: string
          p_share?: boolean
          p_title: string
          p_url: string
        }
        Returns: string
      }
      add_referee: {
        Args: {
          p_competition: string
          p_full_name: string
          p_grade?: string
          p_phone?: string
          p_profile?: string
        }
        Returns: string
      }
      add_suspension: {
        Args: {
          p_competition: string
          p_games: number
          p_note?: string
          p_player: string
          p_reason: string
        }
        Returns: string
      }
      add_to_channel: {
        Args: {
          p_channel: string
          p_profile: string
          p_role?: Database["public"]["Enums"]["channel_member_role"]
        }
        Returns: undefined
      }
      announcement_reach: { Args: { p_message: string }; Returns: Json }
      answer_fixture_change: {
        Args: { p_agree: boolean; p_note?: string; p_request: string }
        Returns: undefined
      }
      applied_migration: { Args: { p_name: string }; Returns: string }
      apply_imported_results: {
        Args: { p_academy: string; p_events: Json; p_team: string }
        Returns: Json
      }
      apply_referee_allocation: {
        Args: { p_competition: string; p_rows: Json }
        Returns: Json
      }
      appoint_referee: {
        Args: {
          p_fixture: string
          p_referee: string
          p_role?: Database["public"]["Enums"]["referee_role"]
        }
        Returns: string
      }
      ask_for_helpers: { Args: { p_event: string }; Returns: number }
      attendance_summary: {
        Args: { p_academy: string; p_from?: string; p_team?: string }
        Returns: {
          absent: number
          excused: number
          late: number
          player_id: string
          player_name: string
          present: number
          rate: number
          sessions: number
          unmarked: number
        }[]
      }
      availability_grid: {
        Args: { p_past?: number; p_team: string; p_upcoming?: number }
        Returns: Json
      }
      broadcast_to_competition: {
        Args: { p_body: string; p_competition: string; p_urgent?: boolean }
        Returns: number
      }
      build_referee_payment_run: {
        Args: {
          p_competition: string
          p_from: string
          p_note?: string
          p_to: string
        }
        Returns: string
      }
      bulk_invite_clubs: {
        Args: { p_clubs: Json; p_competition: string; p_division: string }
        Returns: {
          club_name: string
          token: string
        }[]
      }
      bulk_scores: {
        Args: { p_competition: string; p_rows: Json }
        Returns: Json
      }
      calendar_feed_events: {
        Args: { p_token: string }
        Returns: {
          address: string
          arrive_at: string
          cancelled_at: string
          ends_at: string
          event_id: string
          kit_colour: string
          opponent: string
          starts_at: string
          timezone: string
          title: string
          updated_at: string
          venue: string
        }[]
      }
      call_off_day: {
        Args: {
          p_academy: string
          p_date: string
          p_note?: string
          p_reason?: string
          p_team?: string
          p_venue?: string
        }
        Returns: Json
      }
      call_off_fixtures: {
        Args: {
          p_cancel?: boolean
          p_competition: string
          p_date: string
          p_note?: string
          p_pitch?: string
          p_reason: string
          p_venue?: string
        }
        Returns: Json
      }
      can_post_in_channel: {
        Args: { p_channel: string; p_reply_to?: string }
        Returns: boolean
      }
      cancel_scheduled_message: {
        Args: { p_message: string }
        Returns: undefined
      }
      card_sponsors: { Args: { p_academy: string }; Returns: Json }
      cast_poll_vote: {
        Args: {
          p_note?: string
          p_options: string[]
          p_player?: string
          p_poll: string
        }
        Returns: undefined
      }
      channel_mentionables: { Args: { p_channel: string }; Returns: Json }
      channel_messages: {
        Args: { p_before?: string; p_channel: string; p_limit?: number }
        Returns: {
          attachments: Json
          audience: string
          body: string
          created_at: string
          deleted_at: string
          edited_at: string
          event: Json
          event_id: string
          id: string
          is_announcement: boolean
          pinned_at: string
          poll: Json
          poll_id: string
          reply_count: number
          reply_to_announcement: boolean
          reply_to_body: string
          reply_to_id: string
          reply_to_name: string
          sender_id: string
          sender_label: string
          sender_name: string
          sender_role: Database["public"]["Enums"]["academy_role"]
        }[]
      }
      chat_screen: { Args: { p_academy?: string }; Returns: Json }
      check_join_rate: {
        Args: { p_ip_hash: string; p_link: string }
        Returns: boolean
      }
      check_registration: {
        Args: {
          p_academy_slug: string
          p_child_dob: string
          p_consents: Json
          p_program: string
        }
        Returns: string
      }
      check_registration_rate: {
        Args: { p_ip_hash: string; p_program: string }
        Returns: boolean
      }
      child_privacy: { Args: { p_player: string }; Returns: Json }
      claim_competition_invite: {
        Args: { p_academy: string; p_team?: string; p_token: string }
        Returns: string
      }
      claim_notifications: {
        Args: { p_limit?: number }
        Returns: {
          auth: string
          body: string
          endpoint: string
          id: string
          kind: string
          p256dh: string
          platform: string
          profile_id: string
          sub_id: string
          title: string
          url: string
        }[]
      }
      claim_player_login: { Args: never; Returns: Json }
      claim_referee: { Args: { p_token: string }; Returns: Json }
      claim_sms_escalations: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          id: string
          phone: string
          profile_id: string
          title: string
        }[]
      }
      clearance_board: {
        Args: { p_academy?: string }
        Returns: {
          academy_role: Database["public"]["Enums"]["academy_role"]
          coaches: string
          days_left: number
          expires_on: string
          full_name: string
          kind: Database["public"]["Enums"]["clearance_kind"]
          number: string
          outcome: Database["public"]["Enums"]["clearance_outcome"]
          profile_id: string
          state: string
          verified_at: string
          verified_by: string
        }[]
      }
      close_ground: {
        Args: {
          p_academy: string
          p_date: string
          p_note?: string
          p_reason?: string
          p_venue: string
        }
        Returns: Json
      }
      close_support_request: { Args: { p_request: string }; Returns: undefined }
      club_allocate_referee: {
        Args: {
          p_fixture: string
          p_full_name: string
          p_grade?: string
          p_phone?: string
        }
        Returns: string
      }
      club_allocate_window: { Args: { p_fixture: string }; Returns: Json }
      club_decide_forfeit: {
        Args: { p_approve: boolean; p_note?: string; p_request: string }
        Returns: undefined
      }
      club_health: { Args: { p_academy?: string }; Returns: Json }
      club_messages_sent: { Args: { p_academy: string }; Returns: Json }
      club_officials: { Args: { p_academy: string }; Returns: Json }
      competition_appointments: {
        Args: { p_competition: string; p_division?: string }
        Returns: Json
      }
      competition_contacts: {
        Args: { p_competition: string }
        Returns: {
          academy_id: string
          accepted_by: string
          club_name: string
          contact_email: string
          contact_name: string
          contact_phone: string
          status: string
        }[]
      }
      competition_fees_view: { Args: { p_competition: string }; Returns: Json }
      competition_ladder: {
        Args: { p_competition: string; p_division: string }
        Returns: {
          drawn: number
          entry_id: string
          goal_difference: number
          goals_against: number
          goals_for: number
          group_label: string
          lost: number
          played: number
          points: number
          team_name: string
          won: number
        }[]
      }
      competition_people: { Args: { p_competition: string }; Returns: Json }
      competition_run_sheet: {
        Args: { p_competition: string; p_division?: string }
        Returns: {
          away_entry_id: string
          away_name: string
          away_score: number
          can_score: boolean
          division: string
          field_label: string
          fixture_id: string
          group_label: string
          home_entry_id: string
          home_name: string
          home_score: number
          referees: string
          round: string
          starts_at: string
          status: Database["public"]["Enums"]["fixture_status"]
        }[]
      }
      conduct_register: { Args: { p_academy?: string }; Returns: Json }
      confirm_match_sheet: {
        Args: { p_entry: string; p_fixture: string }
        Returns: undefined
      }
      confirm_official_rego: {
        Args: { p_confirmed?: boolean; p_request: string }
        Returns: undefined
      }
      convert_poll_to_event: {
        Args: {
          p_poll: string
          p_starts_at: string
          p_title: string
          p_type?: Database["public"]["Enums"]["event_type"]
          p_venue?: string
        }
        Returns: string
      }
      count_sponsor_views: { Args: { p_slug: string }; Returns: number }
      create_academy: {
        Args: {
          p_colour?: string
          p_name: string
          p_timezone?: string
          p_type?: Database["public"]["Enums"]["org_type"]
        }
        Returns: string
      }
      create_channel: {
        Args: {
          p_academy: string
          p_members?: string[]
          p_mode?: Database["public"]["Enums"]["posting_mode"]
          p_name: string
          p_team?: string
        }
        Returns: string
      }
      create_event_series: {
        Args: {
          p_academy: string
          p_address?: string
          p_arrive?: number
          p_days: number[]
          p_duration?: number
          p_from: string
          p_kit_colour?: string
          p_notes?: string
          p_team?: string
          p_time: string
          p_title: string
          p_type?: Database["public"]["Enums"]["event_type"]
          p_until: string
          p_venue?: string
        }
        Returns: Json
      }
      create_finals: {
        Args: {
          p_competition: string
          p_division: string
          p_fields?: string[]
          p_game_mins?: number
          p_gap_mins?: number
          p_start_at: string
          p_venue_label?: string
        }
        Returns: number
      }
      create_ground_day: {
        Args: {
          p_academy: string
          p_date: string
          p_jobs?: Json
          p_venue: string
        }
        Returns: string
      }
      create_imported_events: {
        Args: {
          p_academy: string
          p_cancel_missing?: boolean
          p_events: Json
          p_team: string
        }
        Returns: {
          cancelled: number
          created: number
          skipped: number
          updated: number
        }[]
      }
      create_scanned_events: {
        Args: { p_events: Json; p_scan: string }
        Returns: string[]
      }
      create_training_series: {
        Args: {
          p_academy: string
          p_arrive?: number
          p_days: number[]
          p_duration?: number
          p_from: string
          p_pitch?: string
          p_team?: string
          p_time: string
          p_title: string
          p_until: string
          p_venue?: string
        }
        Returns: Json
      }
      create_trial_sessions: {
        Args: {
          p_days: number[]
          p_duration?: number
          p_from: string
          p_program: string
          p_time: string
          p_until: string
          p_venue?: string
        }
        Returns: Json
      }
      cross_group_standings: {
        Args: { p_competition: string; p_division: string; p_position: number }
        Returns: {
          entry_id: string
          goal_difference: number
          goals_for: number
          group_label: string
          points: number
          team_name: string
        }[]
      }
      decide_concussion_clearance: {
        Args: { p_accept: boolean; p_concussion: string; p_note?: string }
        Returns: undefined
      }
      decide_entry_request: {
        Args: {
          p_accept: boolean
          p_division?: string
          p_note?: string
          p_request: string
        }
        Returns: Json
      }
      decide_fixture_change: {
        Args: { p_approve: boolean; p_note?: string; p_request: string }
        Returns: undefined
      }
      decide_match_correction: {
        Args: { p_apply: boolean; p_correction: string; p_note?: string }
        Returns: undefined
      }
      decide_player_login: {
        Args: { p_approve: boolean; p_player: string }
        Returns: Json
      }
      decline_offer: { Args: { p_offer: string }; Returns: undefined }
      discipline_report: { Args: { p_competition: string }; Returns: Json }
      division_table: { Args: { p_team: string }; Returns: Json }
      draw_quality: {
        Args: { p_competition: string; p_division: string }
        Returns: Json
      }
      enable_club_mode: { Args: { p_academy: string }; Returns: boolean }
      end_event_series: {
        Args: {
          p_delete?: boolean
          p_from?: string
          p_reason?: string
          p_series: string
        }
        Returns: Json
      }
      end_match: {
        Args: { p_fixture: string; p_note?: string }
        Returns: string
      }
      end_player_login: { Args: { p_player: string }; Returns: Json }
      enqueue_event_reminders: { Args: never; Returns: number }
      ensure_system_channel: {
        Args: {
          p_academy: string
          p_age_group?: string
          p_name?: string
          p_type: Database["public"]["Enums"]["channel_type"]
        }
        Returns: string
      }
      enter_sheet_score: {
        Args: {
          p_entry: string
          p_fixture: string
          p_ours: number
          p_theirs: number
        }
        Returns: Json
      }
      entry_nominations: { Args: { p_competition: string }; Returns: Json }
      entry_requests: { Args: { p_competition: string }; Returns: Json }
      erase_me: { Args: never; Returns: Json }
      event_checklist: { Args: { p_event: string }; Returns: Json }
      event_duties: { Args: { p_event: string }; Returns: Json }
      event_helpers: { Args: { p_event: string }; Returns: Json }
      event_lineup: { Args: { p_event: string }; Returns: Json }
      event_live: { Args: { p_event: string }; Returns: Json }
      event_pulse_view: { Args: { p_event: string }; Returns: Json }
      event_register: {
        Args: { p_event: string }
        Returns: {
          note: string
          player_id: string
          player_name: string
          rsvp: string
          squad_number: number
          status: Database["public"]["Enums"]["attendance_status"]
        }[]
      }
      event_result: {
        Args: { p_event: string }
        Returns: {
          entered_at: string
          entered_by: string
          note: string
          ours: number
          outcome: string
          source: string
          theirs: number
          was_home: boolean
        }[]
      }
      event_rsvp_summary: {
        Args: { p_event: string }
        Returns: {
          going: number
          maybe: number
          no_reply: number
          out_count: number
        }[]
      }
      event_stats: { Args: { p_event: string }; Returns: Json }
      exempt_player_age: {
        Args: { p_entry: string; p_exempt: boolean; p_player: string }
        Returns: undefined
      }
      expire_stale_join_requests: { Args: never; Returns: number }
      expire_stale_registrations: { Args: never; Returns: number }
      export_my_data: { Args: never; Returns: Json }
      fan_out_club_messages: { Args: never; Returns: number }
      features_off: { Args: { p_academy: string }; Returns: string[] }
      field_impact: {
        Args: {
          p_competition: string
          p_date: string
          p_field?: string
          p_venue?: string
        }
        Returns: Json
      }
      file_conduct_report: {
        Args: {
          p_academy: string
          p_category: Database["public"]["Enums"]["conduct_category"]
          p_description: string
          p_involves_child?: boolean
          p_occurred_on?: string
          p_subject_name?: string
          p_subject_profile?: string
        }
        Returns: string
      }
      finance_export: {
        Args: { p_academy: string }
        Returns: {
          due_on: string
          fee_cents: number
          guardian_name: string
          guardian_phone: string
          instalments: number
          net_cents: number
          outstanding_cents: number
          paid_at: string
          paid_cents: number
          player_id: string
          player_name: string
          request_id: string
          scope_kind: string
          scope_name: string
          status: string
          stripe_payment_intents: string
          title: string
        }[]
      }
      fixture_change_requests: {
        Args: { p_competition: string }
        Returns: Json
      }
      fixture_checkin_key: { Args: { p_fixture: string }; Returns: string }
      fixture_pitch: { Args: { p_fixture: string }; Returns: Json }
      fixture_sides: { Args: { p_fixture: string }; Returns: Json }
      fixtures_screen: {
        Args: { p_academy?: string; p_days?: number }
        Returns: Json
      }
      forfeit_fixture: {
        Args: { p_fixture: string; p_forfeiting_entry: string; p_note?: string }
        Returns: undefined
      }
      forfeit_requests_view: {
        Args: { p_competition: string }
        Returns: {
          away: string
          club_decided_at: string
          club_note: string
          created_at: string
          division: string
          entry_id: string
          entry_name: string
          fixture_id: string
          home: string
          id: string
          league_decided_at: string
          league_note: string
          reason: string
          requested_by_name: string
          round: string
          starts_at: string
          status: string
        }[]
      }
      generate_fixtures: {
        Args: {
          p_competition: string
          p_division: string
          p_fields?: string[]
          p_game_mins?: number
          p_gap_mins?: number
          p_replace?: boolean
          p_round_every_days?: number
          p_start_at: string
          p_venue_label?: string
        }
        Returns: number
      }
      generate_fixtures_managed: {
        Args: {
          p_competition: string
          p_division: string
          p_fields?: string[]
          p_game_mins?: number
          p_gap_mins?: number
          p_replace?: boolean
          p_round_every_days?: number
          p_start_at: string
          p_venue_label?: string
        }
        Returns: number
      }
      generate_fixtures_on_pitches: {
        Args: {
          p_competition: string
          p_division: string
          p_first_date: string
          p_game_mins?: number
          p_gap_mins?: number
          p_replace?: boolean
          p_round_every_days?: number
          p_venue: string
        }
        Returns: Json
      }
      get_reaction_voters: {
        Args: { p_emoji: string; p_message: string }
        Returns: {
          avatar_url: string
          full_name: string
          profile_id: string
        }[]
      }
      give_respect_marks: {
        Args: {
          p_about_entry: string
          p_coaches: number
          p_fixture: string
          p_note?: string
          p_players: number
          p_spectators: number
        }
        Returns: string
      }
      grant_club_role: {
        Args: {
          p_academy: string
          p_age_group?: string
          p_profile: string
          p_role: Database["public"]["Enums"]["club_role"]
          p_scope_kind?: string
          p_stream?: string
          p_team?: string
        }
        Returns: string
      }
      grant_league_role: {
        Args: {
          p_competition: string
          p_profile: string
          p_role: Database["public"]["Enums"]["league_role"]
        }
        Returns: undefined
      }
      ground_slots: { Args: { p_venue: string }; Returns: Json }
      group_channel_info: { Args: { p_channel: string }; Returns: Json }
      group_overview: { Args: { p_academy: string }; Returns: Json }
      help_with: { Args: { p_job: string }; Returns: Json }
      home_jobs: {
        Args: { p_academy?: string; p_persona?: string }
        Returns: Json
      }
      home_layout: { Args: { p_academy?: string }; Returns: Json }
      home_screen: { Args: { p_academy?: string }; Returns: Json }
      import_league_draw: {
        Args: { p_competition: string; p_rows: Json }
        Returns: Json
      }
      import_official_status: {
        Args: { p_academy: string; p_rows: Json }
        Returns: Json
      }
      import_players: {
        Args: {
          p_academy: string
          p_batch?: string
          p_rows: Json
          p_season?: string
          p_team: string
        }
        Returns: Json
      }
      import_screen: { Args: { p_academy?: string }; Returns: Json }
      invite_player_login: {
        Args: { p_email: string; p_player: string }
        Returns: Json
      }
      is_academy_coach: { Args: { p_academy: string }; Returns: boolean }
      is_team_coach: { Args: { p_team: string }; Returns: boolean }
      kit_list: { Args: { p_academy?: string; p_team?: string }; Returns: Json }
      league_decide_forfeit: {
        Args: { p_approve: boolean; p_note?: string; p_request: string }
        Returns: undefined
      }
      league_officials: { Args: { p_competition: string }; Returns: Json }
      levy_statement: { Args: { p_competition: string }; Returns: Json }
      live_tick: {
        Args: {
          p_assist?: string
          p_at?: string
          p_client_id?: string
          p_event: string
          p_kind: string
          p_minute?: number
          p_note?: string
          p_player?: string
        }
        Returns: Json
      }
      lock_entry_squad: {
        Args: { p_entry: string; p_locked: boolean }
        Returns: undefined
      }
      make_offer: {
        Args: {
          p_days?: number
          p_registration: string
          p_squad_program: string
        }
        Returns: string
      }
      mark_channel_read: { Args: { p_channel: string }; Returns: undefined }
      mark_club_message_seen: {
        Args: { p_message: string }
        Returns: undefined
      }
      mark_entry_fee: {
        Args: {
          p_fee: string
          p_method?: string
          p_note?: string
          p_status: Database["public"]["Enums"]["entry_fee_status"]
        }
        Returns: undefined
      }
      mark_referee_run_paid: {
        Args: { p_method?: string; p_run: string }
        Returns: undefined
      }
      mark_scan_purged: { Args: { p_scan: string }; Returns: undefined }
      match_corrections_view: {
        Args: { p_competition: string }
        Returns: {
          away: string
          created_at: string
          decided_at: string
          decision_note: string
          detail: string
          division: string
          entry_name: string
          fixture_id: string
          home: string
          id: string
          kind: string
          proposed_away: number
          proposed_home: number
          requested_by_name: string
          round: string
          status: string
        }[]
      }
      match_day_ops: { Args: { p_competition: string }; Returns: Json }
      match_photos: { Args: { p_event: string }; Returns: Json }
      match_sheet_view: { Args: { p_fixture: string }; Returns: Json }
      matchday_videos: { Args: { p_event: string }; Returns: Json }
      member_contact: {
        Args: { p_academy: string; p_profile: string }
        Returns: {
          can_dm: boolean
          full_name: string
          is_me: boolean
          phone: string
          profile_id: string
          role: Database["public"]["Enums"]["academy_role"]
          teams: string[]
        }[]
      }
      member_directory: {
        Args: { p_academy: string }
        Returns: {
          avatar_url: string
          full_name: string
          phone: string
          profile_id: string
          role: Database["public"]["Enums"]["academy_role"]
          teams: string[]
        }[]
      }
      member_emails: {
        Args: { p_academy: string }
        Returns: {
          email: string
          profile_id: string
          verified: boolean
        }[]
      }
      mirror_fixture: { Args: { p_fixture: string }; Returns: undefined }
      month_dots: {
        Args: { p_academy?: string; p_month?: string }
        Returns: {
          events: number
          has_match: boolean
          on_date: string
        }[]
      }
      move_pitch: {
        Args: { p_pitch: string; p_x: number; p_y: number }
        Returns: undefined
      }
      move_players: {
        Args: { p_academy: string; p_moves: Json }
        Returns: Json
      }
      my_appointments: { Args: never; Returns: Json }
      my_calendar_token: { Args: { p_rotate?: boolean }; Returns: string }
      my_channels: {
        Args: { p_academy: string }
        Returns: {
          channel_id: string
          last_message_at: string
          last_message_body: string
          last_sender_name: string
          muted: boolean
          my_role: Database["public"]["Enums"]["channel_member_role"]
          name: string
          posting_mode: Database["public"]["Enums"]["posting_mode"]
          status: Database["public"]["Enums"]["channel_status"]
          team_id: string
          type: Database["public"]["Enums"]["channel_type"]
          unread_count: number
        }[]
      }
      my_club_access: { Args: { p_academy: string }; Returns: Json }
      my_club_messages: { Args: { p_academy: string }; Returns: Json }
      my_competition_access: { Args: { p_competition: string }; Returns: Json }
      my_digest_minutes: { Args: never; Returns: number }
      my_email: { Args: never; Returns: Json }
      my_entries: { Args: { p_competition: string }; Returns: Json }
      my_entry_fees: { Args: { p_competition: string }; Returns: Json }
      my_family: { Args: never; Returns: Json }
      my_levy_statement: { Args: { p_competition: string }; Returns: Json }
      my_matchdays: {
        Args: { p_academy: string; p_limit?: number }
        Returns: Json
      }
      my_offers: { Args: never; Returns: Json }
      my_organisations: {
        Args: never
        Returns: {
          id: string
          logo_url: string
          name: string
          primary_colour: string
          role: Database["public"]["Enums"]["academy_role"]
          slug: string
          type: Database["public"]["Enums"]["org_type"]
        }[]
      }
      my_organisations_with_competitions: { Args: never; Returns: Json }
      my_payment_requests: {
        Args: { p_academy: string }
        Returns: {
          amount_cents: number
          can_pay: boolean
          closes_at: string
          currency: string
          description: string
          due_on: string
          paid_at: string
          player_id: string
          player_name: string
          promised_by: string
          request_id: string
          status: string
          team_name: string
          title: string
          voucher_cents: number
          voucher_label: string
        }[]
      }
      my_poll_votes: {
        Args: { p_poll: string }
        Returns: {
          note: string
          option_ids: string[]
          player_id: string
          player_name: string
        }[]
      }
      my_profile: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          phone: string
        }[]
      }
      my_respect_marks: { Args: { p_fixture: string }; Returns: Json }
      my_rsvps_for_event: {
        Args: { p_event: string }
        Returns: {
          note: string
          player_id: string
          player_name: string
          status: Database["public"]["Enums"]["rsvp_status"]
        }[]
      }
      my_scheduled_messages: { Args: { p_channel: string }; Returns: Json }
      my_upcoming_events: {
        Args: { p_academy: string; p_days?: number }
        Returns: {
          address: string
          arrive_at: string
          cancelled_at: string
          competition: string
          confirmed_at: string
          ends_at: string
          going: number
          id: string
          kit_colour: string
          my_children: number
          my_replies: number
          no_reply: number
          opponent: string
          private_to: string
          round: string
          source: string
          starts_at: string
          team_id: string
          team_name: string
          title: string
          type: Database["public"]["Enums"]["event_type"]
          venue: string
        }[]
      }
      nav_badges: { Args: { p_academy?: string }; Returns: Json }
      needs_you: { Args: { p_academy?: string }; Returns: Json }
      next_squad_number: {
        Args: { p_academy: string; p_preferred?: number; p_season: string }
        Returns: number
      }
      nominate_entry: {
        Args: { p_division: string; p_entry: string; p_note?: string }
        Returns: undefined
      }
      normalise_phone: { Args: { p_phone: string }; Returns: string }
      note_appeal: {
        Args: { p_note: string; p_suspension: string }
        Returns: undefined
      }
      notice_email_recipients: {
        Args: { p_message: string }
        Returns: {
          competition: string
          email: string
          league: string
          profile_id: string
          reply_to: string
          standing: string
        }[]
      }
      notices_reach: {
        Args: { p_channel: string; p_message_ids: string[] }
        Returns: {
          message_id: string
          seen: number
          total: number
        }[]
      }
      nudge_non_responders: { Args: { p_event: string }; Returns: Json }
      nudge_unregistered: {
        Args: { p_academy: string; p_season: string }
        Returns: number
      }
      offer_returning_places: {
        Args: {
          p_academy: string
          p_players?: string[]
          p_season: string
          p_until: string
        }
        Returns: Json
      }
      open_competition_direct: {
        Args: { p_competition: string; p_other: string }
        Returns: string
      }
      open_direct_channel: {
        Args: { p_academy: string; p_other: string }
        Returns: string
      }
      open_games_for_me: { Args: never; Returns: Json }
      open_potm_vote: {
        Args: { p_event: string; p_open?: boolean }
        Returns: Json
      }
      open_support_request: {
        Args: { p_academy?: string; p_body: string; p_subject: string }
        Returns: string
      }
      outstanding_consents: {
        Args: { p_player: string }
        Returns: {
          body: string
          document_id: string
          kind: Database["public"]["Enums"]["consent_kind"]
          required: boolean
          title: string
          version: number
        }[]
      }
      outstanding_fees: {
        Args: { p_academy: string }
        Returns: {
          days_overdue: number
          guardian_name: string
          guardian_phone: string
          net_cents: number
          next_due: string
          outstanding_cents: number
          paid_cents: number
          player_id: string
          player_name: string
          promised_by: string
          request_id: string
          title: string
        }[]
      }
      overturn_suspension: {
        Args: { p_note: string; p_suspension: string }
        Returns: undefined
      }
      payment_register: {
        Args: { p_request: string }
        Returns: {
          amount_cents: number
          guardian: string
          guardian_phone: string
          paid_at: string
          player_id: string
          player_name: string
          promised_by: string
          status: string
        }[]
      }
      peek_competition_invite: {
        Args: { p_token: string }
        Returns: {
          club_name: string
          competition_name: string
          division: string
          organiser_name: string
          starts_on: string
          status: string
        }[]
      }
      pending_messages: {
        Args: { p_channel: string }
        Returns: {
          attachments: Json
          body: string
          created_at: string
          id: string
          sender_id: string
          sender_name: string
        }[]
      }
      photo_consent_check: { Args: { p_channel: string }; Returns: Json }
      pitch_size_rules_for: { Args: { p_academy: string }; Returns: Json }
      place_trial_player: {
        Args: { p_player: string; p_program: string; p_team: string }
        Returns: undefined
      }
      platform_overview: {
        Args: never
        Returns: {
          academy_id: string
          channels: number
          created_at: string
          last_activity: string
          members: number
          messages: number
          name: string
          plan: string
          players: number
          slug: string
          teams: number
          type: Database["public"]["Enums"]["org_type"]
        }[]
      }
      platform_totals: {
        Args: never
        Returns: {
          active_7d: number
          competitions: number
          messages: number
          organisations: number
          people: number
          players: number
          teams: number
        }[]
      }
      player_card: { Args: { p_player: string }; Returns: Json }
      player_development: { Args: { p_player: string }; Returns: Json }
      player_season_stats: { Args: { p_player: string }; Returns: Json }
      poll_counts: {
        Args: { p_poll: string }
        Returns: {
          option_id: string
          votes: number
        }[]
      }
      poll_non_responders: {
        Args: { p_poll: string }
        Returns: {
          full_name: string
          player_id: string
          player_name: string
          profile_id: string
        }[]
      }
      poll_results: {
        Args: { p_poll: string }
        Returns: {
          label: string
          option_id: string
          voted_by_me: boolean
          votes: number
        }[]
      }
      postpone_fixture: {
        Args: {
          p_cancel?: boolean
          p_fixture: string
          p_note?: string
          p_reason: string
        }
        Returns: undefined
      }
      preview_club_message: {
        Args: { p_academy: string; p_audience: Json }
        Returns: Json
      }
      preview_imported_events: {
        Args: { p_academy: string; p_events: Json; p_team: string }
        Returns: Json
      }
      preview_player_moves: {
        Args: { p_academy: string; p_moves: Json }
        Returns: Json
      }
      preview_season_plan: {
        Args: { p_academy: string; p_from: string; p_to: string }
        Returns: Json
      }
      preview_season_rollover: {
        Args: { p_academy: string; p_from: string; p_to: string }
        Returns: Json
      }
      promise_to_pay: {
        Args: { p_by?: string; p_player?: string; p_request: string }
        Returns: Json
      }
      propose_fixture_change: {
        Args: {
          p_field?: string
          p_fixture: string
          p_reason: string
          p_starts_at?: string
          p_venue?: string
        }
        Returns: string
      }
      propose_referee_allocation: {
        Args: { p_competition: string; p_date: string; p_division?: string }
        Returns: Json
      }
      public_academy: { Args: { p_slug: string }; Returns: Json }
      public_brand: { Args: { p_kind?: string; p_slug: string }; Returns: Json }
      public_competition_entry: { Args: { p_slug: string }; Returns: Json }
      public_match_centre: { Args: { p_slug: string }; Returns: Json }
      public_programs: { Args: { p_slug: string }; Returns: Json }
      public_sponsors: { Args: { p_slug: string }; Returns: Json }
      public_status: { Args: never; Returns: Json }
      publish_lineup: {
        Args: { p_event: string; p_published?: boolean; p_tell_out?: boolean }
        Returns: undefined
      }
      publish_scheduled_messages: { Args: never; Returns: number }
      publish_teams: {
        Args: { p_academy: string; p_program?: string; p_teams?: string[] }
        Returns: Json
      }
      publish_teams_preview: {
        Args: { p_academy: string; p_program?: string }
        Returns: Json
      }
      pulse_in: {
        Args: { p_event: string; p_mood: number; p_note?: string }
        Returns: Json
      }
      purge_expired_message_archive: { Args: never; Returns: number }
      queue_clearance_warnings: { Args: never; Returns: number }
      queue_duty_reminders: { Args: { p_now?: string }; Returns: number }
      queue_fee_reminders: { Args: never; Returns: number }
      queue_match_day_pushes: { Args: never; Returns: number }
      queue_official_rego_reminders: { Args: never; Returns: number }
      queue_team_sheet_reminders: { Args: { p_now?: string }; Returns: number }
      quote_payment: {
        Args: { p_player?: string; p_request: string }
        Returns: Json
      }
      rate_trial_player: {
        Args: {
          p_note?: string
          p_player: string
          p_program: string
          p_rating: number
        }
        Returns: string
      }
      reaction_counts: {
        Args: { p_message_ids: string[] }
        Returns: {
          emoji: string
          message_id: string
          reacted_by_me: boolean
          reaction_count: number
        }[]
      }
      read_receipts: {
        Args: { p_channel: string; p_message_ids: string[] }
        Returns: {
          member_count: number
          message_id: string
          read_count: number
        }[]
      }
      recent_wake_calls: {
        Args: { p_minutes?: number }
        Returns: {
          created: string
          id: number
          ms: number
          status_code: number
        }[]
      }
      record_clearance: {
        Args: {
          p_academy: string
          p_expires_on: string
          p_kind?: Database["public"]["Enums"]["clearance_kind"]
          p_note?: string
          p_number: string
          p_outcome: Database["public"]["Enums"]["clearance_outcome"]
          p_profile: string
        }
        Returns: string
      }
      record_concussion: {
        Args: { p_note?: string; p_occurred_on: string; p_player: string }
        Returns: string
      }
      record_levy_payment: {
        Args: {
          p_amount_cents: number
          p_club: string
          p_competition: string
          p_method?: string
          p_note?: string
          p_paid_on?: string
        }
        Returns: Json
      }
      record_match_event: {
        Args: {
          p_code?: string
          p_entry: string
          p_fixture: string
          p_kind: Database["public"]["Enums"]["match_event_kind"]
          p_minute?: number
          p_note?: string
          p_player?: string
        }
        Returns: string
      }
      redeem_voucher: {
        Args: { p_code: string; p_player: string; p_request: string }
        Returns: Json
      }
      referee_availability: { Args: { p_fixture: string }; Returns: Json }
      referee_check_in: { Args: { p_appointment: string }; Returns: string }
      referee_check_in_by_key: {
        Args: { p_fixture: string; p_key: string }
        Returns: Json
      }
      referee_payments: { Args: { p_competition: string }; Returns: Json }
      referee_payments_export: {
        Args: { p_competition: string }
        Returns: {
          amount_cents: number
          bank_details: string
          game: string
          grade: string
          item_status: string
          paid_at: string
          paid_method: string
          played_on: string
          referee: string
          role: string
          run_period: string
          run_status: string
        }[]
      }
      referee_pool: { Args: { p_competition: string }; Returns: Json }
      referee_verify_by_phone: {
        Args: { p_fixture: string; p_phone: string; p_word: string }
        Returns: Json
      }
      refunds_to_issue: { Args: { p_academy: string }; Returns: Json }
      registration_queue: {
        Args: { p_academy?: string; p_status?: string }
        Returns: {
          answers: Json
          child_dob: string
          child_gender: string
          child_name: string
          consents: Json
          created_at: string
          decided_at: string
          decided_by: string
          decision_note: string
          existing_official_status: string
          existing_player_id: string
          ffa_number: string
          fifa_id: string
          guardian_email: string
          guardian_name: string
          guardian_phone: string
          official_confirmed_at: string
          program_id: string
          program_name: string
          request_id: string
          requires_official: boolean
          spots_left: number
          status: string
        }[]
      }
      remove_match_photo: { Args: { p_photo: string }; Returns: Json }
      remove_match_video: { Args: { p_video: string }; Returns: Json }
      remove_member_role: {
        Args: {
          p_academy: string
          p_profile: string
          p_role: Database["public"]["Enums"]["academy_role"]
        }
        Returns: Database["public"]["Enums"]["academy_role"][]
      }
      reopen_match: {
        Args: { p_fixture: string; p_note: string }
        Returns: undefined
      }
      reping_club_message: { Args: { p_message: string }; Returns: number }
      reping_unread: { Args: { p_message: string }; Returns: Json }
      reply_support: {
        Args: { p_body: string; p_request: string }
        Returns: string
      }
      report_message: {
        Args: {
          p_message: string
          p_note?: string
          p_reason: Database["public"]["Enums"]["report_reason"]
        }
        Returns: string
      }
      request_competition_entry: {
        Args: {
          p_club_name: string
          p_contact_email: string
          p_contact_name: string
          p_contact_phone: string
          p_division: string
          p_ip_hash: string
          p_note: string
          p_slug: string
          p_team_name: string
        }
        Returns: string
      }
      request_duty_swap: {
        Args: { p_duty: string; p_note?: string }
        Returns: Json
      }
      request_forfeit: {
        Args: { p_entry: string; p_fixture: string; p_reason: string }
        Returns: string
      }
      request_match_correction: {
        Args: {
          p_away?: number
          p_detail: string
          p_fixture: string
          p_home?: number
          p_kind: string
        }
        Returns: string
      }
      require_two_step: { Args: { p_academy: string }; Returns: boolean }
      reschedule_fixture: {
        Args: {
          p_field?: string
          p_fixture: string
          p_starts_at: string
          p_venue_label?: string
        }
        Returns: undefined
      }
      reschedule_message: {
        Args: { p_at: string; p_body?: string; p_message: string }
        Returns: undefined
      }
      resolve_finals: {
        Args: { p_competition: string; p_division: string }
        Returns: number
      }
      resolve_source: {
        Args: { p_competition: string; p_division: string; p_source: string }
        Returns: string
      }
      respect_dashboard: { Args: { p_competition: string }; Returns: Json }
      respond_appointment: {
        Args: { p_accept: boolean; p_appointment: string; p_note?: string }
        Returns: undefined
      }
      restore_match_photo: { Args: { p_photo: string }; Returns: Json }
      review_conduct_report: {
        Args: {
          p_outcome?: string
          p_referred_to?: string
          p_report: string
          p_status: Database["public"]["Enums"]["conduct_status"]
        }
        Returns: undefined
      }
      review_report: {
        Args: {
          p_outcome: string
          p_report: string
          p_status: Database["public"]["Enums"]["report_status"]
        }
        Returns: boolean
      }
      revoke_club_role: { Args: { p_role_id: string }; Returns: undefined }
      revoke_league_role: {
        Args: {
          p_competition: string
          p_profile: string
          p_role: Database["public"]["Enums"]["league_role"]
        }
        Returns: undefined
      }
      revoke_member_tree: {
        Args: { p_academy: string; p_profile: string }
        Returns: number
      }
      roll_over_season: {
        Args: { p_academy: string; p_from: string; p_plan?: Json; p_to: string }
        Returns: Json
      }
      rollover_report: {
        Args: { p_academy: string; p_season: string }
        Returns: Json
      }
      roster_team_duties: {
        Args: { p_games?: number; p_team: string }
        Returns: Json
      }
      rule_on_score: {
        Args: {
          p_away: number
          p_fixture: string
          p_home: number
          p_note?: string
        }
        Returns: undefined
      }
      safeguarding_queue: {
        Args: {
          p_academy?: string
          p_status?: Database["public"]["Enums"]["report_status"]
        }
        Returns: {
          body: string
          channel_name: string
          created_at: string
          deleted: boolean
          note: string
          outcome: string
          reason: Database["public"]["Enums"]["report_reason"]
          report_id: string
          reporter: string
          reviewed_at: string
          reviewed_by: string
          sender_name: string
          status: Database["public"]["Enums"]["report_status"]
        }[]
      }
      saturday_view: {
        Args: { p_academy: string; p_date?: string }
        Returns: Json
      }
      scans_due_for_purge: {
        Args: never
        Returns: {
          id: string
          storage_path: string
        }[]
      }
      schedule_message: {
        Args: {
          p_announcement?: boolean
          p_at: string
          p_body: string
          p_channel: string
        }
        Returns: string
      }
      scores_shown: { Args: { p_team: string }; Returns: boolean }
      search_chat: {
        Args: { p_academy?: string; p_limit?: number; p_query: string }
        Returns: Json
      }
      seed_entry_squad: { Args: { p_entry: string }; Returns: number }
      self_appoint: { Args: { p_fixture: string }; Returns: string }
      send_club_message: {
        Args: {
          p_academy: string
          p_audience?: Json
          p_body: string
          p_pinned?: boolean
          p_until?: string
          p_urgent?: boolean
        }
        Returns: string
      }
      set_academy_logo: {
        Args: { p_academy: string; p_url: string }
        Returns: undefined
      }
      set_bye: { Args: { p_fixture: string }; Returns: undefined }
      set_chat_language: { Args: { p_lang: string }; Returns: undefined }
      set_child_public_name: {
        Args: { p_hidden: boolean; p_player: string }
        Returns: undefined
      }
      set_competition_fee: {
        Args: {
          p_competition: string
          p_division: string
          p_fee_cents: number
          p_instructions?: string
        }
        Returns: undefined
      }
      set_competition_levy: {
        Args: {
          p_competition: string
          p_division: string
          p_instructions?: string
          p_levy_cents: number
        }
        Returns: Json
      }
      set_consent: {
        Args: { p_accepted: boolean; p_document: string; p_player: string }
        Returns: undefined
      }
      set_digest_minutes: { Args: { p_minutes: number }; Returns: undefined }
      set_entry_division: {
        Args: { p_division: string; p_entry: string; p_note?: string }
        Returns: undefined
      }
      set_event_jobs: { Args: { p_event: string; p_jobs: Json }; Returns: Json }
      set_event_result: {
        Args: {
          p_event: string
          p_home?: boolean
          p_note?: string
          p_ours?: number
          p_theirs?: number
        }
        Returns: undefined
      }
      set_feature: {
        Args: { p_academy: string; p_enabled: boolean; p_feature: string }
        Returns: boolean
      }
      set_fixture_flowing: {
        Args: { p_competition: string; p_days?: number; p_until: string }
        Returns: undefined
      }
      set_home_sections: { Args: { p_sections: Json }; Returns: Json }
      set_kit_sizes: {
        Args: {
          p_player: string
          p_shirt?: Database["public"]["Enums"]["kit_size"]
          p_shorts?: Database["public"]["Enums"]["kit_size"]
          p_socks?: Database["public"]["Enums"]["sock_size"]
        }
        Returns: undefined
      }
      set_lineup: {
        Args: {
          p_event: string
          p_formation?: string
          p_note?: string
          p_players: Json
        }
        Returns: string
      }
      set_my_bank_details: {
        Args: {
          p_details: string
          p_payee_name?: string
          p_referee: string
          p_under_18?: boolean
        }
        Returns: undefined
      }
      set_my_email: {
        Args: { p_email: string; p_news?: boolean }
        Returns: Json
      }
      set_my_news: { Args: { p_news: boolean }; Returns: Json }
      set_my_profile: {
        Args: { p_full_name: string; p_phone: string }
        Returns: undefined
      }
      set_official_status: {
        Args: {
          p_ff_number?: string
          p_player: string
          p_status: Database["public"]["Enums"]["official_rego_status"]
        }
        Returns: undefined
      }
      set_pitch_hours: {
        Args: { p_hours: Json; p_pitch: string }
        Returns: number
      }
      set_pitch_size_rules: {
        Args: { p_academy: string; p_rules: Json }
        Returns: number
      }
      set_player_of_match: {
        Args: { p_event: string; p_note?: string; p_player?: string }
        Returns: Json
      }
      set_player_photo: {
        Args: { p_path: string; p_player: string }
        Returns: undefined
      }
      set_player_stats: {
        Args: { p_event: string; p_rows: Json }
        Returns: Json
      }
      set_program_fee: {
        Args: {
          p_amount_cents: number
          p_due_on?: string
          p_every_days?: number
          p_instalments?: number
          p_program: string
          p_title?: string
        }
        Returns: string
      }
      set_public_name_hidden: {
        Args: { p_hidden: boolean; p_player: string }
        Returns: boolean
      }
      set_push_wake_config: {
        Args: { p_secret: string; p_url: string }
        Returns: undefined
      }
      set_referee_fee: {
        Args: {
          p_competition: string
          p_fee_cents: number
          p_role: Database["public"]["Enums"]["referee_role"]
        }
        Returns: undefined
      }
      set_referee_rules: {
        Args: {
          p_club_allocate_hours?: number
          p_competition: string
          p_grades?: string[]
          p_late_decline_hours: number
          p_self_appoint: boolean
        }
        Returns: undefined
      }
      set_team_duties: {
        Args: { p_team: string; p_titles: string[] }
        Returns: Json
      }
      set_training_slot: {
        Args: { p_pitch: string; p_series: string }
        Returns: Json
      }
      setup_progress: { Args: { p_academy?: string }; Returns: Json }
      share_player_report: {
        Args: { p_report: string; p_share: boolean }
        Returns: undefined
      }
      shift_round: {
        Args: {
          p_competition: string
          p_days: number
          p_division: string
          p_round: string
        }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      split_pitch: {
        Args: { p_into: number; p_pitch: string }
        Returns: number
      }
      start_import_batch: {
        Args: { p_academy: string; p_file?: string; p_kind?: string }
        Returns: string
      }
      stop_helping: {
        Args: { p_job: string; p_profile?: string }
        Returns: Json
      }
      store_imported_games: {
        Args: { p_academy: string; p_rows: Json; p_season: string }
        Returns: Json
      }
      submit_concussion_clearance: {
        Args: { p_concussion: string; p_note?: string; p_path: string }
        Returns: undefined
      }
      submit_match_sheet: {
        Args: {
          p_captain?: string
          p_entry: string
          p_fixture: string
          p_keeper?: string
          p_players: Json
        }
        Returns: string
      }
      submit_referee_report: {
        Args: { p_appointment: string; p_report: Json }
        Returns: undefined
      }
      support_threads: { Args: { p_inbox?: boolean }; Returns: Json }
      take_down_match_photo: { Args: { p_photo: string }; Returns: Json }
      take_duty: { Args: { p_duty: string }; Returns: Json }
      take_register: {
        Args: { p_event: string; p_marks: Json }
        Returns: number
      }
      team_coach_alerts: {
        Args: { p_team: string }
        Returns: {
          coach_note: string
          player_id: string
          player_name: string
        }[]
      }
      team_form: { Args: { p_n?: number; p_team: string }; Returns: Json }
      team_season_stats: { Args: { p_team: string }; Returns: Json }
      team_training: { Args: { p_team: string }; Returns: Json }
      tick_checklist: {
        Args: { p_done?: boolean; p_event: string; p_item: string }
        Returns: Json
      }
      to_e164: {
        Args: { p_default_country?: string; p_raw: string }
        Returns: string
      }
      translation_budget_take: {
        Args: { p_academy: string; p_n: number; p_profile: string }
        Returns: undefined
      }
      translations_for: {
        Args: { p_lang: string; p_message_ids: string[] }
        Returns: Json
      }
      trial_board: { Args: { p_program: string }; Returns: Json }
      trial_offers: { Args: { p_program: string }; Returns: Json }
      two_step_forget_devices: { Args: never; Returns: number }
      two_step_needed: { Args: never; Returns: boolean }
      two_step_pass: {
        Args: {
          p_device?: string
          p_label?: string
          p_profile: string
          p_session: string
          p_trust?: boolean
        }
        Returns: Json
      }
      two_step_status: { Args: never; Returns: Json }
      two_step_trust_this_session: { Args: { p_device: string }; Returns: Json }
      undo_import_batch: { Args: { p_batch: string }; Returns: Json }
      undo_last_tick: { Args: { p_event: string }; Returns: Json }
      undo_levy_payment: { Args: { p_payment: string }; Returns: Json }
      undo_referee_allocation: { Args: { p_batch: string }; Returns: Json }
      venue_layout: { Args: { p_venue: string }; Returns: Json }
      void_referee_run: { Args: { p_run: string }; Returns: undefined }
      volunteer_gaps: { Args: { p_academy: string }; Returns: Json }
      vote_player_of_match: {
        Args: { p_event: string; p_player: string }
        Returns: Json
      }
      welfare_contacts: { Args: { p_academy: string }; Returns: Json }
      whats_on: {
        Args: { p_academy: string; p_date: string }
        Returns: {
          cancelled: boolean
          event_id: string
          started: boolean
          starts_at: string
          team_name: string
          title: string
          type: Database["public"]["Enums"]["event_type"]
          venue: string
        }[]
      }
      who_hasnt_answered: {
        Args: { p_event: string }
        Returns: {
          guardian_id: string
          guardian_name: string
          guardian_phone: string
          player_id: string
          player_name: string
        }[]
      }
      withdraw_appointment: {
        Args: { p_appointment: string; p_note?: string }
        Returns: undefined
      }
      withdraw_fixture_change: {
        Args: { p_request: string }
        Returns: undefined
      }
      withdraw_forfeit_request: {
        Args: { p_request: string }
        Returns: undefined
      }
      withdraw_registration: {
        Args: { p_reason?: string; p_registration: string }
        Returns: Json
      }
      write_player_report: {
        Args: {
          p_body: string
          p_kind: string
          p_player: string
          p_ratings?: Json
          p_share?: boolean
          p_term?: string
        }
        Returns: string
      }
      zone_time: { Args: { p_zone: string }; Returns: string }
    }
    Enums: {
      academy_role: "owner" | "admin" | "coach" | "parent" | "player"
      appointment_status: "offered" | "accepted" | "declined" | "withdrawn"
      attendance_status: "present" | "absent" | "late" | "excused"
      change_request_status:
        | "proposed"
        | "agreed"
        | "declined"
        | "approved"
        | "rejected"
        | "withdrawn"
      channel_member_role: "host" | "co_host" | "member"
      channel_status: "active" | "archived"
      channel_type:
        | "team"
        | "age_group"
        | "coaches"
        | "academy_wide"
        | "direct"
        | "custom"
        | "notices"
        | "clubs"
        | "referees"
        | "stream"
        | "committee"
        | "managers"
      clearance_kind: "wwcc" | "exemption"
      clearance_outcome: "cleared" | "applied" | "barred" | "not_found"
      club_role:
        | "president"
        | "secretary"
        | "registrar"
        | "treasurer"
        | "coordinator"
        | "team_manager"
        | "welfare_officer"
        | "volunteer_coordinator"
      competition_mode: "managed" | "comms_only"
      competition_type:
        | "season"
        | "tournament"
        | "gala_day"
        | "friendly_series"
        | "other"
      concussion_status: "active" | "clearance_submitted" | "cleared"
      conduct_category:
        | "disclosure"
        | "allegation"
        | "concern"
        | "boundary_breach"
        | "other"
      conduct_status: "open" | "referred" | "closed"
      consent_kind:
        | "code_of_conduct"
        | "photo_media"
        | "medical_treatment"
        | "transport"
        | "privacy"
        | "terms"
        | "other"
      directory_visibility: "staff_only" | "all"
      dm_policy: "staff_only" | "open"
      entry_fee_status: "owed" | "paid" | "waived"
      event_type: "match" | "training" | "social" | "other" | "tournament"
      fixture_status:
        | "scheduled"
        | "in_progress"
        | "final"
        | "forfeit"
        | "bye"
        | "postponed"
        | "cancelled"
      invite_status: "pending" | "accepted" | "declined" | "revoked" | "expired"
      join_request_status: "pending" | "approved" | "declined" | "expired"
      kit_size:
        | "4"
        | "6"
        | "8"
        | "10"
        | "12"
        | "14"
        | "16"
        | "YXS"
        | "YS"
        | "YM"
        | "YL"
        | "S"
        | "M"
        | "L"
        | "XL"
        | "2XL"
        | "3XL"
      league_role:
        | "competition_manager"
        | "referee_coordinator"
        | "discipline_officer"
        | "ground_manager"
      lineup_role: "starting" | "bench" | "out"
      match_event_kind:
        | "goal"
        | "assist"
        | "yellow"
        | "red"
        | "blue"
        | "sub_on"
        | "sub_off"
        | "own_goal"
      member_status: "invited" | "active" | "removed"
      message_status: "published" | "pending" | "rejected" | "scheduled"
      offer_status: "open" | "accepted" | "declined"
      official_rego_status:
        | "unknown"
        | "pending"
        | "registered"
        | "not_required"
      org_type: "academy" | "club" | "league" | "school" | "other"
      payment_item_status: "pending" | "paid" | "void"
      payment_run_status: "draft" | "paid"
      player_gender: "female" | "male" | "other"
      poll_type: "simple" | "availability"
      posting_mode: "open" | "hosts_only" | "replies_only"
      program_kind:
        | "squad"
        | "development"
        | "trial"
        | "camp"
        | "term_class"
        | "tournament"
        | "tour"
        | "other"
      program_status: "draft" | "open" | "closed"
      public_names_mode: "off" | "initials" | "full"
      referee_role: "referee" | "assistant" | "fourth"
      refund_status: "requested" | "issued" | "failed" | "declined"
      registration_status:
        | "pending"
        | "approved"
        | "rejected"
        | "waitlisted"
        | "withdrawn"
      report_reason:
        | "inappropriate"
        | "bullying"
        | "safeguarding"
        | "spam"
        | "wrong_channel"
        | "other"
      report_status: "open" | "actioned" | "dismissed"
      rsvp_status: "yes" | "no" | "maybe"
      sheet_status: "submitted" | "confirmed" | "disputed"
      sock_size: "K9-12" | "K13-3" | "2-7" | "7-11" | "11-14"
      suspension_status: "active" | "served" | "overturned"
      team_gender: "boys" | "girls" | "mixed" | "men" | "women"
      team_status: "active" | "ended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      academy_role: ["owner", "admin", "coach", "parent", "player"],
      appointment_status: ["offered", "accepted", "declined", "withdrawn"],
      attendance_status: ["present", "absent", "late", "excused"],
      change_request_status: [
        "proposed",
        "agreed",
        "declined",
        "approved",
        "rejected",
        "withdrawn",
      ],
      channel_member_role: ["host", "co_host", "member"],
      channel_status: ["active", "archived"],
      channel_type: [
        "team",
        "age_group",
        "coaches",
        "academy_wide",
        "direct",
        "custom",
        "notices",
        "clubs",
        "referees",
        "stream",
        "committee",
        "managers",
      ],
      clearance_kind: ["wwcc", "exemption"],
      clearance_outcome: ["cleared", "applied", "barred", "not_found"],
      club_role: [
        "president",
        "secretary",
        "registrar",
        "treasurer",
        "coordinator",
        "team_manager",
        "welfare_officer",
        "volunteer_coordinator",
      ],
      competition_mode: ["managed", "comms_only"],
      competition_type: [
        "season",
        "tournament",
        "gala_day",
        "friendly_series",
        "other",
      ],
      concussion_status: ["active", "clearance_submitted", "cleared"],
      conduct_category: [
        "disclosure",
        "allegation",
        "concern",
        "boundary_breach",
        "other",
      ],
      conduct_status: ["open", "referred", "closed"],
      consent_kind: [
        "code_of_conduct",
        "photo_media",
        "medical_treatment",
        "transport",
        "privacy",
        "terms",
        "other",
      ],
      directory_visibility: ["staff_only", "all"],
      dm_policy: ["staff_only", "open"],
      entry_fee_status: ["owed", "paid", "waived"],
      event_type: ["match", "training", "social", "other", "tournament"],
      fixture_status: [
        "scheduled",
        "in_progress",
        "final",
        "forfeit",
        "bye",
        "postponed",
        "cancelled",
      ],
      invite_status: ["pending", "accepted", "declined", "revoked", "expired"],
      join_request_status: ["pending", "approved", "declined", "expired"],
      kit_size: [
        "4",
        "6",
        "8",
        "10",
        "12",
        "14",
        "16",
        "YXS",
        "YS",
        "YM",
        "YL",
        "S",
        "M",
        "L",
        "XL",
        "2XL",
        "3XL",
      ],
      league_role: [
        "competition_manager",
        "referee_coordinator",
        "discipline_officer",
        "ground_manager",
      ],
      lineup_role: ["starting", "bench", "out"],
      match_event_kind: [
        "goal",
        "assist",
        "yellow",
        "red",
        "blue",
        "sub_on",
        "sub_off",
        "own_goal",
      ],
      member_status: ["invited", "active", "removed"],
      message_status: ["published", "pending", "rejected", "scheduled"],
      offer_status: ["open", "accepted", "declined"],
      official_rego_status: [
        "unknown",
        "pending",
        "registered",
        "not_required",
      ],
      org_type: ["academy", "club", "league", "school", "other"],
      payment_item_status: ["pending", "paid", "void"],
      payment_run_status: ["draft", "paid"],
      player_gender: ["female", "male", "other"],
      poll_type: ["simple", "availability"],
      posting_mode: ["open", "hosts_only", "replies_only"],
      program_kind: [
        "squad",
        "development",
        "trial",
        "camp",
        "term_class",
        "tournament",
        "tour",
        "other",
      ],
      program_status: ["draft", "open", "closed"],
      public_names_mode: ["off", "initials", "full"],
      referee_role: ["referee", "assistant", "fourth"],
      refund_status: ["requested", "issued", "failed", "declined"],
      registration_status: [
        "pending",
        "approved",
        "rejected",
        "waitlisted",
        "withdrawn",
      ],
      report_reason: [
        "inappropriate",
        "bullying",
        "safeguarding",
        "spam",
        "wrong_channel",
        "other",
      ],
      report_status: ["open", "actioned", "dismissed"],
      rsvp_status: ["yes", "no", "maybe"],
      sheet_status: ["submitted", "confirmed", "disputed"],
      sock_size: ["K9-12", "K13-3", "2-7", "7-11", "11-14"],
      suspension_status: ["active", "served", "overturned"],
      team_gender: ["boys", "girls", "mixed", "men", "women"],
      team_status: ["active", "ended"],
    },
  },
} as const
