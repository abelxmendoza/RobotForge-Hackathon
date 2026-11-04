# Branch cleanup — 2026-11-04

The owner requested consolidating active work on main and finishing Claude’s handoff.
Workshop simulation (PR #147) and Scan Studio (PR #146) were already merged.
The remaining Add a Robot RealSense action now opens Scan Studio instead of the
colour-only camera modal. Gazebo now uses port 8766; Scan Studio keeps 8765,
so their local companions can run together.

## Historical work preserved

These tags retain the exact former branch tips. Archiving does **not** mean all
historical features were activated on main. In particular, the old One Forge
and notebook designs conflict with the current Wrench interface; they remain
recoverable for a separate, deliberate port.

| Former branch | Preserved commit | Archive tag |
|---|---|---|
| `codex/legacy-local-main-backup` | `80ca8f085ea8b702c0b848e1d6a3085c023e7989` | `archive/2026-11-04/codex/legacy-local-main-backup` |
| `codex/workshop-unified-chat` | `80ca8f085ea8b702c0b848e1d6a3085c023e7989` | `archive/2026-11-04/codex/workshop-unified-chat` |
| `codex/workspace-backup-2026-11-03` | `1d06162d1062dc7d224c1ef8350754e66c0c2ec9` | `archive/2026-11-04/codex/workspace-backup-2026-11-03` |
| `docs/agent-deploy-rules` | `a5c0873f1e42a8252f5278c55ca60fec520522b6` | `archive/2026-11-04/docs/agent-deploy-rules` |
| `feat/realsense-scan-studio` | `53c8fac49cfed1ba7d0ee9e7985f798a4caf487a` | `archive/2026-11-04/feat/realsense-scan-studio` |
| `feature/one-forge` | `24cbcda9121797b7f2bc30ac6a9e5fd797dc78c5` | `archive/2026-11-04/feature/one-forge` |
| `work` | `2b4511ccc3b144ed0ea96a655b60a82bd5fde44e` | `archive/2026-11-04/work` |

## Audit findings

- `feat/realsense-scan-studio`: already contained in main.
- `docs/agent-deploy-rules`: older version of the rules already on main. Current freeze and stricter rules stay authoritative.
- `codex/workshop-unified-chat`: duplicate of `codex/legacy-local-main-backup`. Both tips preserved.
- `codex/workspace-backup-2026-11-03`: retains the local rover spec and generated page; these are not product changes.
- `feature/one-forge`: six old commits include Spot workflows, earlier photo intake and UI redesigns; substantial unique work remains archived.
- `work`: some physics and health hardening landed via PR #134, but export smoke scripts and historical audit material remain unique in this archive.

To restore any line without changing main:

```bash
git fetch origin --tags
git switch -c restore/one-forge archive/2026-11-04/feature/one-forge
```

No Worker deployment or secret changes were performed.
