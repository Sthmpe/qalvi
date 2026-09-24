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
      conversations: {
        Row: {
          consent_version: string | null
          consented_at: string | null
          created_at: string
          ended_at: string | null
          id: string
          interrupted_at: string | null
          interviewer_metadata: Json
          livekit_room: string | null
          next_message_sequence: number
          participant_id: string
          started_at: string
          status: string
          study_id: string
          updated_at: string
          workspace_id: string
          writer_generation: number
        }
        Insert: {
          consent_version?: string | null
          consented_at?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          interrupted_at?: string | null
          interviewer_metadata?: Json
          livekit_room?: string | null
          next_message_sequence?: number
          participant_id: string
          started_at?: string
          status?: string
          study_id: string
          updated_at?: string
          workspace_id: string
          writer_generation?: number
        }
        Update: {
          consent_version?: string | null
          consented_at?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          interrupted_at?: string | null
          interviewer_metadata?: Json
          livekit_room?: string | null
          next_message_sequence?: number
          participant_id?: string
          started_at?: string
          status?: string
          study_id?: string
          updated_at?: string
          workspace_id?: string
          writer_generation?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_participant_id_study_id_workspace_id_fkey"
            columns: ["participant_id", "study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "study_id", "workspace_id"]
          },
        ]
      }
      finding_evidence: {
        Row: {
          created_at: string
          created_by: string | null
          finding_id: string
          message_id: string
          note: string | null
          relation: string
          study_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          finding_id: string
          message_id: string
          note?: string | null
          relation?: string
          study_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          finding_id?: string
          message_id?: string
          note?: string | null
          relation?: string
          study_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finding_evidence_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_evidence_finding_id_study_id_workspace_id_fkey"
            columns: ["finding_id", "study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["id", "study_id", "workspace_id"]
          },
          {
            foreignKeyName: "finding_evidence_message_id_study_id_workspace_id_fkey"
            columns: ["message_id", "study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "study_id", "workspace_id"]
          },
        ]
      }
      findings: {
        Row: {
          ai_metadata: Json | null
          category: string
          created_at: string
          created_by: string | null
          id: string
          origin: string
          status: string
          study_id: string
          summary: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_metadata?: Json | null
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          origin?: string
          status?: string
          study_id: string
          summary?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_metadata?: Json | null
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          origin?: string
          status?: string
          study_id?: string
          summary?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "findings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_study_id_workspace_id_fkey"
            columns: ["study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      interview_invitations: {
        Row: {
          claimed_at: string | null
          conversation_id: string | null
          created_at: string
          expires_at: string
          id: string
          issued_by: string
          revoked_at: string | null
          study_id: string
          token_hash: string
          workspace_id: string
        }
        Insert: {
          claimed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_by: string
          revoked_at?: string | null
          study_id: string
          token_hash: string
          workspace_id: string
        }
        Update: {
          claimed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_by?: string
          revoked_at?: string | null
          study_id?: string
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_invitations_conversation_id_study_id_workspace_i_fkey"
            columns: ["conversation_id", "study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "study_id", "workspace_id"]
          },
          {
            foreignKeyName: "interview_invitations_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_invitations_study_id_workspace_id_fkey"
            columns: ["study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      interview_resumes: {
        Row: {
          conversation_id: string
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_resumes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          channel: string
          content: string
          content_search: unknown
          conversation_id: string
          created_at: string
          id: string
          interrupted: boolean
          occurred_at: string
          sequence: number
          speaker: string
          study_id: string
          transport_segment_id: string
          workspace_id: string
        }
        Insert: {
          channel: string
          content: string
          content_search?: unknown
          conversation_id: string
          created_at?: string
          id?: string
          interrupted?: boolean
          occurred_at: string
          sequence: number
          speaker: string
          study_id: string
          transport_segment_id: string
          workspace_id: string
        }
        Update: {
          channel?: string
          content?: string
          content_search?: unknown
          conversation_id?: string
          created_at?: string
          id?: string
          interrupted?: boolean
          occurred_at?: string
          sequence?: number
          speaker?: string
          study_id?: string
          transport_segment_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_study_id_workspace_id_fkey"
            columns: ["conversation_id", "study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "study_id", "workspace_id"]
          },
        ]
      }
      participants: {
        Row: {
          alias: string
          created_at: string
          id: string
          segment: string | null
          study_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          segment?: string | null
          study_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          segment?: string | null
          study_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_study_id_workspace_id_fkey"
            columns: ["study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      studies: {
        Row: {
          audience: string | null
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          research_goal: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          audience?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          research_goal?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          audience?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          research_goal?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "studies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_displays: {
        Row: {
          action_id: string
          conversation_id: string
          created_at: string
          definition: Json
          id: string
          issued_at: string
          prompt: string
          rendered_at: string | null
          study_id: string
          visual_type: string
          workspace_id: string
        }
        Insert: {
          action_id: string
          conversation_id: string
          created_at?: string
          definition: Json
          id?: string
          issued_at: string
          prompt: string
          rendered_at?: string | null
          study_id: string
          visual_type: string
          workspace_id: string
        }
        Update: {
          action_id?: string
          conversation_id?: string
          created_at?: string
          definition?: Json
          id?: string
          issued_at?: string
          prompt?: string
          rendered_at?: string | null
          study_id?: string
          visual_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visual_displays_conversation_id_study_id_workspace_id_fkey"
            columns: ["conversation_id", "study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "study_id", "workspace_id"]
          },
        ]
      }
      visual_responses: {
        Row: {
          conversation_id: string
          created_at: string
          display_id: string
          id: string
          message_channel: string
          message_id: string
          numeric_value: number | null
          selected_option_ids: string[]
          study_id: string
          visual_type: string
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          display_id: string
          id?: string
          message_channel?: string
          message_id: string
          numeric_value?: number | null
          selected_option_ids?: string[]
          study_id: string
          visual_type: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          display_id?: string
          id?: string
          message_channel?: string
          message_id?: string
          numeric_value?: number | null
          selected_option_ids?: string[]
          study_id?: string
          visual_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visual_responses_conversation_id_study_id_workspace_id_fkey"
            columns: ["conversation_id", "study_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "study_id", "workspace_id"]
          },
          {
            foreignKeyName: "visual_responses_display_id_conversation_id_visual_type_fkey"
            columns: ["display_id", "conversation_id", "visual_type"]
            isOneToOne: false
            referencedRelation: "visual_displays"
            referencedColumns: ["id", "conversation_id", "visual_type"]
          },
          {
            foreignKeyName: "visual_responses_message_id_conversation_id_message_channe_fkey"
            columns: ["message_id", "conversation_id", "message_channel"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "conversation_id", "channel"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_interview_visual: {
        Args: {
          p_action_id: string
          p_conversation_id: string
          p_writer_generation: number
        }
        Returns: string
      }
      append_interview_message: {
        Args: {
          p_channel: string
          p_content: string
          p_conversation_id: string
          p_event_key: string
          p_interrupted?: boolean
          p_occurred_at: string
          p_speaker: string
          p_writer_generation: number
        }
        Returns: {
          inserted: boolean
          message_id: string
          message_sequence: number
        }[]
      }
      append_interview_visual_response: {
        Args: {
          p_action_id: string
          p_content: string
          p_conversation_id: string
          p_event_key: string
          p_numeric_value?: number
          p_occurred_at: string
          p_selected_option_ids?: string[]
          p_writer_generation: number
        }
        Returns: {
          inserted: boolean
          message_id: string
          message_sequence: number
        }[]
      }
      claim_conversation_writer: {
        Args: { p_conversation_id: string; p_livekit_room: string }
        Returns: number
      }
      claim_interview_invitation: {
        Args: {
          p_consent_version: string
          p_invitation_hash: string
          p_livekit_room: string
          p_resume_hash: string
        }
        Returns: string
      }
      create_finding: {
        Args: {
          finding_category: string
          finding_summary: string
          finding_title: string
          supporting_message_ids: string[]
          target_study: string
        }
        Returns: string
      }
      create_workspace: { Args: { workspace_name: string }; Returns: string }
      issue_interview_visual: {
        Args: {
          p_conversation_id: string
          p_definition: Json
          p_writer_generation: number
        }
        Returns: string
      }
      resolve_interview_resume: {
        Args: { p_resume_hash: string }
        Returns: string
      }
      transition_interview_conversation: {
        Args: {
          p_conversation_id: string
          p_next_status: string
          p_writer_generation: number
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
