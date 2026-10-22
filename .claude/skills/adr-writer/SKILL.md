---
name: adr-writer
description: Creates Architecture Decision Records documenting key technical decisions with context, alternatives considered, tradeoffs, consequences, and decision owners. Use when documenting "architecture decisions", "technical choices", "design decisions", or "ADRs".
source: 'https://github.com/kfreiman/engineer-challenge/blob/master/.agents/skills/adr-writer/SKILL.md'
---

# ADR Writer

Document architecture decisions with clear context, alternatives, and consequences. Write in English.

## ADR Template

```markdown
# ADR-[Number]: [Short decision title]

**Status:** [Proposed | Accepted | Deprecated | Superseded by ADR-XXX]  
**Date:** [YYYY-MM-DD]  
**Author:** [Name/Handle]

## 1. Context

What problem are we solving? What factors affect it (business goals, tech debt, budget)?
**Constraints:**

- [Constraint 1]
- [Constraint 2]

## 2. Decision

A short statement of the decision. The main thesis.

## 3. Technical details and mechanisms

_Free-form section. Describe implementation specifics, data structures, protocol details or key framework features._

- [Lists, API descriptions, data schemas]
- [Mermaid visualization (recommended for complex interactions)]

## 4. Alternatives considered

### 4.1. [Option 1]

- **Pros:** ...
- **Cons:** ...
- **Decision:** [Rejected/Considered] (short reason).

## 5. Consequences and risks

### Positive (Pros)

- How does this help the system/team?

### Negative / Risks (Cons/Risks)

- Which downsides do we accept? What are the threats?
- **Mitigation:** How will we deal with the risks?

## 6. Revision History

- **[Date]**: [Description of the change] ([Author])
- **[Date]**: [E.g.: Status changed to Accepted] ([Author])
```

## ADR Numbering

```
ADR-001: Initial System Architecture
ADR-002: Database Selection for Analytics
ADR-003: Authentication Strategy
...
```

## Status Workflow

```
Proposed → Accepted → Implemented
    ↓
Rejected

Accepted → Deprecated → Superseded by ADR-XXX
```

## Best Practices

1. **Write ADRs for significant decisions**: Not every choice needs an ADR
2. **Document alternatives**: Show you considered options
3. **Be honest about tradeoffs**: Every decision has downsides
4. **Keep it concise**: 1-2 pages maximum
5. **Update status**: Mark deprecated/superseded ADRs
6. **Link related ADRs**: Create decision trails
7. **Include follow-ups**: Action items with owners
8. **Visualize**: Use Mermaid diagrams to show architecture and flows
9. **Write for future readers** who lack current context
10. **Be honest about trade-offs** (every choice has downsides)

## Common Patterns

**For technology selection**:

- Focus on technical capabilities vs requirements
- Include performance benchmarks if available
- Document team expertise level
- Consider operational complexity

**For architectural changes**:

- Include migration strategy in consequences
- Document backward compatibility impact
- Consider team velocity impact during transition
- Note monitoring and rollback plans

**For standards and conventions**:

- Include examples of the standard in practice
- Document exceptions or escape hatches
- Consider enforcement mechanisms
- Note educational/onboarding implications

**For deprecations**:

- Set status to "Deprecated" or "Superseded"
- Link to superseding ADR
- Document sunset timeline
- Include migration guide

## Anti-Patterns

❌ **Too detailed**: 10-page ADRs nobody reads
❌ **No alternatives**: Looks like decision was predetermined
❌ **Missing consequences**: Ignoring downsides
❌ **No owner**: Nobody accountable
❌ **Outdated status**: Old ADRs marked "Proposed"

## Review Checklist

- [ ] Clear problem statement in Context
- [ ] Decision is stated explicitly
- [ ] 2+ alternatives considered
- [ ] Tradeoffs honestly assessed
- [ ] Consequences (positive and negative) documented
- [ ] Risks identified with mitigations
- [ ] Decision owner assigned
- [ ] Follow-up actions with deadlines
- [ ] Status is current

## Output Checklist

- [ ] ADR document created
- [ ] Context explains the problem
- [ ] Decision clearly stated
- [ ] 2-3 alternatives documented
- [ ] Tradeoffs section filled
- [ ] Consequences listed (positive & negative)
- [ ] Risks identified with mitigations
- [ ] Decision date and owners
- [ ] Follow-up actions assigned
- [ ] Status is set
