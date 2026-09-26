## Vault search decision demo

Copy the six notes in this directory into a synthetic test vault and let Miyo index them.

Queries:

- `我决定不用 Atlas 的那篇笔记`
- `关于 Atlas 现在的最终决定`
- `关于 Nimbus 现在的最终决定`

With AI boost off, each adopt/reject pair should be adjacent with similar Miyo scores. With AI boost on, the newer reject note should rank first at 50% or higher and the older adopt note should fall below “Less likely”.
