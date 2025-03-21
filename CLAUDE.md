# CLAUDE.md - Copilot for Obsidian Plugin

## Development Commands

- Build: `npm run build`
- Development: `npm run dev`
- Lint: `npm run lint` (fix: `npm run lint:fix`)
- Format: `npm run format` (check: `npm run format:check`)
- Test: `npm run test` (single test: `npm test -- -t "test name"`)
- Before PR: Run `npm run format && npm run lint`

## Code Style Guidelines

- TypeScript with strict null checks and no implicit any
- Use absolute imports with `@/` prefix (e.g., `import { ChainType } from "@/chainFactory"`)
- React functional components with hooks
- Error handling: Use detailed error objects with type interfaces
- Consistent naming: PascalCase for components/classes, camelCase for functions/variables
- Comment complex logic and functions with JSDoc format
- Use async/await for asynchronous operations
- Prefer const/let over var
- Organize imports: React first, then external, then internal
- Format with Prettier and ESLint before commits

## Code Organization

- UI components in src/components/
- LLM providers in src/LLMProviders/
- Utility functions in src/utils.ts
- Settings in src/settings/
- Tests adjacent to implementation files
