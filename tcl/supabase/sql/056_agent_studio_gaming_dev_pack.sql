-- Game Development team-in-a-box template pack (see packages/agent-core/templates/packs/gaming-dev).

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'gaming_dev', 'Game Development',
   'Build games from scratch — Roblox (Luau), Unity (C#), Godot, or web. Design, scripting, playtest, and ship a vertical slice.',
   'gaming', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'gaming_dev');
