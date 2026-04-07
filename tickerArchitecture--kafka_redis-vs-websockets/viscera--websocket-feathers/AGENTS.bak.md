# AGENTS.md - Development Guidelines

## Build/Test Commands
```bash
# Project setup (when implemented)
npm create feathers@latest
npm install
npm run dev

# Testing (planned)
npm test                    # Run all tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests including WebSocket
npm run test:load          # Load testing for WebSocket connections

# Linting/Quality
npm run lint               # ESLint
npm run typecheck          # TypeScript checking
npm run format             # Prettier formatting
```

## Architecture Overview
- **Framework**: FeathersJS with TypeScript
- **Database**: PostgreSQL with Sequelize/Knex ORM
- **Real-time**: WebSocket connections via Socket.io
- **Authentication**: JWT-based with FeathersJS auth

## Code Style Guidelines

### Imports & Structure
- Use ES6 imports: `import { service } from '@feathersjs/feathers'`
- Group imports: external libraries, then local modules
- Follow FeathersJS service patterns and official generators

### Naming Conventions
- Services: PascalCase (`TickService`, `AgentService`)
- Files: kebab-case (`tick-service.ts`, `agent-state.ts`)
- Variables: camelCase (`tickId`, `connectionPool`)
- Constants: UPPER_SNAKE_CASE (`MAX_CONNECTIONS`, `TICK_INTERVAL`)

### Types & Validation
- Use TypeScript strict mode
- TypeBox schemas for all service inputs/outputs
- Interface definitions for all data structures
- Proper typing for WebSocket events and handlers

### Error Handling
- Use FeathersJS error classes (`BadRequest`, `NotAuthenticated`)
- Structured error logging with correlation IDs
- Graceful WebSocket connection error recovery
- Circuit breaker patterns for service failures

### WebSocket Patterns
- Use FeathersJS real-time events for state synchronization
- Implement auto-reconnection with exponential backoff
- Handle connection lifecycle (connect, disconnect, error)
- Maintain connection state consistency across server restarts

## Testing Strategy
- **Unit Tests (70%)**: Service methods, hooks, business logic
- **Integration Tests (25%)**: WebSocket connections, real-time events
- **E2E Tests (5%)**: Full client-server workflows
- Use deterministic WebSocket testing with proper setup/teardown