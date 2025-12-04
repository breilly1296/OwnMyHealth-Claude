# OwnMyHealth Development Guide

This guide covers development setup, coding standards, and contribution guidelines.

## Development Setup

### Prerequisites

- **Node.js**: 18.0+ (LTS recommended)
- **npm**: 9.0+ (comes with Node.js)
- **PostgreSQL**: 14+ (or use Docker)
- **Git**: 2.30+

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/breilly1296/OwnMyHealth-Claude.git
   cd OwnMyHealth-Claude
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

4. **Configure environment**
   ```bash
   # Copy example env file
   cp backend/.env.example backend/.env

   # Edit with your settings
   # Required: DATABASE_URL, JWT secrets, PHI_ENCRYPTION_KEY
   ```

5. **Setup database**
   ```bash
   cd backend

   # Generate Prisma client
   npx prisma generate

   # Push schema to database (development)
   npx prisma db push

   # Or run migrations (production)
   npx prisma migrate deploy
   ```

6. **Start development servers**
   ```bash
   # Terminal 1: Backend
   cd backend
   npm run dev

   # Terminal 2: Frontend
   npm run dev
   ```

### Using Docker (Alternative)

```bash
# Start PostgreSQL
docker run --name ownmyhealth-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ownmyhealth \
  -p 5432:5432 \
  -d postgres:14

# Update DATABASE_URL in .env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ownmyhealth"
```

## Project Structure

### Frontend (`src/`)

```
src/
├── components/          # React components organized by feature
│   ├── analytics/      # Dashboard analytics
│   ├── auth/           # Authentication pages
│   ├── biomarkers/     # Biomarker management
│   ├── common/         # Shared components
│   ├── dashboard/      # Main layout
│   ├── dna/            # DNA analysis
│   ├── health/         # Health insights
│   ├── insurance/      # Insurance management
│   └── upload/         # File uploads
├── contexts/           # React Context providers
├── hooks/              # Custom hooks
├── services/           # API layer
├── types/              # TypeScript definitions
├── utils/              # Utility functions
└── __tests__/          # Test files
```

### Backend (`backend/src/`)

```
backend/src/
├── controllers/        # Request handlers
├── routes/             # Route definitions
├── services/           # Business logic
├── middleware/         # Express middleware
├── types/              # TypeScript definitions
├── utils/              # Utilities
└── generated/          # Prisma generated client
```

## Coding Standards

### TypeScript

- **Strict mode**: `strict: true` in tsconfig
- **No implicit any**: All variables typed
- **Interface over type**: Prefer `interface` for objects
- **Explicit returns**: Type function return values

```typescript
// Good
interface UserData {
  id: string;
  email: string;
  role: UserRole;
}

async function getUser(id: string): Promise<UserData | null> {
  // ...
}

// Avoid
type UserData = { id: any; email: any };
async function getUser(id) {
  // ...
}
```

### React Components

- **Functional components**: No class components
- **Named exports**: Export components by name
- **Props interface**: Define props with interface
- **Memoization**: Use useMemo/useCallback for optimization

```typescript
// Good
interface BiomarkerCardProps {
  biomarker: Biomarker;
  onEdit: (id: string) => void;
}

export function BiomarkerCard({ biomarker, onEdit }: BiomarkerCardProps) {
  const handleClick = useCallback(() => {
    onEdit(biomarker.id);
  }, [biomarker.id, onEdit]);

  return <div onClick={handleClick}>...</div>;
}
```

### File Naming

- **Components**: PascalCase (`BiomarkerCard.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Types**: PascalCase (`UserTypes.ts`)
- **Tests**: `.test.ts` or `.test.tsx` suffix

### Import Order

```typescript
// 1. React/Node built-ins
import { useState, useEffect } from 'react';

// 2. External packages
import { format } from 'date-fns';

// 3. Internal modules (absolute)
import { api } from '@/services/api';

// 4. Relative imports
import { BiomarkerCard } from './BiomarkerCard';

// 5. Types
import type { Biomarker } from '@/types';

// 6. Styles
import './styles.css';
```

### Error Handling

```typescript
// Frontend - in components
try {
  const data = await api.getBiomarkers();
  setBiomarkers(data);
} catch (error) {
  setError(error instanceof Error ? error.message : 'An error occurred');
}

// Backend - in controllers
try {
  const result = await service.process(data);
  res.json({ success: true, data: result });
} catch (error) {
  next(error); // Let error handler middleware deal with it
}
```

### API Response Format

```typescript
// Success
{
  success: true,
  data: { ... }
}

// Error
{
  success: false,
  error: {
    code: 'ERROR_CODE',
    message: 'Human readable message',
    details: [...] // Optional
  }
}
```

## Testing

### Running Tests

```bash
# Frontend tests
npm test                  # Run once
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage

# Backend tests
cd backend
npm test
npm run test:watch
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests
```

### Writing Tests

**Component Tests (Frontend)**
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { BiomarkerCard } from './BiomarkerCard';

describe('BiomarkerCard', () => {
  const mockBiomarker = {
    id: '1',
    name: 'Glucose',
    value: 95,
    unit: 'mg/dL',
  };

  it('renders biomarker name', () => {
    render(<BiomarkerCard biomarker={mockBiomarker} />);
    expect(screen.getByText('Glucose')).toBeInTheDocument();
  });

  it('calls onEdit when clicked', () => {
    const onEdit = vi.fn();
    render(<BiomarkerCard biomarker={mockBiomarker} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onEdit).toHaveBeenCalledWith('1');
  });
});
```

**API Tests (Backend)**
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('GET /api/v1/biomarkers', () => {
  it('returns biomarkers for authenticated user', async () => {
    const response = await request(app)
      .get('/api/v1/biomarkers')
      .set('Cookie', `accessToken=${validToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('returns 401 without authentication', async () => {
    await request(app)
      .get('/api/v1/biomarkers')
      .expect(401);
  });
});
```

### Test Coverage Goals

- **Critical paths**: 80%+ coverage
- **Business logic**: 90%+ coverage
- **Edge cases**: Document and test

## Database Management

### Prisma Commands

```bash
# Generate client (after schema changes)
npx prisma generate

# Push schema changes (development)
npx prisma db push

# Create migration (production)
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# Open Prisma Studio
npx prisma studio

# Reset database
npx prisma migrate reset
```

### Schema Changes

1. Edit `backend/prisma/schema.prisma`
2. Run `npx prisma generate`
3. Run `npx prisma db push` (dev) or create migration (prod)
4. Update TypeScript types if needed

### Seeding Data

```bash
# Run seed script
npx prisma db seed

# Seed is configured in package.json:
# "prisma": { "seed": "tsx prisma/seed.ts" }
```

## Common Tasks

### Adding a New API Endpoint

1. **Define route** in `backend/src/routes/`
   ```typescript
   // healthRoutes.ts
   router.get('/analysis', authenticate, healthController.getAnalysis);
   ```

2. **Create controller** in `backend/src/controllers/`
   ```typescript
   // healthController.ts
   export async function getAnalysis(req: AuthenticatedRequest, res: Response) {
     const userId = req.user!.id;
     const analysis = await healthService.analyze(userId);
     res.json({ success: true, data: analysis });
   }
   ```

3. **Add service logic** in `backend/src/services/`
   ```typescript
   // healthService.ts
   export async function analyze(userId: string) {
     const biomarkers = await prisma.biomarker.findMany({ where: { userId } });
     return performAnalysis(biomarkers);
   }
   ```

4. **Update API client** in `src/services/api.ts`
   ```typescript
   export async function getHealthAnalysis(): Promise<HealthAnalysis> {
     return apiRequest('/health/analysis');
   }
   ```

### Adding a New Component

1. **Create component file**
   ```typescript
   // src/components/health/HealthScore.tsx
   interface HealthScoreProps {
     score: number;
     trend: 'up' | 'down' | 'stable';
   }

   export function HealthScore({ score, trend }: HealthScoreProps) {
     return (
       <div className="health-score">
         <span className="score">{score}</span>
         <TrendIcon direction={trend} />
       </div>
     );
   }
   ```

2. **Add to barrel export**
   ```typescript
   // src/components/health/index.ts
   export { HealthScore } from './HealthScore';
   ```

3. **Write tests**
   ```typescript
   // src/__tests__/components/HealthScore.test.tsx
   describe('HealthScore', () => {
     it('displays the score', () => {
       render(<HealthScore score={85} trend="up" />);
       expect(screen.getByText('85')).toBeInTheDocument();
     });
   });
   ```

### Adding a Database Field

1. **Update Prisma schema**
   ```prisma
   model Biomarker {
     // existing fields...
     newField String? @map("new_field")
   }
   ```

2. **Generate client**
   ```bash
   npx prisma generate
   ```

3. **Push changes (dev) or migrate (prod)**
   ```bash
   npx prisma db push
   # or
   npx prisma migrate dev --name add_new_field
   ```

4. **Update TypeScript types**
   ```typescript
   // src/types/index.ts
   interface Biomarker {
     // existing fields...
     newField?: string;
   }
   ```

## Debugging

### Frontend Debugging

- **React DevTools**: Install browser extension
- **Vite HMR**: Automatic hot reload
- **Console logging**: Use structured logs
- **Network tab**: Monitor API calls

### Backend Debugging

- **VS Code debugger**: Launch configuration included
- **Console logging**: `console.log` (dev only)
- **Prisma logging**: Set `log: ['query']` in PrismaClient
- **Morgan**: Request logging enabled

### Common Issues

**Port already in use**
```bash
# Find process using port
netstat -ano | findstr :3001

# Kill process
taskkill /PID <pid> /F
```

**Prisma client outdated**
```bash
npx prisma generate
```

**Database connection failed**
- Check DATABASE_URL in .env
- Ensure PostgreSQL is running
- Verify credentials

**TypeScript errors after schema change**
```bash
# Regenerate Prisma client
npx prisma generate

# Restart TypeScript server in VS Code
Cmd/Ctrl + Shift + P > "TypeScript: Restart TS Server"
```

## Deployment

### Build for Production

```bash
# Frontend
npm run build
# Output: dist/

# Backend
cd backend
npm run build
# Output: dist/
```

### Environment Variables (Production)

Required for production:
- `NODE_ENV=production`
- `DATABASE_URL` - Production PostgreSQL
- `JWT_ACCESS_SECRET` - Generate with `openssl rand -base64 32`
- `JWT_REFRESH_SECRET` - Generate with `openssl rand -base64 32`
- `PHI_ENCRYPTION_KEY` - Generate with `openssl rand -hex 32`
- `CORS_ORIGIN` - Your frontend domain

### Pre-deployment Checklist

- [ ] All tests passing
- [ ] TypeScript compiles without errors
- [ ] Environment variables set
- [ ] Database migrations applied
- [ ] SSL/TLS configured
- [ ] CORS configured for production domain
- [ ] Rate limiting appropriate for load
- [ ] Audit logging enabled
- [ ] Backup strategy in place

## Security Guidelines

### PHI Handling

- **Never log PHI**: Use structured logging without sensitive data
- **Encrypt at rest**: All PHI fields encrypted before storage
- **Minimize exposure**: Only decrypt when needed

### Authentication

- **Use httpOnly cookies**: Never store tokens in localStorage
- **Short token lifetime**: 15 minutes for access tokens
- **Secure refresh**: 7-day refresh tokens with rotation

### Input Validation

- **Validate all input**: Use Zod schemas
- **Sanitize output**: Escape HTML in responses
- **Parameterize queries**: Prisma handles this

### Audit Logging

- **Log all access**: Every data read/write logged
- **Include context**: User ID, timestamp, resource
- **Retain appropriately**: Follow HIPAA requirements

## Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **Code Review**: All PRs require review
- **Documentation**: Check docs/ folder first
