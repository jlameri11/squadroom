// database.types.ts — generated from squadroom-dev. Do not edit by hand.
//
// Regenerate after every migration:
//   npm run types
//
// If it drifts from the database, TypeScript will happily agree with the
// stale version, which is worse than having no types at all.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academies: {
        Row: {
          created_at: string
          created_by: string | null
          directory_visibility: Database["public"]["Enums"]["directory_visibility"]
          dm_policy: Database["public"]["Enums"]["dm_policy"]
          id: string
          logo_url: string | null
          name: string
          plan: string
          primary_colour: string
          slug: string
          timezone: string
          type: Database["public"]["Enums"]["org_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          directory_visibility?: Database["public"]["Enums"]["directory_visibility"]
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          id?: string
          logo_url?: string | null
          name: string
          plan?: string
          primary_colour?: string
          slug: string
          timezone?: string
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          directory_visibility?: Database["public"]["Enums"]["directory_visibility"]
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          id?: string
          logo_url?: string | null
          name?: string
          plan?: string
          primary_colour?: string
          slug?: string
          timezone?: string
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
          team_id: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at: string
        }
        Insert: {
          academy_id: string
          age_group?: string | null
          archived_at?: string | null
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
          team_id?: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Update: {
          academy_id?: string
          age_group?: string | null
          archived_at?: string | null
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
            foreignKeyName: "channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      competition_entries: {
        Row: {
          academy_id: string | null
          competition_id: string
          created_at: string
          display_name: string
          division: string
          group_label: string | null
          id: string
          seed: number | null
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
          seed?: number | null
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
          seed?: number | null
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
      competitions: {
        Row: {
          created_at: string
          created_by: string | null
          ends_on: string | null
          id: string
          name: string
          notes: string | null
          organiser: string | null
          organiser_id: string
          season: string | null
          starts_on: string | null
          status: Database["public"]["Enums"]["team_status"]
          type: Database["public"]["Enums"]["competition_type"]
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          id?: string
          name: string
          notes?: string | null
          organiser?: string | null
          organiser_id: string
          season?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["team_status"]
          type?: Database["public"]["Enums"]["competition_type"]
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          id?: string
          name?: string
          notes?: string | null
          organiser?: string | null
          organiser_id?: string
          season?: string | null
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
      events: {
        Row: {
          academy_id: string
          address: string | null
          arrive_at: string | null
          cancelled_at: string | null
          competition_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          fixture_id: string | null
          id: string
          kit_colour: string | null
          notes: string | null
          opponent: string | null
          round: string | null
          starts_at: string
          team_id: string | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
          updated_at: string
          venue: string | null
        }
        Insert: {
          academy_id: string
          address?: string | null
          arrive_at?: string | null
          cancelled_at?: string | null
          competition_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          fixture_id?: string | null
          id?: string
          kit_colour?: string | null
          notes?: string | null
          opponent?: string | null
          round?: string | null
          starts_at: string
          team_id?: string | null
          title: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
          venue?: string | null
        }
        Update: {
          academy_id?: string
          address?: string | null
          arrive_at?: string | null
          cancelled_at?: string | null
          competition_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          fixture_id?: string | null
          id?: string
          kit_colour?: string | null
          notes?: string | null
          opponent?: string | null
          round?: string | null
          starts_at?: string
          team_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
          venue?: string | null
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
            foreignKeyName: "events_team_fkey"
            columns: ["team_id", "academy_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "academy_id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_entry_id: string | null
          away_score: number | null
          competition_id: string
          created_at: string
          division: string
          duration_mins: number | null
          field_label: string | null
          group_label: string | null
          home_entry_id: string | null
          home_score: number | null
          id: string
          notes: string | null
          round: string | null
          score_entered_at: string | null
          score_entered_by: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["fixture_status"]
          updated_at: string
          venue_id: string | null
          venue_label: string | null
        }
        Insert: {
          away_entry_id?: string | null
          away_score?: number | null
          competition_id: string
          created_at?: string
          division: string
          duration_mins?: number | null
          field_label?: string | null
          group_label?: string | null
          home_entry_id?: string | null
          home_score?: number | null
          id?: string
          notes?: string | null
          round?: string | null
          score_entered_at?: string | null
          score_entered_by?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["fixture_status"]
          updated_at?: string
          venue_id?: string | null
          venue_label?: string | null
        }
        Update: {
          away_entry_id?: string | null
          away_score?: number | null
          competition_id?: string
          created_at?: string
          division?: string
          duration_mins?: number | null
          field_label?: string | null
          group_label?: string | null
          home_entry_id?: string | null
          home_score?: number | null
          id?: string
          notes?: string | null
          round?: string | null
          score_entered_at?: string | null
          score_entered_by?: string | null
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
            foreignKeyName: "fixtures_home_entry_id_fkey"
            columns: ["home_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
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
          children_names: string[]
          claimed_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          expires_at: string
          full_name: string
          id: string
          join_link_id: string | null
          message: string | null
          phone: string | null
          profile_id: string | null
          secret_hash: string
          status: Database["public"]["Enums"]["join_request_status"]
          team_id: string | null
        }
        Insert: {
          academy_id: string
          children_names?: string[]
          claimed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string
          full_name: string
          id?: string
          join_link_id?: string | null
          message?: string | null
          phone?: string | null
          profile_id?: string | null
          secret_hash: string
          status?: Database["public"]["Enums"]["join_request_status"]
          team_id?: string | null
        }
        Update: {
          academy_id?: string
          children_names?: string[]
          claimed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string
          full_name?: string
          id?: string
          join_link_id?: string | null
          message?: string | null
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
      messages: {
        Row: {
          academy_id: string
          approved_at: string | null
          approved_by: string | null
          attachments: Json
          body: string | null
          channel_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          id: string
          is_announcement: boolean
          pinned_at: string | null
          pinned_by: string | null
          reply_to_id: string | null
          sender_id: string | null
          status: Database["public"]["Enums"]["message_status"]
        }
        Insert: {
          academy_id: string
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          body?: string | null
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          is_announcement?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          reply_to_id?: string | null
          sender_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
        }
        Update: {
          academy_id?: string
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          body?: string | null
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          is_announcement?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          reply_to_id?: string | null
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
            foreignKeyName: "messages_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      notification_queue: {
        Row: {
          academy_id: string
          attempts: number
          body: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          last_error: string | null
          payload: Json
          profile_id: string
          scheduled_for: string
          sent_at: string | null
          title: string
          url: string | null
        }
        Insert: {
          academy_id: string
          attempts?: number
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind: string
          last_error?: string | null
          payload?: Json
          profile_id: string
          scheduled_for?: string
          sent_at?: string | null
          title: string
          url?: string | null
        }
        Update: {
          academy_id?: string
          attempts?: number
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          payload?: Json
          profile_id?: string
          scheduled_for?: string
          sent_at?: string | null
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
      players: {
        Row: {
          academy_id: string
          created_at: string
          dob: string | null
          full_name: string
          id: string
          notes: string | null
          profile_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          dob?: string | null
          full_name: string
          id?: string
          notes?: string | null
          profile_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          dob?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          profile_id?: string | null
          team_id?: string | null
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
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
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          name: string
          season: string
          status: Database["public"]["Enums"]["team_status"]
          updated_at: string
        }
        Insert: {
          academy_id: string
          age_group: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          name: string
          season?: string
          status?: Database["public"]["Enums"]["team_status"]
          updated_at?: string
        }
        Update: {
          academy_id?: string
          age_group?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          name?: string
          season?: string
          status?: Database["public"]["Enums"]["team_status"]
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
        ]
      }
      user_settings: {
        Row: {
          compact_lists: boolean
          created_at: string
          home_order: string
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
          home_order?: string
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
          home_order?: string
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
          created_at: string
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          academy_id: string
          address?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          academy_id?: string
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      add_to_channel: {
        Args: {
          p_channel: string
          p_profile: string
          p_role?: Database["public"]["Enums"]["channel_member_role"]
        }
        Returns: undefined
      }
      check_join_rate: {
        Args: { p_ip_hash: string; p_link: string }
        Returns: boolean
      }
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
      create_academy: {
        Args: {
          p_colour?: string
          p_name: string
          p_timezone?: string
          p_type?: Database["public"]["Enums"]["org_type"]
        }
        Returns: string
      }
      ensure_system_channel: {
        Args: {
          p_academy: string
          p_age_group?: string
          p_name?: string
          p_type: Database["public"]["Enums"]["channel_type"]
        }
        Returns: string
      }
      expire_stale_join_requests: { Args: never; Returns: number }
      get_reaction_voters: {
        Args: { p_emoji: string; p_message: string }
        Returns: {
          avatar_url: string
          full_name: string
          profile_id: string
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
      normalise_phone: { Args: { p_phone: string }; Returns: string }
      poll_counts: {
        Args: { p_poll: string }
        Returns: {
          option_id: string
          votes: number
        }[]
      }
      purge_expired_message_archive: { Args: never; Returns: number }
      reaction_counts: {
        Args: { p_message_ids: string[] }
        Returns: {
          emoji: string
          message_id: string
          reacted_by_me: boolean
          reaction_count: number
        }[]
      }
      revoke_member_tree: {
        Args: { p_academy: string; p_profile: string }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      academy_role: "owner" | "admin" | "coach" | "parent" | "player"
      channel_member_role: "host" | "co_host" | "member"
      channel_status: "active" | "archived"
      channel_type: "team" | "age_group" | "coaches" | "academy_wide" | "direct"
      competition_type:
        | "season"
        | "tournament"
        | "gala_day"
        | "friendly_series"
        | "other"
      directory_visibility: "staff_only" | "all"
      dm_policy: "staff_only" | "open"
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
      member_status: "invited" | "active" | "removed"
      message_status: "published" | "pending" | "rejected"
      org_type: "academy" | "club" | "league" | "school" | "other"
      poll_type: "simple" | "availability"
      posting_mode: "open" | "hosts_only" | "replies_only"
      rsvp_status: "yes" | "no" | "maybe"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      channel_member_role: ["host", "co_host", "member"],
      channel_status: ["active", "archived"],
      channel_type: ["team", "age_group", "coaches", "academy_wide", "direct"],
      competition_type: [
        "season",
        "tournament",
        "gala_day",
        "friendly_series",
        "other",
      ],
      directory_visibility: ["staff_only", "all"],
      dm_policy: ["staff_only", "open"],
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
      member_status: ["invited", "active", "removed"],
      message_status: ["published", "pending", "rejected"],
      org_type: ["academy", "club", "league", "school", "other"],
      poll_type: ["simple", "availability"],
      posting_mode: ["open", "hosts_only", "replies_only"],
      rsvp_status: ["yes", "no", "maybe"],
      team_status: ["active", "ended"],
    },
  },
} as const
