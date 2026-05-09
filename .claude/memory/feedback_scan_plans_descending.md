---
name: Scan dev/plans/ descending for highest PLA-NNNN
description: When finding the highest PLA-NNNN filename in dev/plans/, sort descending so the highest number appears first
type: feedback
---

When the c_plan_index.md ID allocation rule says "scan `dev/plans/` for the highest existing `PLA-NNNN` filename", use `ls -r` (reverse/descending sort) so the highest-numbered plan appears at the top of the output — no need to scroll to the end of an ascending list.

**Why:** User observed that ascending `ls | head -20` showed low-numbered plans; the highest PLA-NNNN is always at the tail of an ascending sort and the head of a descending one. Faster and less error-prone.

**How to apply:** Replace any `ls dev/plans/ | tail -1` or scroll-to-end pattern with `ls -r dev/plans/ | grep PLA | head -1` or `ls -1 dev/plans/ | sort -r | head -1`.
