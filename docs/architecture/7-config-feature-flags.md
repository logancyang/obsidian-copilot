# 7) Config & Feature Flags

```json
{
  "parallelToolCalls": {
    "enabled": false,
    "concurrency": 4
  }
}
```

- Read at runner init. Disable → fall back to existing sequential path.
