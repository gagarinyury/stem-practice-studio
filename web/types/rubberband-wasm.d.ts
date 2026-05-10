declare module "@echogarden/rubberband-wasm" {
  type RBModule = {
    HEAPF32: Float32Array;
    HEAPU32: Uint32Array;
    _malloc(n: number): number;
    _free(ptr: number): void;
    _rubberband_new(
      sampleRate: number,
      channels: number,
      options: number,
      initialTimeRatio: number,
      initialPitchScale: number,
    ): number;
    _rubberband_delete(stretcher: number): void;
    _rubberband_set_time_ratio(stretcher: number, ratio: number): void;
    _rubberband_set_pitch_scale(stretcher: number, scale: number): void;
    _rubberband_process(stretcher: number, planesPtr: number, samples: number, isFinal: number): void;
    _rubberband_available(stretcher: number): number;
    _rubberband_retrieve(stretcher: number, planesPtr: number, samples: number): number;
  };
  const factory: (opts?: { locateFile?: (path: string) => string }) => Promise<RBModule>;
  export default factory;
}
