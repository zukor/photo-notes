// Copies microphone samples off the audio thread in ~40 ms blocks for live transcription.
class PhotoNotesPcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.length = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      if (this.length + channel.length > this.buffer.length) { this.port.postMessage(this.buffer.slice(0, this.length)); this.length = 0; }
      this.buffer.set(channel, this.length); this.length += channel.length;
      if (this.length >= 1920) { this.port.postMessage(this.buffer.slice(0, this.length)); this.length = 0; }
    }
    return true;
  }
}
registerProcessor('photonotes-pcm-capture', PhotoNotesPcmCapture);
