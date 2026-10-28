# Third-party notices

## Pi agent core

The production task loop uses `@earendil-works/pi-agent-core` and
`@earendil-works/pi-ai` 1.4.0, pinned in package-lock.json, from
https://github.com/earendil-works/pi/tree/4a080252f06caf63a525d7873c5d94d3c23887e0.
The MIT license is preserved in `resources/licenses/pi-1.4.0-LICENSE` and in
the packaged `dist/third-party-licenses` notices. The host supplies its own
model stream, canonical conversation, tool gateway, budgets and recovery.
The Pi coding-agent CLI, its session store and provider transport are not used.

## DeepInfer and deepseek-recipe design references

The incremental SSE framing in `src/core/runtime/sse-framer.ts` is an independent
TypeScript implementation informed by the bounded incremental stream processing
in deepseek-recipe's `deepseek-recipe/src/stream/output_parser.rs` and
`deepseek-recipe/src/stream/decoder.rs` (MIT, DeepSeek 2026), commit
`935817c66f5d6e64838f419692545f06787e485f`:
https://github.com/deepseek-ai/deepseek-recipe

The stage-separated arrival diagnostics in `src/core/runtime/response-timing.ts`
are an independent implementation informed by DeepInfer's separated scheduling,
model execution and output processing measurements, commit
`9bd9cf243fc53ef9afbf8f04d391d989117d6ab9`:
https://github.com/deepseek-ai/DeepInfer

No DeepInfer engine code, kernels, tokenizer, model templates, or inference
runtime are embedded. Client-observed event arrival times do not measure server
GPU prefill/decode. This integration adds no provider request or prompt content.
The SSE wire grammar follows the WHATWG HTML Standard:
https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation

## DeepSeek Harness

The bounded exponential backoff and cancellable delay in
`src/core/runtime/network-recovery.ts` are adapted from
`packages/llm/llm-retry/src/index.ts` in
https://github.com/deepseek-ai/deepseek-harness at commit
`687f282e8625c6b8d11ff58211a90524be2e4317` (0.2.1-rc.2).
The integration uses this client's existing request ledger, budgets and runtime.
The upstream unbounded retry mode and execution framework are not included.

The append-only planning context in `src/core/runtime/cache-session.ts` is an
independent implementation informed by the runtime-context architecture in
`packages/core/agent-loop/src/runtime-context.ts` (Git blob
`cb959b055a691d7bb8f1e36dfbb721203999b347`). It uses this client's accepted
documents, scope restrictions and durable object store. No Harness runtime
dependency or external execution framework is embedded.

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
