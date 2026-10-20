# A logic map stores only its skeleton and links into a project's existing requirement docs

A **Logic map** records nodes, lines and branch conditions. It does not keep its own copy of a requirement when the project already has a place for requirements (a spec framework such as ATW's `prd.md`). A **Node** in such a project points at the matching section of that framework's doc. Only a project without one gets **Node docs** written under `docs/logic-maps/<map>/`. The reason is that two copies of the same requirement cost the agent tokens twice and drift apart: the user would read one version on the map while the agent builds from the other, and catching that kind of misunderstanding is the reason the map exists.

## Consequences

- Nodes and lines are drawn every turn and do not wait for the framework. Until the framework's doc exists, a node holds a short interim summary written by the agent: what the step does, its rules, and its branch conditions. Once the doc is written, the node points at its section.
- If the framework writes its doc in a conversation where the logic map is off, the node keeps the interim summary and carries a "not linked to the final doc yet" marker. The next conversation that turns the map on for it links those nodes first.
- If the linked doc is edited in a conversation where the map is off, the map does not follow. This is a known limit of the first version.
- The agent judges once per map whether the project has a spec framework, records the answer in the map, and tells the user. There is no project setting for it.
- The map is drawn by Osuna from the skeleton through automatic layout. No model places coordinates, so drawing costs no tokens, and no separate cheap model is involved.
