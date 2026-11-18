// Worker della voce neurale: esegue il modello Piper (onnxruntime-web, WebAssembly) fuori dal
// thread principale, così la sintesi non ferma i fotogrammi del gioco. Riceve gli id dei fonemi già
// pronti e restituisce l'audio PCM. Le librerie arrivano da public/piper, indirizzi dati dalla pagina.

interface OrtTensor { data: unknown }
interface OrtSession { run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> }
interface OrtModule {
  env: { wasm: { wasmPaths?: string; numThreads?: number; proxy?: boolean } };
  Tensor: new (type: string, data: unknown, dims: number[]) => OrtTensor;
  InferenceSession: { create(src: string, opts: object): Promise<OrtSession> };
}

export type WorkerRequest =
  | { type: 'load'; id: number; ortUrl: string; wasmBase: string; model: string }
  | { type: 'run'; id: number; model: string; ids: number[]; scales: [number, number, number] };

export type WorkerReply =
  | { type: 'ok'; id: number }
  | { type: 'pcm'; id: number; pcm: Float32Array }
  | { type: 'error'; id: number; message: string };

interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
let ort: Promise<OrtModule> | null = null;
const sessions = new Map<string, Promise<OrtSession>>();
let chain: Promise<unknown> = Promise.resolve();

function loadOrt(url: string, wasmBase: string): Promise<OrtModule> {
  if (!ort) {
    ort = (async () => {
      const mod = (await import(/* @vite-ignore */ url)) as OrtModule & { default?: OrtModule };
      const o = mod.InferenceSession ? mod : (mod.default as OrtModule);
      o.env.wasm.wasmPaths = wasmBase;
      o.env.wasm.numThreads = 1;
      o.env.wasm.proxy = false;
      return o;
    })();
    ort.catch(() => { ort = null; });
  }
  return ort;
}

function reply(msg: WorkerReply, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  // una richiesta alla volta: la sessione non accetta esecuzioni concorrenti
  chain = chain.then(async () => {
    try {
      if (req.type === 'load') {
        const o = await loadOrt(req.ortUrl, req.wasmBase);
        let s = sessions.get(req.model);
        if (!s) {
          s = o.InferenceSession.create(req.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
          sessions.set(req.model, s);
          s.catch(() => sessions.delete(req.model));
        }
        await s;
        reply({ type: 'ok', id: req.id });
      } else {
        const o = await (ort ?? Promise.reject(new Error('runtime not loaded')));
        const s = await (sessions.get(req.model) ?? Promise.reject(new Error('model not loaded')));
        const n = req.ids.length;
        const res = await s.run({
          input: new o.Tensor('int64', BigInt64Array.from(req.ids, (x) => BigInt(x)), [1, n]),
          input_lengths: new o.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]),
          scales: new o.Tensor('float32', Float32Array.from(req.scales), [3]),
        });
        const data = res.output?.data;
        const pcm = data instanceof Float32Array ? data.slice() : new Float32Array(0);
        reply({ type: 'pcm', id: req.id, pcm }, [pcm.buffer]);
      }
    } catch (e) {
      reply({ type: 'error', id: req.id, message: String((e as Error)?.message ?? e) });
    }
  });
};
