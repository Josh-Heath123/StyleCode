/**
 * The tool that speaks the test meetings (Phase 3 brief, decision 2):
 * sherpa-onnx 1.13.8 running Kokoro v1.0, installed by `npm run eval:audio:setup`
 * into `~/.stylecode/transcription/voices/`, outside the repository. 1.13.x,
 * not 2.x: from 2.0.0 Kokoro skips words missing from its word list, which
 * would silently drop South African names; 1.13.x hands them to espeak-ng.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TRANSCRIPTION_HOME = process.env.STYLECODE_TRANSCRIPTION_HOME ?? join(homedir(), '.stylecode', 'transcription');
export const VOICES_HOME = join(TRANSCRIPTION_HOME, 'voices');

export interface Download {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  licence: string;
  /** The folder the archive unpacks to, inside `VOICES_HOME`. */
  folder: string;
}

export const VOICE_TOOLS: Download[] = [
  {
    name: 'sherpa-onnx v1.13.8, Windows x64 (shared, Release)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MD-Release.tar.bz2',
    sha256: '3e971a04b2e0ba4dfa53d381a006367ce8c9f5f09b4ae00043e9845c2baded22',
    bytes: 20494724,
    licence: 'Apache-2.0 (https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/LICENSE)',
    folder: 'sherpa-onnx-v1.13.8-win-x64-shared-MD-Release',
  },
  {
    name: 'Kokoro v1.0 for sherpa-onnx (kokoro-multi-lang-v1_0)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
    sha256: '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4',
    bytes: 349886476,
    licence:
      'Kokoro-82M weights Apache-2.0 (https://huggingface.co/hexgrad/Kokoro-82M); the bundled espeak-ng-data is GPL-3.0, used only to make test audio, never shipped with StyleCode',
    folder: 'kokoro-multi-lang-v1_0',
  },
];

const TTS = join(
  VOICES_HOME,
  VOICE_TOOLS[0].folder,
  'bin',
  process.platform === 'win32' ? 'sherpa-onnx-offline-tts.exe' : 'sherpa-onnx-offline-tts',
);
const KOKORO = join(VOICES_HOME, VOICE_TOOLS[1].folder);

/** The program and its arguments to speak `text` in voice `sid` into `output`. Never through a shell. */
export function ttsCommand(text: string, sid: number, accent: 'us' | 'gb', output: string, threads: number) {
  return {
    program: TTS,
    args: [
      `--kokoro-model=${join(KOKORO, 'model.onnx')}`,
      `--kokoro-voices=${join(KOKORO, 'voices.bin')}`,
      `--kokoro-tokens=${join(KOKORO, 'tokens.txt')}`,
      `--kokoro-data-dir=${join(KOKORO, 'espeak-ng-data')}`,
      `--kokoro-lexicon=${join(KOKORO, `lexicon-${accent}-en.txt`)},${join(KOKORO, 'lexicon-zh.txt')}`,
      `--num-threads=${threads}`,
      `--sid=${sid}`,
      `--output-filename=${output}`,
      text,
    ],
  };
}

/** Kokoro v1.0's English voices and their speaker ids in sherpa-onnx (from the model's metadata). */
export const KOKORO_VOICES: Record<string, number> = {
  af_alloy: 0,
  af_aoede: 1,
  af_bella: 2,
  af_heart: 3,
  af_jessica: 4,
  af_kore: 5,
  af_nicole: 6,
  af_nova: 7,
  af_river: 8,
  af_sarah: 9,
  af_sky: 10,
  am_adam: 11,
  am_echo: 12,
  am_eric: 13,
  am_fenrir: 14,
  am_liam: 15,
  am_michael: 16,
  am_onyx: 17,
  am_puck: 18,
  am_santa: 19,
  bf_alice: 20,
  bf_emma: 21,
  bf_isabella: 22,
  bf_lily: 23,
  bm_daniel: 24,
  bm_fable: 25,
  bm_george: 26,
  bm_lewis: 27,
};
