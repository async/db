# Mocking

Mock behavior is local and route-aware. Use it to make loading, retry, and empty states visible before the backend exists. Use delay for realistic loading state and random errors for retry UI. Keep random failures off unless the app is actively exercising failure handling.

## Delay and errors

```js
export default defineConfig({
  mock: {
    delay: [50, 300],
    errors: {
      rate: 0.05,
      status: 503,
      message: 'Random local mock failure',
    },
  },
});
```

## Schema-only seed records

```js
export default defineConfig({
  seed: {
    generateFromSchema: true,
    generatedCount: 5,
  },
});
```

## State coverage checklist

| State | Guidance |
| --- | --- |
| **loading** | Default delay is enough to show spinners and skeletons. |
| **error** | Random failures are useful only while retry behavior is under test. |
| **empty** | Schema-generated records can unblock empty resource views. |
| **local** | Mocking never replaces app-owned policy or production monitoring. |
