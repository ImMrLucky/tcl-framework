# Build-Time Scripts

## check-hardcoded-values

Prevents hard-coded thresholds and clamps in calculation paths.

### Usage

```bash
# Run the shell-based checker (recommended, no dependencies)
npm run check:hardcoded

# Or run the TypeScript version (requires tsx)
npm run check:hardcoded:ts
```

### What It Checks

1. **Hard-coded thresholds in outputs**:
   - `supportThreshold: 0.65` → Should use `config.thresholds.support`
   - `contradictionThreshold: 0.70` → Should use `config.thresholds.contradiction`
   - `groundingThreshold: 0.60` → Should use `config.thresholds.grounding`

2. **Hard-coded clamps**:
   - `Math.min(config.thresholds.grounding, 0.4)` → Should use config-based clamping
   - `Math.max(config.thresholds.support, 0.5)` → Should use config-based clamping

3. **Magic numbers in calculations**:
   - `score = value * 0.65` → Should use config weights
   - `threshold = 0.70` → Should use config values

### Exclusions

The checker automatically excludes:
- `template-config.ts` (config files are allowed to have thresholds)
- Test files (`*.test.ts`, `*.spec.ts`)
- Comments
- `node_modules`, `dist`, test directories

### CI Integration

Add to your CI pipeline:

```yaml
# GitHub Actions example
- name: Check for hard-coded values
  run: |
    cd packages/tcl-core
    npm run check:hardcoded
```

### Fixing Violations

When a violation is found:

1. **For threshold outputs**: Replace with config value:
   ```typescript
   // ❌ Bad
   supportThreshold: 0.65
   
   // ✅ Good
   supportThreshold: config.thresholds.support
   ```

2. **For clamps**: Use config-based clamping:
   ```typescript
   // ❌ Bad
   const threshold = Math.min(config.thresholds.grounding, 0.4);
   
   // ✅ Good
   const threshold = config.thresholds.groundingEffective ?? config.thresholds.grounding;
   ```

3. **For magic numbers**: Use config weights:
   ```typescript
   // ❌ Bad
   const score = value * 0.65;
   
   // ✅ Good
   const score = value * config.weights.calibration.entityMatch;
   ```

