// The microphone's sound, passed from the audio thread to the page (Phase 3
// brief, decision 12). It only copies: the page downsamples to 16 kHz mono
// with a pure, tested function (src/workspace/audio/resample.ts). Blocks of
// 128 frames are gathered into about a tenth of a second before posting.
class StyleCodeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.max(128, Math.round(sampleRate / 10 / 128) * 128);
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const frames = channels[0].length;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels.length; c++) sum += channels[c][i];
        this.buffer[this.filled++] = sum / channels.length;
        if (this.filled === this.size) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('stylecode-capture', StyleCodeCapture);
