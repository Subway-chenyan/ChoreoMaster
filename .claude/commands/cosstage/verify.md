# Frontend Verify

Run TypeScript type-check and Vite production build. Surface errors concisely.

## Step 1: Type-check

```bash
npx tsc --noEmit 2>&1
```

If there are errors, list only the file + line + error message (skip the file contents). Fix any errors before proceeding.

## Step 2: Vite build

```bash
npx vite build 2>&1 | tail -20
```

If the build fails, surface the error and suggest the likely cause.

## Step 3: Report

Summarize in one line: pass/fail status, number of type errors (if any), build output size (if successful).
