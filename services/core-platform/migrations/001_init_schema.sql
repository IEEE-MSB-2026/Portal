-- ============================================================================
-- Migration: 001_init_schema.sql
-- Description: Consolidated Canonical Database Schema for IEEE Menoufia Student Branch Portal
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: hr_application_stage_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.hr_application_stage_type AS ENUM (
    'applied',
    'screening',
    'interview',
    'final_review',
    'accepted',
    'rejected'
);


--
-- Name: hr_campaign_status_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.hr_campaign_status_type AS ENUM (
    'draft',
    'open',
    'closed'
);


--
-- Name: hr_onboarding_item_status_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.hr_onboarding_item_status_type AS ENUM (
    'todo',
    'in_progress',
    'done'
);


--
-- Name: media_album_status_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_album_status_type AS ENUM (
    'draft',
    'published'
);


--
-- Name: media_coverage_status_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_coverage_status_type AS ENUM (
    'requested',
    'accepted',
    'completed',
    'cancelled'
);


--
-- Name: pr_announcement_category_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pr_announcement_category_type AS ENUM (
    'General',
    'Technical',
    'Event',
    'Recruitment',
    'Opportunity'
);


--
-- Name: pr_announcement_visibility_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pr_announcement_visibility_type AS ENUM (
    'public',
    'internal'
);


--
-- Name: pr_campaign_status_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pr_campaign_status_type AS ENUM (
    'draft',
    'scheduled',
    'sending',
    'sent',
    'failed',
    'archived'
);


--
-- Name: role_in_committee_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_in_committee_type AS ENUM (
    'member',
    'lead',
    'hr'
);


--
-- Name: task_activity_action_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_activity_action_type AS ENUM (
    'created',
    'assigned',
    'status_changed'
);


--
-- Name: task_status_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status_type AS ENUM (
    'todo',
    'in_progress',
    'done'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assignment_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignment_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    file_url text NOT NULL,
    file_name text,
    notes text,
    status character varying(30) DEFAULT 'submitted'::character varying NOT NULL,
    grade integer,
    feedback text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    family_id uuid NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: auth_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    scope_type text NOT NULL,
    scope_id text NOT NULL,
    committee_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: branch_excom_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_excom_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    "position" text NOT NULL,
    custom_title text,
    season text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    appointed_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: branch_governance_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_governance_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    file_url text NOT NULL,
    file_size_bytes bigint,
    tag text,
    description text,
    uploaded_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: branch_officers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_officers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    season text NOT NULL,
    is_current_season boolean DEFAULT false NOT NULL,
    avatar_url text,
    linkedin_url text,
    email text,
    bio text,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: committee_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    target_user_id uuid,
    activity_type character varying(50) NOT NULL,
    title text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: committee_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_by_user_id uuid NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: committee_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    due_date timestamp with time zone,
    max_points integer DEFAULT 100 NOT NULL,
    attachment_url text,
    attachment_name text,
    created_by_user_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: committee_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_in_committee public.role_in_committee_type NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: committee_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    resource_type text DEFAULT 'link'::text NOT NULL,
    description text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: committees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committees (
    id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: file_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cloudinary_asset_id text,
    cloudinary_public_id text NOT NULL,
    secure_url text NOT NULL,
    resource_type text DEFAULT 'image'::text NOT NULL,
    format text,
    bytes bigint,
    purpose text DEFAULT 'general'::text NOT NULL,
    owner_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_message text,
    processed_at timestamp with time zone
);


--
-- Name: hr_application_stage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_application_stage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    from_stage public.hr_application_stage_type,
    to_stage public.hr_application_stage_type NOT NULL,
    score integer,
    notes text,
    actor_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hr_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    applicant_user_id uuid NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    current_stage public.hr_application_stage_type DEFAULT 'applied'::public.hr_application_stage_type NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    committee_id uuid,
    welcome_email_sent boolean DEFAULT false NOT NULL,
    welcome_email_sent_at timestamp with time zone
);


--
-- Name: hr_campaign_committees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_campaign_committees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    committee_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hr_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid,
    title text NOT NULL,
    description text,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    status public.hr_campaign_status_type DEFAULT 'draft'::public.hr_campaign_status_type NOT NULL,
    form_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hr_onboarding_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_onboarding_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    committee_id uuid NOT NULL,
    assignee_user_id uuid NOT NULL,
    template_key text NOT NULL,
    title text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status public.hr_onboarding_item_status_type DEFAULT 'todo'::public.hr_onboarding_item_status_type NOT NULL,
    completed_at timestamp with time zone,
    completed_by_user_id uuid,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_album_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_album_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    album_id uuid NOT NULL,
    asset_url text NOT NULL,
    asset_type text DEFAULT 'image'::text NOT NULL,
    caption text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_albums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_albums (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid,
    title text NOT NULL,
    description text,
    cover_image_url text,
    status public.media_album_status_type DEFAULT 'draft'::public.media_album_status_type NOT NULL,
    published_at timestamp with time zone,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    event_date timestamp with time zone,
    category text DEFAULT 'General'::text,
    tags text[] DEFAULT '{}'::text[]
);


--
-- Name: media_brand_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_brand_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    category text DEFAULT 'logos'::text NOT NULL,
    file_url text NOT NULL,
    thumbnail_url text,
    file_format text,
    file_size_bytes bigint DEFAULT 0 NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_coverage_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_coverage_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coverage_request_id uuid NOT NULL,
    action text NOT NULL,
    actor_user_id uuid NOT NULL,
    from_status public.media_coverage_status_type,
    to_status public.media_coverage_status_type,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_coverage_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_coverage_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid NOT NULL,
    media_committee_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    event_at timestamp with time zone NOT NULL,
    status public.media_coverage_status_type DEFAULT 'requested'::public.media_coverage_status_type NOT NULL,
    requested_by_user_id uuid NOT NULL,
    accepted_by_user_id uuid,
    linked_task_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_reset_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    otp_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    is_used boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pr_announcement_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pr_announcement_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    announcement_id uuid NOT NULL,
    action text NOT NULL,
    actor_user_id uuid NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pr_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pr_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    category public.pr_announcement_category_type DEFAULT 'General'::public.pr_announcement_category_type NOT NULL,
    visibility public.pr_announcement_visibility_type DEFAULT 'public'::public.pr_announcement_visibility_type NOT NULL,
    image_url text,
    is_pinned boolean DEFAULT false NOT NULL,
    author_name text DEFAULT 'Branch Executive Board'::text NOT NULL,
    author_user_id uuid NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    deleted_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: pr_campaign_dispatch_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pr_campaign_dispatch_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    dispatch_request_id uuid NOT NULL,
    status text NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    logs jsonb DEFAULT '[]'::jsonb
);


--
-- Name: pr_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pr_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid,
    title text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    segment_type text DEFAULT 'all_members'::text NOT NULL,
    status public.pr_campaign_status_type DEFAULT 'draft'::public.pr_campaign_status_type NOT NULL,
    scheduled_for timestamp with time zone,
    dispatch_request_id uuid,
    recipient_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    last_error text,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    failed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    recipient_user_ids jsonb DEFAULT '[]'::jsonb,
    custom_recipients jsonb DEFAULT '[]'::jsonb
);


--
-- Name: task_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action public.task_activity_action_type NOT NULL,
    from_status public.task_status_type,
    to_status public.task_status_type,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_activity_log; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.task_activity_log AS
 SELECT id,
    task_id,
    actor_user_id AS actor_user_ref_id,
    action,
    from_status,
    to_status,
    details,
    created_at
   FROM public.task_activities;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    committee_id uuid,
    title text NOT NULL,
    description text,
    status public.task_status_type DEFAULT 'todo'::public.task_status_type NOT NULL,
    created_by_user_id uuid NOT NULL,
    assignee_user_id uuid,
    due_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    is_board_task boolean DEFAULT false NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    name text NOT NULL,
    membership_id text,
    avatar_url text,
    cloudinary_public_id text,
    cloudinary_asset_id text,
    default_role text,
    default_scope_type text,
    default_scope_id text,
    bio text,
    university text,
    faculty text,
    department text,
    academic_year text,
    phone text,
    social_links jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_email_verified boolean DEFAULT false NOT NULL,
    email_verification_token_hash text,
    email_verification_expires_at timestamp with time zone,
    email_verification_sent_at timestamp with time zone,
    google_id text,
    auth_provider text DEFAULT 'local'::text NOT NULL
);


--
-- Name: assignment_submissions assignment_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_pkey PRIMARY KEY (id);


--
-- Name: auth_refresh_tokens auth_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_tokens
    ADD CONSTRAINT auth_refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: auth_refresh_tokens auth_refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_tokens
    ADD CONSTRAINT auth_refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_user_roles auth_user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_user_roles
    ADD CONSTRAINT auth_user_roles_pkey PRIMARY KEY (id);


--
-- Name: auth_user_roles auth_user_roles_user_id_role_scope_type_scope_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_user_roles
    ADD CONSTRAINT auth_user_roles_user_id_role_scope_type_scope_id_key UNIQUE (user_id, role, scope_type, scope_id);


--
-- Name: branch_excom_members branch_excom_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_excom_members
    ADD CONSTRAINT branch_excom_members_pkey PRIMARY KEY (id);


--
-- Name: branch_excom_members branch_excom_members_user_id_season_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_excom_members
    ADD CONSTRAINT branch_excom_members_user_id_season_key UNIQUE (user_id, season);


--
-- Name: branch_governance_documents branch_governance_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_governance_documents
    ADD CONSTRAINT branch_governance_documents_pkey PRIMARY KEY (id);


--
-- Name: branch_officers branch_officers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_officers
    ADD CONSTRAINT branch_officers_pkey PRIMARY KEY (id);


--
-- Name: committee_activities committee_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_activities
    ADD CONSTRAINT committee_activities_pkey PRIMARY KEY (id);


--
-- Name: committee_announcements committee_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_announcements
    ADD CONSTRAINT committee_announcements_pkey PRIMARY KEY (id);


--
-- Name: committee_assignments committee_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_assignments
    ADD CONSTRAINT committee_assignments_pkey PRIMARY KEY (id);


--
-- Name: committee_memberships committee_memberships_committee_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_memberships
    ADD CONSTRAINT committee_memberships_committee_id_user_id_key UNIQUE (committee_id, user_id);


--
-- Name: committee_memberships committee_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_memberships
    ADD CONSTRAINT committee_memberships_pkey PRIMARY KEY (id);


--
-- Name: committee_resources committee_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_resources
    ADD CONSTRAINT committee_resources_pkey PRIMARY KEY (id);


--
-- Name: committees committees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committees
    ADD CONSTRAINT committees_pkey PRIMARY KEY (id);


--
-- Name: committees committees_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committees
    ADD CONSTRAINT committees_slug_key UNIQUE (slug);


--
-- Name: file_assets file_assets_cloudinary_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_cloudinary_asset_id_key UNIQUE (cloudinary_asset_id);


--
-- Name: file_assets file_assets_cloudinary_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_cloudinary_public_id_key UNIQUE (cloudinary_public_id);


--
-- Name: file_assets file_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_pkey PRIMARY KEY (id);


--
-- Name: hr_application_stage_log hr_application_stage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_application_stage_log
    ADD CONSTRAINT hr_application_stage_log_pkey PRIMARY KEY (id);


--
-- Name: hr_applications hr_applications_campaign_id_applicant_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_applications
    ADD CONSTRAINT hr_applications_campaign_id_applicant_user_id_key UNIQUE (campaign_id, applicant_user_id);


--
-- Name: hr_applications hr_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_applications
    ADD CONSTRAINT hr_applications_pkey PRIMARY KEY (id);


--
-- Name: hr_campaign_committees hr_campaign_committees_campaign_id_committee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_campaign_committees
    ADD CONSTRAINT hr_campaign_committees_campaign_id_committee_id_key UNIQUE (campaign_id, committee_id);


--
-- Name: hr_campaign_committees hr_campaign_committees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_campaign_committees
    ADD CONSTRAINT hr_campaign_committees_pkey PRIMARY KEY (id);


--
-- Name: hr_campaigns hr_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_campaigns
    ADD CONSTRAINT hr_campaigns_pkey PRIMARY KEY (id);


--
-- Name: hr_onboarding_items hr_onboarding_items_application_id_template_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_onboarding_items
    ADD CONSTRAINT hr_onboarding_items_application_id_template_key_key UNIQUE (application_id, template_key);


--
-- Name: hr_onboarding_items hr_onboarding_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_onboarding_items
    ADD CONSTRAINT hr_onboarding_items_pkey PRIMARY KEY (id);


--
-- Name: media_album_assets media_album_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_album_assets
    ADD CONSTRAINT media_album_assets_pkey PRIMARY KEY (id);


--
-- Name: media_albums media_albums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_albums
    ADD CONSTRAINT media_albums_pkey PRIMARY KEY (id);


--
-- Name: media_brand_assets media_brand_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_brand_assets
    ADD CONSTRAINT media_brand_assets_pkey PRIMARY KEY (id);


--
-- Name: media_coverage_activity_log media_coverage_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_activity_log
    ADD CONSTRAINT media_coverage_activity_log_pkey PRIMARY KEY (id);


--
-- Name: media_coverage_requests media_coverage_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_requests
    ADD CONSTRAINT media_coverage_requests_pkey PRIMARY KEY (id);


--
-- Name: password_reset_otps password_reset_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_otps
    ADD CONSTRAINT password_reset_otps_pkey PRIMARY KEY (id);


--
-- Name: pr_announcement_activity_log pr_announcement_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcement_activity_log
    ADD CONSTRAINT pr_announcement_activity_log_pkey PRIMARY KEY (id);


--
-- Name: pr_announcements pr_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcements
    ADD CONSTRAINT pr_announcements_pkey PRIMARY KEY (id);


--
-- Name: pr_campaign_dispatch_log pr_campaign_dispatch_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_campaign_dispatch_log
    ADD CONSTRAINT pr_campaign_dispatch_log_pkey PRIMARY KEY (id);


--
-- Name: pr_campaigns pr_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_campaigns
    ADD CONSTRAINT pr_campaigns_pkey PRIMARY KEY (id);


--
-- Name: task_activities task_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activities
    ADD CONSTRAINT task_activities_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: assignment_submissions uq_assignment_user_submission; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT uq_assignment_user_submission UNIQUE (assignment_id, user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_assignment_submissions_aid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_submissions_aid ON public.assignment_submissions USING btree (assignment_id);


--
-- Name: idx_assignment_submissions_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_submissions_uid ON public.assignment_submissions USING btree (user_id);


--
-- Name: idx_auth_refresh_tokens_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_refresh_tokens_family ON public.auth_refresh_tokens USING btree (family_id);


--
-- Name: idx_auth_refresh_tokens_family_revoked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_refresh_tokens_family_revoked ON public.auth_refresh_tokens USING btree (family_id, is_revoked);


--
-- Name: idx_auth_refresh_tokens_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_refresh_tokens_token_hash ON public.auth_refresh_tokens USING btree (token_hash);


--
-- Name: idx_auth_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_refresh_tokens_user ON public.auth_refresh_tokens USING btree (user_id);


--
-- Name: idx_auth_user_roles_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_user_roles_scope ON public.auth_user_roles USING btree (scope_type, scope_id);


--
-- Name: idx_auth_user_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_user_roles_user ON public.auth_user_roles USING btree (user_id);


--
-- Name: idx_branch_excom_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_excom_active ON public.branch_excom_members USING btree (is_active);


--
-- Name: idx_branch_excom_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_excom_season ON public.branch_excom_members USING btree (season);


--
-- Name: idx_branch_excom_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_excom_user ON public.branch_excom_members USING btree (user_id);


--
-- Name: idx_branch_officers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_officers_active ON public.branch_officers USING btree (is_active);


--
-- Name: idx_branch_officers_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_officers_season ON public.branch_officers USING btree (season);


--
-- Name: idx_committee_activities_cid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_activities_cid ON public.committee_activities USING btree (committee_id, created_at DESC);


--
-- Name: idx_committee_activities_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_activities_target ON public.committee_activities USING btree (target_user_id);


--
-- Name: idx_committee_announcements_cid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_announcements_cid ON public.committee_announcements USING btree (committee_id, created_at DESC);


--
-- Name: idx_committee_assignments_cid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_assignments_cid ON public.committee_assignments USING btree (committee_id, created_at DESC);


--
-- Name: idx_committee_memberships_committee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_memberships_committee ON public.committee_memberships USING btree (committee_id);


--
-- Name: idx_committee_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_memberships_user ON public.committee_memberships USING btree (user_id);


--
-- Name: idx_committee_resources_committee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_resources_committee ON public.committee_resources USING btree (committee_id);


--
-- Name: idx_file_assets_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_assets_owner ON public.file_assets USING btree (owner_user_id);


--
-- Name: idx_file_assets_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_assets_purpose ON public.file_assets USING btree (purpose);


--
-- Name: idx_file_assets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_assets_status ON public.file_assets USING btree (status, created_at);


--
-- Name: idx_gov_docs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gov_docs_created ON public.branch_governance_documents USING btree (created_at DESC);


--
-- Name: idx_gov_docs_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gov_docs_tag ON public.branch_governance_documents USING btree (tag);


--
-- Name: idx_hr_applications_applicant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_applications_applicant ON public.hr_applications USING btree (applicant_user_id);


--
-- Name: idx_hr_applications_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_applications_campaign ON public.hr_applications USING btree (campaign_id);


--
-- Name: idx_hr_applications_committee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_applications_committee ON public.hr_applications USING btree (committee_id);


--
-- Name: idx_hr_campaign_committees_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_campaign_committees_campaign ON public.hr_campaign_committees USING btree (campaign_id);


--
-- Name: idx_hr_campaign_committees_committee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_campaign_committees_committee ON public.hr_campaign_committees USING btree (committee_id);


--
-- Name: idx_hr_campaigns_committee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_campaigns_committee ON public.hr_campaigns USING btree (committee_id);


--
-- Name: idx_hr_onboarding_items_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_onboarding_items_assignee ON public.hr_onboarding_items USING btree (assignee_user_id);


--
-- Name: idx_media_album_assets_album; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_album_assets_album ON public.media_album_assets USING btree (album_id);


--
-- Name: idx_media_brand_assets_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_brand_assets_category ON public.media_brand_assets USING btree (category);


--
-- Name: idx_media_brand_assets_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_brand_assets_created ON public.media_brand_assets USING btree (created_at DESC);


--
-- Name: idx_media_coverage_committee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_coverage_committee ON public.media_coverage_requests USING btree (committee_id);


--
-- Name: idx_password_reset_otps_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_otps_expiry ON public.password_reset_otps USING btree (expires_at);


--
-- Name: idx_password_reset_otps_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_otps_user ON public.password_reset_otps USING btree (user_id);


--
-- Name: idx_pr_announcements_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_announcements_created ON public.pr_announcements USING btree (created_at DESC);


--
-- Name: idx_task_activities_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_activities_task ON public.task_activities USING btree (task_id);


--
-- Name: idx_tasks_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_archived ON public.tasks USING btree (is_archived);


--
-- Name: idx_tasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assignee ON public.tasks USING btree (assignee_user_id);


--
-- Name: idx_tasks_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_board ON public.tasks USING btree (is_board_task) WHERE (is_board_task = true);


--
-- Name: idx_tasks_committee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_committee ON public.tasks USING btree (committee_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_membership_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_membership_id ON public.users USING btree (membership_id) WHERE (membership_id IS NOT NULL);


--
-- Name: idx_users_verification_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_verification_token_hash ON public.users USING btree (email_verification_token_hash) WHERE (email_verification_token_hash IS NOT NULL);


--
-- Name: assignment_submissions assignment_submissions_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.committee_assignments(id) ON DELETE CASCADE;


--
-- Name: assignment_submissions assignment_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_refresh_tokens auth_refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_tokens
    ADD CONSTRAINT auth_refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_user_roles auth_user_roles_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_user_roles
    ADD CONSTRAINT auth_user_roles_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE SET NULL;


--
-- Name: auth_user_roles auth_user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_user_roles
    ADD CONSTRAINT auth_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: branch_excom_members branch_excom_members_appointed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_excom_members
    ADD CONSTRAINT branch_excom_members_appointed_by_user_id_fkey FOREIGN KEY (appointed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: branch_excom_members branch_excom_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_excom_members
    ADD CONSTRAINT branch_excom_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: branch_governance_documents branch_governance_documents_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_governance_documents
    ADD CONSTRAINT branch_governance_documents_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: committee_activities committee_activities_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_activities
    ADD CONSTRAINT committee_activities_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: committee_activities committee_activities_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_activities
    ADD CONSTRAINT committee_activities_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: committee_activities committee_activities_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_activities
    ADD CONSTRAINT committee_activities_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: committee_announcements committee_announcements_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_announcements
    ADD CONSTRAINT committee_announcements_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: committee_announcements committee_announcements_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_announcements
    ADD CONSTRAINT committee_announcements_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: committee_assignments committee_assignments_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_assignments
    ADD CONSTRAINT committee_assignments_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: committee_assignments committee_assignments_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_assignments
    ADD CONSTRAINT committee_assignments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: committee_memberships committee_memberships_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_memberships
    ADD CONSTRAINT committee_memberships_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: committee_memberships committee_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_memberships
    ADD CONSTRAINT committee_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: committee_resources committee_resources_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_resources
    ADD CONSTRAINT committee_resources_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: committee_resources committee_resources_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_resources
    ADD CONSTRAINT committee_resources_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: file_assets file_assets_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: hr_application_stage_log hr_application_stage_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_application_stage_log
    ADD CONSTRAINT hr_application_stage_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hr_application_stage_log hr_application_stage_log_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_application_stage_log
    ADD CONSTRAINT hr_application_stage_log_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.hr_applications(id) ON DELETE CASCADE;


--
-- Name: hr_applications hr_applications_applicant_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_applications
    ADD CONSTRAINT hr_applications_applicant_user_id_fkey FOREIGN KEY (applicant_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hr_applications hr_applications_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_applications
    ADD CONSTRAINT hr_applications_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.hr_campaigns(id) ON DELETE CASCADE;


--
-- Name: hr_applications hr_applications_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_applications
    ADD CONSTRAINT hr_applications_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE SET NULL;


--
-- Name: hr_campaign_committees hr_campaign_committees_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_campaign_committees
    ADD CONSTRAINT hr_campaign_committees_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.hr_campaigns(id) ON DELETE CASCADE;


--
-- Name: hr_campaign_committees hr_campaign_committees_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_campaign_committees
    ADD CONSTRAINT hr_campaign_committees_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: hr_campaigns hr_campaigns_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_campaigns
    ADD CONSTRAINT hr_campaigns_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: hr_campaigns hr_campaigns_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_campaigns
    ADD CONSTRAINT hr_campaigns_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hr_onboarding_items hr_onboarding_items_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_onboarding_items
    ADD CONSTRAINT hr_onboarding_items_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.hr_applications(id) ON DELETE CASCADE;


--
-- Name: hr_onboarding_items hr_onboarding_items_assignee_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_onboarding_items
    ADD CONSTRAINT hr_onboarding_items_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hr_onboarding_items hr_onboarding_items_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_onboarding_items
    ADD CONSTRAINT hr_onboarding_items_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: hr_onboarding_items hr_onboarding_items_completed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_onboarding_items
    ADD CONSTRAINT hr_onboarding_items_completed_by_user_id_fkey FOREIGN KEY (completed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: hr_onboarding_items hr_onboarding_items_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_onboarding_items
    ADD CONSTRAINT hr_onboarding_items_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_album_assets media_album_assets_album_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_album_assets
    ADD CONSTRAINT media_album_assets_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.media_albums(id) ON DELETE CASCADE;


--
-- Name: media_album_assets media_album_assets_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_album_assets
    ADD CONSTRAINT media_album_assets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: media_albums media_albums_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_albums
    ADD CONSTRAINT media_albums_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: media_albums media_albums_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_albums
    ADD CONSTRAINT media_albums_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_albums media_albums_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_albums
    ADD CONSTRAINT media_albums_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: media_brand_assets media_brand_assets_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_brand_assets
    ADD CONSTRAINT media_brand_assets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_brand_assets media_brand_assets_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_brand_assets
    ADD CONSTRAINT media_brand_assets_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: media_coverage_activity_log media_coverage_activity_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_activity_log
    ADD CONSTRAINT media_coverage_activity_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_coverage_activity_log media_coverage_activity_log_coverage_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_activity_log
    ADD CONSTRAINT media_coverage_activity_log_coverage_request_id_fkey FOREIGN KEY (coverage_request_id) REFERENCES public.media_coverage_requests(id) ON DELETE CASCADE;


--
-- Name: media_coverage_requests media_coverage_requests_accepted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_requests
    ADD CONSTRAINT media_coverage_requests_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: media_coverage_requests media_coverage_requests_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_requests
    ADD CONSTRAINT media_coverage_requests_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: media_coverage_requests media_coverage_requests_linked_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_requests
    ADD CONSTRAINT media_coverage_requests_linked_task_id_fkey FOREIGN KEY (linked_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: media_coverage_requests media_coverage_requests_media_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_requests
    ADD CONSTRAINT media_coverage_requests_media_committee_id_fkey FOREIGN KEY (media_committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: media_coverage_requests media_coverage_requests_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_coverage_requests
    ADD CONSTRAINT media_coverage_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_otps password_reset_otps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_otps
    ADD CONSTRAINT password_reset_otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pr_announcement_activity_log pr_announcement_activity_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcement_activity_log
    ADD CONSTRAINT pr_announcement_activity_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pr_announcement_activity_log pr_announcement_activity_log_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcement_activity_log
    ADD CONSTRAINT pr_announcement_activity_log_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.pr_announcements(id) ON DELETE CASCADE;


--
-- Name: pr_announcements pr_announcements_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcements
    ADD CONSTRAINT pr_announcements_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pr_announcements pr_announcements_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcements
    ADD CONSTRAINT pr_announcements_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pr_announcements pr_announcements_deleted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcements
    ADD CONSTRAINT pr_announcements_deleted_by_user_id_fkey FOREIGN KEY (deleted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pr_announcements pr_announcements_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_announcements
    ADD CONSTRAINT pr_announcements_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pr_campaign_dispatch_log pr_campaign_dispatch_log_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_campaign_dispatch_log
    ADD CONSTRAINT pr_campaign_dispatch_log_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.pr_campaigns(id) ON DELETE CASCADE;


--
-- Name: pr_campaigns pr_campaigns_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_campaigns
    ADD CONSTRAINT pr_campaigns_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE SET NULL;


--
-- Name: pr_campaigns pr_campaigns_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_campaigns
    ADD CONSTRAINT pr_campaigns_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pr_campaigns pr_campaigns_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_campaigns
    ADD CONSTRAINT pr_campaigns_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_activities task_activities_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activities
    ADD CONSTRAINT task_activities_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_activities task_activities_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activities
    ADD CONSTRAINT task_activities_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_assignee_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_committee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_committee_id_fkey FOREIGN KEY (committee_id) REFERENCES public.committees(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

