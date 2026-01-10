---
tags:
  - documentation
  - architecture
type: prompt
priority: 2
---

# Generate ARCHITECTURE.md

## Purpose
Create or update the system architecture document for OwnMyHealth.

## From Codebase (Claude Code)
1. Read `backend/prisma/schema.prisma` - document all models
2. Read `backend/src/routes/` - list all API routes
3. Read `backend/src/services/` - identify key services
4. Read `package.json` (both) - identify tech stack
5. Read `Dockerfile` - identify runtime
6. Read `vite.config.ts` - identify frontend config

## Questions to Ask

### System Overview
1. Can you describe the high-level architecture?
2. What are the main components and how do they connect?
3. What external services are integrated?

### Infrastructure
1. Where is frontend hosted?
2. Where is backend hosted?
3. What database is used and where?
4. What file storage is used?

### Data Flow
1. How does user authentication work?
2. How does PDF upload and extraction work?
3. How does insurance plan parsing work?

### Costs
1. What's the estimated monthly cost per service?
2. What's the total monthly infrastructure cost?

## Output Format

```markdown
# OwnMyHealth Architecture

**Last Updated:** [Date]

## System Overview
[ASCII diagram]

## Technology Stack

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | React |
...

### Backend
| Component | Technology |
|-----------|------------|
| Runtime | Node.js |
...

### Database
| Component | Technology |
|-----------|------------|
| Engine | PostgreSQL |
...

### External Services
| Service | Provider | Purpose |
|---------|----------|---------|
...

## Data Flow Diagrams

### Authentication Flow
[ASCII diagram]

### PDF Upload Flow
[ASCII diagram]

## Database Schema

### Core Tables
[Table descriptions and relationships]

### Indexes
[Key indexes]

## Security Architecture

### Encryption
| Layer | Method |
|-------|--------|
...

### Authentication
[Description]

## Infrastructure Details

### Cloud Run Configuration
| Setting | Value |
|---------|-------|
...

### Cost Breakdown
| Service | Monthly Cost |
|---------|-------------|
...

## File Structure
[Key directories and purposes]
```
