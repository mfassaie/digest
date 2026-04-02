# Standards

## Code Style

| Setting      | Value                      |
|--------------|----------------------------|
| Indentation  | 2 spaces                   |
| Line length  | 80                         |
| Import order | stdlib, external, internal |
| Comments     | Minimal, non-obvious only  |
| Quotes       | Single (TypeScript default)|

## Architecture

| Aspect          | Choice              |
|-----------------|---------------------|
| Design approach | Clean DDD           |
| Error handling  | Language-idiomatic  |

## Git Conventions

| Convention    | Format                          |
|---------------|---------------------------------|
| Commit style  | Freeform (clear, descriptive)   |
| Ticket prefix | None                            |
| Branch format | type/description                |

## Testing

| Setting       | Value          |
|---------------|----------------|
| Framework     | Vitest         |
| Coverage      | 90%            |
| Test location | Alongside      |
| Mock strategy | External only  |
| Naming        | `*.test.ts`    |
