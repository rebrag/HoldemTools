// src/lib/engineLimits.ts
//
// The one memory ceiling every htsolver config this app emits carries
// (`memory_limit_gb`). The engine fails fast against it from its estimator
// before allocating, and `engine plan` reports each core's estimate against
// it, so the number the pages send and the number the API plans with cannot
// drift apart. It is the watcher box's budget, not the user's machine.
export const MEMORY_LIMIT_GB = 12;
