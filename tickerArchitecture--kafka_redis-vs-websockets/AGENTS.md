# AGENTS.md

## Project Overview
This is a tick-based producer-consumer system for live trading and backtesting with Redis event broker, Overmind tick producer, and Zombie-Agents consumers. The project is currently in planning/design phase with documentation only.

## Build/Test/Lint Commands
*No build system configured yet - project contains only documentation*
- No package.json, Cargo.toml, or other build files found
- No test framework configured
- No linting tools configured

## Code Style Guidelines
*To be established when implementation begins*

### Language/Framework
- Target architecture: JavaScript/Node.js with Redis and PostgreSQL
- Event-driven architecture with state machines
- Factory pattern for object creation
- FeathersJS for backend services (based on inspiration docs)

### Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for classes and constructors
- Use UPPER_SNAKE_CASE for constants
- Prefix private methods with underscore

### Architecture Patterns
- State machine driven execution (SMO - Status Management Object)
- Factory pattern for orderProcedures and subProcedures
- Event-driven communication via Redis pub/sub
- Tick-based processing with periodic execution loops