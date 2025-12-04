# OwnMyHealth

A comprehensive HIPAA-compliant personal health management platform that empowers users to aggregate, analyze, and take control of their health data.

## Overview

OwnMyHealth enables users to:
- **Aggregate Health Data**: Upload lab reports, manually enter biomarkers, sync with health devices
- **Analyze Genetics**: Upload DNA files (23andMe, AncestryDNA) for trait analysis and risk assessment
- **Manage Insurance**: Parse and compare insurance plans, track benefits utilization
- **Get AI Insights**: Receive personalized health recommendations and trend analysis
- **Track Goals**: Set and monitor health goals with progress tracking
- **Connect Providers**: Share health data with healthcare providers via consent management

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** for styling
- **Chart.js & Recharts** for data visualization
- **jsPDF & html2canvas** for report generation
- **Tesseract.js** for OCR processing

### Backend
- **Express.js** with TypeScript
- **PostgreSQL** with Prisma ORM 7
- **JWT** authentication (httpOnly cookies)
- **AES-256-GCM** encryption for PHI
- **Zod** for input validation

## Project Structure

```
OwnMyHealth-Claude/
├── src/                          # Frontend React application
│   ├── components/               # React components by feature
│   │   ├── analytics/           # Health analytics & trends
│   │   ├── auth/                # Login & registration
│   │   ├── biomarkers/          # Biomarker management
│   │   ├── common/              # Shared components
│   │   ├── dashboard/           # Main dashboard
│   │   ├── dna/                 # DNA analysis
│   │   ├── health/              # Health insights
│   │   ├── insurance/           # Insurance management
│   │   └── upload/              # File upload handlers
│   ├── contexts/                # React context providers
│   ├── hooks/                   # Custom React hooks
│   ├── services/                # API services
│   ├── types/                   # TypeScript definitions
│   └── utils/                   # Utility functions
├── backend/                      # Express.js API server
│   ├── src/
│   │   ├── controllers/         # Route handlers
│   │   ├── routes/              # API endpoint definitions
│   │   ├── services/            # Business logic
│   │   ├── middleware/          # Express middleware
│   │   └── types/               # Backend types
│   └── prisma/                  # Database schema & migrations
├── docs/                         # Documentation
└── e2e/                          # End-to-end tests
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/breilly1296/OwnMyHealth-Claude.git
   cd OwnMyHealth-Claude
   ```

2. **Install dependencies**
   ```bash
   # Frontend
   npm install

   # Backend
   cd backend
   npm install
   ```

3. **Configure environment**
   ```bash
   # Backend configuration
   cp backend/.env.example backend/.env
   # Edit backend/.env with your database credentials and secrets
   ```

4. **Set up database**
   ```bash
   cd backend
   npx prisma generate
   npx prisma db push
   ```

5. **Start development servers**
   ```bash
   # Terminal 1 - Backend
   cd backend
   npm run dev

   # Terminal 2 - Frontend
   npm run dev
   ```

6. **Open the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

## Environment Variables

### Backend (.env)
```env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/ownmyhealth
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret
PHI_ENCRYPTION_KEY=your-64-char-hex-key
```

See `backend/.env.example` for full configuration options.

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001/api/v1
```

## Key Features

### Biomarker Tracking
- Upload lab report PDFs for automatic extraction
- Manual biomarker entry with normal range tracking
- Historical trend analysis and visualization
- Out-of-range alerts and recommendations

### Genetic Analysis
- Support for 23andMe, AncestryDNA, and raw VCF files
- Variant analysis with clinical significance
- Trait risk assessment with recommendations
- Secure encrypted storage of genetic data

### Insurance Management
- Summary of Benefits and Coverage (SBC) parsing
- Plan comparison tools
- Benefits utilization tracking
- Cost estimation and analysis

### Health Insights
- AI-powered health risk assessment
- Biomarker correlation detection
- Provider recommendations based on conditions
- Predictive trend analysis

### Goal Tracking
- Set health goals with measurable targets
- Progress tracking and milestones
- Goal history and achievement records

## Security & Compliance

### HIPAA Compliance
- Complete audit logging of all data access
- PHI encrypted at rest using AES-256-GCM
- Row-Level Security (RLS) policies
- Consent management for provider access

### Authentication
- JWT tokens in httpOnly, Secure, SameSite cookies
- Account lockout after failed attempts
- Session management with secure refresh

### Data Protection
- Encrypted fields: names, DOB, contact info, biomarker values, genetic data
- Per-user encryption keys
- No PHI in local storage or logs

## API Overview

Base URL: `/api/v1`

| Endpoint | Description |
|----------|-------------|
| `/auth/*` | Authentication (login, register, logout) |
| `/biomarkers/*` | Biomarker CRUD operations |
| `/insurance/*` | Insurance plan management |
| `/dna/*` | DNA data upload and analysis |
| `/health/*` | Health analysis and insights |
| `/health-goals/*` | Goal tracking |
| `/health-needs/*` | Health needs assessment |
| `/upload/*` | File upload handlers |

See [docs/API.md](docs/API.md) for complete API documentation.

## Development

### Scripts

**Frontend:**
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm test             # Run tests
npm run lint         # Lint code
```

**Backend:**
```bash
npm run dev          # Start with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests
npm run lint         # Lint code
```

### Testing
```bash
# Frontend tests
npm test
npm run test:coverage

# Backend tests
cd backend
npm test
```

## Architecture

For detailed architecture documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is private and proprietary.

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/breilly1296/OwnMyHealth-Claude/issues) page.
