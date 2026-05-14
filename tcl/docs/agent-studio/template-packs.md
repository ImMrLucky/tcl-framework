# Agent Studio — template packs

**Template packs** group delivery patterns, recommended roles, and optional persona/file lists. They are **optional**: Agent Studio Core remains teams, agents, files, Kanban, review gates, routing, and pause controls.

## System packs (seeded)

Defined in `supabase/sql/050_agent_studio_agent_files_and_template_packs.sql` and mirrored in `packages/agent-core/templates/packs/*/pack.json`:

| Key | Name |
| --- | --- |
| `generic_agent_setup` | Generic Agent Setup |
| `generic_software_delivery` | Generic Software Delivery (default team workflow key for new teams) |
| `bmad` | BMAD Workflow Pack (optional) |
| `scrum` | Scrum Team |
| `research` | Research Team |
| `qa_review` | QA Review Team |
| `security_review` | Security Review Team |
| `data_analysis` | Data Analysis Team |
| `customer_support` | Customer Support |

## Custom packs

Orgs can insert rows into `agent_studio_template_packs` with `org_id` set (`POST /api/agent-studio/template-packs`). System packs (`org_id IS NULL`, `is_system = true`) are read-only via RLS.

## UI

- `/agent-studio/templates/packs` — list packs from the API.
- Team default workflow: `POST /api/agent-studio/teams` uses `generic_software_delivery` when `workflowTemplateKey` is omitted.
