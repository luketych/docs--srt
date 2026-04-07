# AGENTS.md - Development Guidelines

## Project Overview
Tick-based producer-consumer system using Redis pub/sub → Redis Streams → Kafka evolution path.
Architecture: Overmind (tick producer) + Zombie-Agents (consumers) + PostgreSQL state persistence.

## Build/Test/Lint Commands
*Note: No code exists yet - commands will be added as implementation progresses*
- Build: `TBD` (depends on chosen language: Python/Node.js/Rust/Go)
- Test: `TBD` (likely `pytest`, `npm test`, `cargo test`, or `go test`)
- Lint: `TBD` (language-specific linter)
- Single test: `TBD` (e.g., `pytest tests/test_specific.py::test_function`)

## Architecture Principles
- **Event-driven**: Redis pub/sub for tick distribution, state machines for agent behavior
- **Persistence**: PostgreSQL for agent state with atomic checkpointing every N ticks
- **Authentication**: JWT/API keys for agent access from day one
- **Observability**: Structured logging with correlation IDs, performance metrics
- **Configuration**: All settings via environment variables, no hardcoded values

## Code Style Guidelines
*To be established based on chosen language*
- **Imports**: Group standard library, third-party, local imports
- **Naming**: snake_case for variables/functions, PascalCase for classes
- **Types**: Strong typing throughout (TypeScript/Python type hints/Rust/Go)
- **Error Handling**: Explicit error handling, no silent failures
- **State Management**: Immutable state where possible, atomic database updates
- **Logging**: JSON structured logs with timestamp, correlation_id, agent_id, tick_id

## Development Phases
1. **M1**: Redis pub/sub foundation with single agent (1 week)
2. **M2**: Multi-agent scaling with business logic (1 week)  
3. **M3**: Comprehensive testing and quality assurance (3-4 days)
4. **M4**: Redis Streams migration for reliability (1 week)

## Testing Strategy
- **Unit Tests (70%)**: Business logic, state machines, utilities
- **Integration Tests (25%)**: Redis/PostgreSQL operations, multi-agent interactions
- **End-to-End Tests (5%)**: Full tick processing workflows
- **Performance Tests**: Latency benchmarks, throughput limits, memory usage