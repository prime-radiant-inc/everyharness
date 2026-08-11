# Task 2: Install Docs Report

## Fix Round 1

### Finding 1: opencode + pi installDoc bootstrap injection conditioning
- **Fixed**: Conditioned "injects bootstrap context" clause on `model.config.bootstrap.kind !== 'none'`
- **Files changed**: `src/adapters/opencode.ts`, `src/adapters/pi.ts`
- **Tests**: Added 4 new RED tests, now GREEN
  - opencode: none-bootstrap omits clause, skill-bootstrap includes clause
  - pi: none-bootstrap omits clause, skill-bootstrap includes clause

### Finding 2: agent-plugins installDoc mcp condition incomplete
- **Fixed**: Extracted `wouldEmitMcp(model)` helper function and used it in both `emit()` and `installDoc()`
- **Files changed**: `src/adapters/agent-plugins.ts`
- **Tests**: Added 2 new RED tests, now GREEN
  - Malformed mcp config (no mcpServers key) doesn't list mcp.json
  - Valid kitchen-sink model lists mcp.json

### Finding 3: gemini positional-args caveat gated on model.commands.length > 0
- **Fixed**: Conditioned "Caveats" section on `model.commands.length > 0`
- **Files changed**: `src/adapters/gemini.ts`
- **Tests**: Added 2 new RED tests, now GREEN
  - Kitchen-sink with commands includes caveat
  - No-commands model omits caveat

### Test Results
- Full suite: **244 passed** (baseline 236 + 8 new tests)
- TypeScript: `npx tsc --noEmit` ✓ (no errors)
- Opencode exact content test: ✓ UNCHANGED (kitchen-sink is skill-mode)

