# File Organization Guide

## File Size Limits
- **Target**: ~200 lines per file
- **Maximum**: 300 lines per file
- **Action Required**: Refactor when approaching 300 lines

## Refactoring Strategies

### 1. Component Splitting
When a React component gets too large:

```typescript
// Before: Large component (300+ lines)
function LargeComponent() {
  // Lots of state, handlers, and JSX
}

// After: Split into smaller components
function MainComponent() {
  return (
    <div>
      <ComponentHeader />
      <ComponentBody />
      <ComponentFooter />
    </div>
  );
}

function ComponentHeader() { /* ... */ }
function ComponentBody() { /* ... */ }
function ComponentFooter() { /* ... */ }
```

### 2. Extract Custom Hooks
Move complex state logic to custom hooks:

```typescript
// Extract to hooks/useComponentLogic.ts
export function useComponentLogic() {
  const [state, setState] = useState();
  // Complex logic here
  return { state, handlers };
}

// Use in component
function Component() {
  const { state, handlers } = useComponentLogic();
  return <div>...</div>;
}
```

### 3. Utility Functions
Move helper functions to separate utility files:

```typescript
// utils/componentHelpers.ts
export function formatData(data) { /* ... */ }
export function validateInput(input) { /* ... */ }
export function calculateMetrics(values) { /* ... */ }
```

### 4. Type Definitions
Extract complex types to separate files:

```typescript
// types/componentTypes.ts
export interface ComponentProps { /* ... */ }
export interface ComponentState { /* ... */ }
export type ComponentVariant = 'primary' | 'secondary';
```

### 5. Constants and Configuration
Move constants to separate files:

```typescript
// constants/componentConstants.ts
export const DEFAULT_CONFIG = { /* ... */ };
export const VALIDATION_RULES = { /* ... */ };
export const API_ENDPOINTS = { /* ... */ };
```

## Directory Structure Examples

### Large Component Refactoring
```
components/
├── Dashboard/
│   ├── index.tsx              # Main component (50-100 lines)
│   ├── DashboardHeader.tsx    # Header section
│   ├── DashboardStats.tsx     # Statistics cards
│   ├── DashboardCharts.tsx    # Chart components
│   ├── DashboardActions.tsx   # Action buttons
│   └── hooks/
│       ├── useDashboardData.ts
│       └── useDashboardFilters.ts
```

### Utility Module Refactoring
```
utils/
├── insurance/
│   ├── index.ts               # Re-exports
│   ├── parser.ts              # Parsing functions
│   ├── validator.ts           # Validation functions
│   ├── formatter.ts           # Formatting functions
│   └── calculator.ts          # Calculation functions
```

## Refactoring Checklist

### Before Refactoring
- [ ] Identify logical groupings of functionality
- [ ] Plan the new file structure
- [ ] Ensure all imports/exports are mapped
- [ ] Consider impact on other files

### During Refactoring
- [ ] Create new files with descriptive names
- [ ] Move related functions/components together
- [ ] Update import statements
- [ ] Maintain proper TypeScript types
- [ ] Keep consistent naming conventions

### After Refactoring
- [ ] Test that all functionality still works
- [ ] Remove unused imports
- [ ] Delete empty or unused files
- [ ] Update documentation if needed
- [ ] Verify no circular dependencies

## Common Patterns

### 1. Feature-Based Organization
```
features/
├── biomarkers/
│   ├── components/
│   ├── hooks/
│   ├── utils/
│   └── types/
└── insurance/
    ├── components/
    ├── hooks/
    ├── utils/
    └── types/
```

### 2. Layer-Based Organization
```
src/
├── components/        # UI components
├── hooks/            # Custom hooks
├── utils/            # Pure functions
├── services/         # API calls
├── types/            # Type definitions
└── constants/        # Configuration
```

### 3. Domain-Driven Organization
```
src/
├── domains/
│   ├── health/
│   │   ├── components/
│   │   ├── services/
│   │   └── types/
│   └── insurance/
│       ├── components/
│       ├── services/
│       └── types/
└── shared/
    ├── components/
    ├── utils/
    └── types/
```

## File Removal Commands

When refactoring, clean up unused files:

```bash
# Remove specific files
rm src/components/OldComponent.tsx

# Remove empty directories
rmdir src/unused-directory

# Remove multiple files
rm src/components/{File1.tsx,File2.tsx,File3.tsx}
```

## Best Practices

1. **Single Responsibility**: Each file should have one clear purpose
2. **Logical Grouping**: Group related functionality together
3. **Clear Naming**: Use descriptive file and directory names
4. **Consistent Structure**: Follow established patterns
5. **Import Organization**: Keep imports clean and organized
6. **Documentation**: Update docs when restructuring

## Warning Signs a File Needs Refactoring

- File exceeds 250-300 lines
- Multiple unrelated responsibilities
- Difficult to find specific functionality
- Many imports from different domains
- Complex nested logic
- Repeated code patterns
- Hard to test individual pieces

Remember: The goal is maintainable, readable code that's easy to understand and modify.