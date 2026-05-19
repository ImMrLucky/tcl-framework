-- Agent Studio: persisted Kanban board settings (swimlanes, review policy).
ALTER TABLE public.agent_studio_boards
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agent_studio_boards.settings IS
  'Board UI + review policy: swimlaneMode, reviewPolicy.defaultMode (AUTO_APPROVED|HUMAN|AGENT|MIXED), gate defaults, etc.';
