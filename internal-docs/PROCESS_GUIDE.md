# Process Guide

Conventions for running a multi-step development session in this repo.

## Using TODO.md for session management

**IMPORTANT**: When working on a development session, maintain a comprehensive `TODO.md` file that serves as the central plan and tracker:

1. **Session Goal**: Define the high-level objective at the start
2. **Task Tracking**:
   - List all completed tasks with [x] checkboxes
   - Track pending tasks with [ ] checkboxes
   - Group related tasks into logical sections
3. **Architecture Decisions**: Document key design choices and rationale
4. **Progress Updates**: Keep the TODO.md updated as tasks complete
5. **Testing Checklist**: Include verification steps for the session

The TODO.md should be:

- The single source of truth for session progress
- Updated frequently as work progresses
- Clear enough that another developer can understand what was done
- Comprehensive enough to serve as a migration guide

### Structure example

```markdown
# Development Session TODO

## Session Goal

[Clear statement of what this session aims to achieve]

## Completed Tasks ✅

- [x] Task description with key details
- [x] Another completed task

## Pending Tasks 📋

- [ ] Next task to work on
- [ ] Future enhancement

## Architecture Summary

[Key design decisions and rationale]

## Testing Checklist

- [ ] Functionality verification
- [ ] Performance checks
```
