# Resource paste ingress preflight cloud diagnosis (2026-07-13)

Phase 1 implements only the verified synchronous preflight foundation for Resource paste/drop ingress.

## Implemented

- File-bearing paste/drop is rejected from the actual event target when the target is a Resource title, Resource block editor, or Resource page shell.
- Raw text, custom block MIME, and HTML fallback representations are bounded before mutation or block-selection clearing.
- Structural block paste now prepares one projected Resource clone before commit, then validates the exact projected block count, block text lengths, and Resource PUT body size.
- Code-block paste validates the exact merged code text and projected Resource PUT body before beginning history or mutating the live block.
- Rejections use the existing toast and app announcement surfaces.

## Intentionally not implemented in phase 1

- Async progress/cancel UI.
- Real binary upload or media block handling.
- File reads, data/blob URLs, base64 asset ingestion, workers, timers, or new asset schema.
- New `ui.pasteIngress` state or CSS.

These remain phase 2 / P2 work.
