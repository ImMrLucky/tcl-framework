-- Link patch proposals to TCL analyses; index for review UI.

ALTER TABLE public.agent_studio_patch_proposals
  ADD COLUMN IF NOT EXISTS tcl_analysis_id uuid
  REFERENCES public.agent_studio_tcl_analyses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_studio_patch_proposals_tcl
  ON public.agent_studio_patch_proposals(tcl_analysis_id)
  WHERE tcl_analysis_id IS NOT NULL;
