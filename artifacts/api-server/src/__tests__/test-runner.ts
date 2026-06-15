/**
 * Minimal test runner for defect rollback tests.
 *
 * Run: npx tsx --env-file=.env src/__tests__/defects-rollback.test.ts
 *
 * Provides describe/it/expect with colored output.
 * To upgrade to a full test framework, install vitest and replace this file.
 */

let describeStack: string[] = [];
let failures = 0;
let successes = 0;

export function describe(label: string, fn: () => void) {
  describeStack.push(label);
  fn();
  describeStack.pop();
}

export function beforeAll(fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    // Before all hooks run synchronously in sequence before tests
  }
}

export function it(label: string, fn: () => void | Promise<void>) {
  const fullName = [...describeStack, label].join(" > ");
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => {
          successes++;
          console.log(`  ✅ ${fullName}`);
        })
        .catch((err: Error) => {
          failures++;
          console.log(`  ❌ ${fullName}`);
          console.log(`     ${err.message}`);
        });
    } else {
      successes++;
      console.log(`  ✅ ${fullName}`);
    }
  } catch (err) {
    failures++;
    console.log(`  ❌ ${fullName}`);
    if (err instanceof Error) {
      console.log(`     ${err.message}`);
    }
  }
}

export function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    not: {
      toBe(expected: unknown) {
        if (actual === expected) {
          throw new Error(`Expected not ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      },
    },
  };
}

// Auto-run at module level
process.on("exit", () => {
  console.log(`\n  Results: ${successes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
});
